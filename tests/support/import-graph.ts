import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

/** Marker for `import(expr)` with an argument that is not a string literal. */
const NON_LITERAL = "<non-literal>";

type LayerName = "host" | "jev" | "policy" | "store" | "shared";

export type Location =
  | { kind: "entry" }
  | { kind: "layer"; layer: LayerName; capability: string | undefined; file: string }
  | { kind: "scripts" }
  | { kind: "tests" }
  | { kind: "outside" };

export type ImportViolation = { file: string; specifier: string; reason: string };

const LAYERS: readonly string[] = ["host", "jev", "policy", "store", "shared"];
const CAPABILITY_LAYERS: ReadonlySet<string> = new Set(["host", "policy"]);

/** Allowed layer edges, from docs/architecture.md. */
const LAYER_EDGES: Record<LayerName, readonly LayerName[]> = {
  host: ["host", "jev", "policy", "store", "shared"],
  jev: ["jev", "policy", "shared"],
  policy: ["policy", "shared"],
  store: ["store", "shared"],
  shared: ["shared"],
};

function literalText(node: ts.Node | undefined): string | undefined {
  if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
    return node.text;
  }
  return undefined;
}

/** `import(...)` or a bare `require(...)` call. */
function isModuleLoad(node: ts.CallExpression): boolean {
  const callee = node.expression;
  return (
    callee.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(callee) && callee.text === "require")
  );
}

/** The module specifier a node names, if it is an import form. */
function specifierOf(node: ts.Node): string | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return literalText(node.moduleSpecifier);
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return literalText(node.moduleReference.expression);
  }
  if (ts.isCallExpression(node) && isModuleLoad(node)) {
    return literalText(node.arguments[0]) ?? NON_LITERAL;
  }
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
    return literalText(node.argument.literal);
  }
  return undefined;
}

/** Every module specifier a TypeScript source imports or re-exports. */
export function moduleSpecifiers(source: string): string[] {
  const file = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    const specifier = specifierOf(node);
    if (specifier !== undefined) found.push(specifier);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** Places a repository-relative path (forward slashes). */
export function locate(repoPath: string): Location {
  const parts = repoPath.split("/");
  if (parts[0] === "scripts") return { kind: "scripts" };
  if (parts[0] === "tests") return { kind: "tests" };
  if (parts[0] !== "src") return { kind: "outside" };
  if (parts.length === 2) {
    return parts[1]?.startsWith("extension") ? { kind: "entry" } : { kind: "outside" };
  }
  const layer = parts[1] ?? "";
  if (!LAYERS.includes(layer)) return { kind: "outside" };
  const capability = CAPABILITY_LAYERS.has(layer) && parts.length > 3 ? parts[2] : undefined;
  return { kind: "layer", layer: layer as LayerName, capability, file: parts.slice(2).join("/") };
}

const posix = (path: string): string => path.split(sep).join("/");

/** Repository path a relative specifier reaches, or undefined when it leaves the root. */
function targetPath(root: string, file: string, specifier: string): string | undefined {
  const rel = posix(relative(root, resolve(root, dirname(file), specifier)));
  return rel.startsWith("..") ? undefined : rel;
}

/** The shortest relative specifier from `file` to what `specifier` reaches. */
function shortestPath(root: string, file: string, specifier: string): string {
  const from = resolve(root, dirname(file));
  const rel = posix(relative(from, resolve(from, specifier)));
  return rel.startsWith("..") ? rel : `./${rel}`;
}

const BUILTIN_SCHEME = /^(node|bun):/;

function malformedReason(specifier: string): string | undefined {
  if (specifier === NON_LITERAL) return "Import with a string literal.";
  if (specifier.startsWith("/") || /^[a-zA-Z]:[\\/]|^file:/.test(specifier)) {
    return "Use a relative path, not an absolute one.";
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(specifier) && !BUILTIN_SCHEME.test(specifier)) {
    return "Import a relative path or a package, not a URL.";
  }
  if (specifier.startsWith(".") && !/\.(ts|json)$/.test(specifier)) {
    return "Name the file with its extension.";
  }
  return undefined;
}

function piReason(from: Location): string | undefined {
  return from.kind === "layer" && from.layer === "host" ? undefined : "Only host/ may import Pi.";
}

function edgeReason(from: Location, to: Location): string | undefined {
  if (from.kind === "entry") {
    return to.kind === "layer" && to.layer === "host"
      ? undefined
      : "The entry point wires only host/.";
  }
  if (from.kind === "scripts") {
    if (to.kind === "entry") return "scripts/ must not import the entry point.";
    const blocked = to.kind === "layer" && (to.layer === "host" || to.layer === "store");
    return blocked ? "scripts/ must not import host/ or store/." : undefined;
  }
  if (from.kind !== "layer") return undefined;
  if (to.kind === "entry") return `${from.layer}/ must not import the entry point.`;
  if (to.kind !== "layer") return `${from.layer}/ must not import ${to.kind}.`;
  return LAYER_EDGES[from.layer].includes(to.layer)
    ? undefined
    : `${from.layer}/ must not import ${to.layer}/.`;
}

function capabilityReason(from: Location, to: Location): string | undefined {
  if (to.kind !== "layer" || to.capability === undefined) return undefined;
  const inside =
    from.kind === "layer" && from.layer === to.layer && from.capability === to.capability;
  if (inside || to.file === `${to.capability}/index.ts`) return undefined;
  return `Use ${to.layer}/${to.capability}/index.ts.`;
}

function shortestReason(root: string, file: string, specifier: string): string | undefined {
  const from = locate(file);
  if (from.kind !== "layer" || !CAPABILITY_LAYERS.has(from.layer)) return undefined;
  const shortest = shortestPath(root, file, specifier);
  return shortest === specifier ? undefined : `Use the shortest relative path: ${shortest}.`;
}

function relativeReason(root: string, file: string, specifier: string): string | undefined {
  const from = locate(file);
  const path = targetPath(root, file, specifier);
  const to: Location = path === undefined ? { kind: "outside" } : locate(path);
  if (to.kind === "outside" || to.kind === "tests") return "Imports leave the source tree.";
  return edgeReason(from, to) ?? capabilityReason(from, to);
}

/** The violation of one import, or undefined when it is allowed. */
export function checkImport(root: string, file: string, specifier: string): string | undefined {
  const malformed = malformedReason(specifier);
  if (malformed !== undefined) return malformed;
  if (specifier.startsWith("@earendil-works/")) return piReason(locate(file));
  if (!specifier.startsWith(".")) return undefined;
  return shortestReason(root, file, specifier) ?? relativeReason(root, file, specifier);
}

/** Paths nested deeper than the layout allows. */
export function nestingViolations(repoPaths: readonly string[]): string[] {
  return repoPaths.filter((path) => {
    const parts = path.split("/");
    if (parts[0] !== "src" || !LAYERS.includes(parts[1] ?? "")) return false;
    const below = parts.length - 2;
    return CAPABILITY_LAYERS.has(parts[1] ?? "") ? below > 3 : below > 1;
  });
}

/** Every violation in the given repository-relative source files. */
export async function importViolations(
  root: string,
  files: readonly string[],
): Promise<ImportViolation[]> {
  const found: ImportViolation[] = [];
  for (const file of files) {
    const text = await Bun.file(join(root, file)).text();
    for (const specifier of moduleSpecifiers(text)) {
      const reason = checkImport(root, file, specifier);
      if (reason !== undefined) found.push({ file, specifier, reason });
    }
  }
  return found;
}
