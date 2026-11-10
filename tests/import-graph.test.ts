import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
  checkImport,
  importViolations,
  moduleSpecifiers,
  nestingViolations,
  typeOnlySpecifiers,
  type ImportViolation,
} from "./support/import-graph.ts";
import { REPO_ROOT } from "./helpers.ts";

const FIXTURES = join(REPO_ROOT, "tests", "fixtures");

function tsFiles(root: string, ...folders: string[]): string[] {
  return folders
    .filter((folder) => existsSync(join(root, folder)))
    .flatMap((folder) =>
      (readdirSync(join(root, folder), { recursive: true }) as string[])
        .map((p) => `${folder}/${p.split("\\").join("/")}`)
        .filter((p) => p.endsWith(".ts")),
    );
}

async function violatingFiles(tree: string): Promise<string[]> {
  const root = join(FIXTURES, tree);
  const found = await importViolations(root, tsFiles(root, "src", "scripts"));
  return [...new Set(found.map((v) => v.file))].sort();
}

function badFixtures(tree: string): string[] {
  const root = join(FIXTURES, tree);
  return tsFiles(root, "src", "scripts")
    .filter((p) => (p.split("/").pop() ?? "").includes("bad-"))
    .sort();
}

async function fixtureViolations(file: string): Promise<ImportViolation[]> {
  const found = await importViolations(join(FIXTURES, "import-graph"), [file]);
  return found.filter((v) => v.file === file);
}

test("source and scripts have no import violation", async () => {
  const files = tsFiles(REPO_ROOT, "src", "scripts");
  expect(await importViolations(REPO_ROOT, files)).toEqual([]);
});

test("the canonical fixtures violate exactly where named bad-", async () => {
  expect(await violatingFiles("boundaries")).toEqual(badFixtures("boundaries"));
});

test("the resolver-only fixtures violate exactly where named bad-", async () => {
  expect(await violatingFiles("import-graph")).toEqual(badFixtures("import-graph"));
});

test("the scanner reads every import form", () => {
  const cases: [string, string][] = [
    ['import type { A } from "./a.ts";', "./a.ts"],
    ['import type D from "./d.ts";', "./d.ts"],
    ['import type * as N from "./n.ts";', "./n.ts"],
    ['import { type B as C, c } from "./b.ts"; c;', "./b.ts"],
    ['export type { E } from "./e.ts";', "./e.ts"],
    ['export { f } from "./f.ts";', "./f.ts"],
    ['import "./g.ts";', "./g.ts"],
    ['await import("./h.ts");', "./h.ts"],
  ];
  for (const [source, path] of cases) expect(moduleSpecifiers(source)).toEqual([path]);
});

test("the scanner ignores strings, templates and comments", () => {
  expect(moduleSpecifiers(`const s = 'import("./x.ts")';`)).toEqual([]);
  expect(moduleSpecifiers("const t = `import { q } from './y.ts';`;")).toEqual([]);
  expect(moduleSpecifiers(`const re = /"import "x"/;`)).toEqual([]);
  expect(moduleSpecifiers(`const o = { from: "./o.ts" };`)).toEqual([]);
  expect(moduleSpecifiers(`// import "./z.ts";`)).toEqual([]);
  expect(
    moduleSpecifiers(`const a = "/*";\nimport type { X } from "./w.ts";\nconst b = "*/";`),
  ).toEqual(["./w.ts"]);
});

test("the scanner reads clauses with comments and odd names", () => {
  expect(moduleSpecifiers('// import type\nimport { r } from "./r.ts";')).toEqual(["./r.ts"]);
  expect(moduleSpecifiers('import /* c */ type { R } from "./c1.ts";')).toEqual(["./c1.ts"]);
  expect(moduleSpecifiers('import { type /* c */ R } from "./c2.ts";')).toEqual(["./c2.ts"]);
  expect(moduleSpecifiers('import type from "./t.ts"; type();')).toEqual(["./t.ts"]);
});

test("the scanner reads every TypeScript import syntax", () => {
  expect(moduleSpecifiers('const r = 1 / 2; import type { R } from "./div.ts";')).toEqual([
    "./div.ts",
  ]);
  expect(
    moduleSpecifiers(
      String.raw`if (ok) /import\("\.\.\/x.ts"\)/.test(s); import type { T } from "./t2.ts";`,
    ),
  ).toEqual(["./t2.ts"]);
  expect(moduleSpecifiers(String.raw`import type { R } from "\u002e\u002e/w/r.ts";`)).toEqual([
    "../w/r.ts",
  ]);
  expect(moduleSpecifiers("import(`./tpl.ts`)")).toEqual(["./tpl.ts"]);
  expect(moduleSpecifiers('import X = require("./eq.ts");')).toEqual(["./eq.ts"]);
  expect(moduleSpecifiers('import type Y = require("./teq.ts");')).toEqual(["./teq.ts"]);
  expect(moduleSpecifiers('import("./opt.ts", { with: { type: "json" } })')).toEqual(["./opt.ts"]);
  expect(moduleSpecifiers('let v: import("./it.ts").T;')).toEqual(["./it.ts"]);
  expect(moduleSpecifiers('export * as ns from "./s.ts";')).toEqual(["./s.ts"]);
  expect(moduleSpecifiers('const m = "./a.ts"; await import(m);')).toEqual(["<non-literal>"]);
});

test("the scanner finds every import the transpiler finds", async () => {
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  for (const file of tsFiles(REPO_ROOT, "src", "scripts")) {
    const text = readFileSync(join(REPO_ROOT, file), "utf8");
    const mine = new Set(moduleSpecifiers(text));
    for (const imp of transpiler.scanImports(text)) {
      expect(mine.has(imp.path), `${file}: ${imp.path}`).toBe(true);
    }
  }
});

test("violations name the file, the import and the fix", async () => {
  const noncanonical = await fixtureViolations("src/host/main/bad-noncanonical-sibling.ts");
  expect(noncanonical).toHaveLength(1);
  expect(noncanonical[0]).toMatchObject({
    file: "src/host/main/bad-noncanonical-sibling.ts",
    specifier: "./../worker/routing.ts",
  });
  expect(noncanonical[0]?.reason).toContain("../worker/routing.ts");

  const typeOnly = await fixtureViolations("src/host/main/bad-type-only-deep.ts");
  expect(typeOnly[0]?.specifier).toBe("../worker/routing.ts");
  expect(typeOnly[0]?.reason).toContain("host/worker/index.ts");

  const nested = await fixtureViolations("src/policy/main/nested/bad-nested-roundtrip.ts");
  expect(nested[0]?.reason).toContain("../../answers.ts");

  const viaParent = await fixtureViolations("src/host/main/bad-own-via-parent.ts");
  expect(viaParent[0]?.reason).toContain("./gate.ts");

  const nonLiteral = await fixtureViolations("src/host/main/bad-non-literal.ts");
  expect(nonLiteral[0]).toMatchObject({
    specifier: "<non-literal>",
    reason: "Import with a string literal.",
  });
});

test("the scanner reads CommonJS require() calls", () => {
  expect(moduleSpecifiers('const w = require("../worker/routing.ts");')).toEqual([
    "../worker/routing.ts",
  ]);
  expect(moduleSpecifiers('const t = "../worker/routing.ts"; const w = require(t);')).toEqual([
    "<non-literal>",
  ]);
  expect(moduleSpecifiers("const o = { require: 1 }; o.require(x);")).toEqual([]);
});

test("literal and non-literal require() calls are checked like imports", () => {
  const root = "/repo";
  const file = "src/host/main/gate.ts";
  expect(checkImport(root, file, "../worker/routing.ts")).toBeString();
  expect(checkImport(root, file, "<non-literal>")).toBeString();
});

test("only relative paths, bare packages and node:/bun: built-ins are accepted", () => {
  const root = "/repo";
  const file = "src/host/main/gate.ts";
  for (const bad of [
    "data:text/javascript,export default 42",
    "https://example.com/x.js",
    "http://example.com/x.js",
    "blob:abc",
  ]) {
    expect(checkImport(root, file, bad), bad).toBeString();
  }
  for (const good of ["node:path", "bun:test", "typebox", "@scope/pkg", "typebox/compile"]) {
    expect(checkImport(root, file, good), good).toBeUndefined();
  }
});

test("capability folders nest at most one level and other layers stay flat", () => {
  expect(
    nestingViolations([
      "src/host/main/a/b/x.ts",
      "src/host/main/a/y.ts",
      "src/policy/x.ts",
      "src/jev/sub/x.ts",
      "src/store/x.ts",
    ]),
  ).toEqual(["src/host/main/a/b/x.ts", "src/jev/sub/x.ts"]);
  expect(nestingViolations(tsFiles(REPO_ROOT, "src"))).toEqual([]);
});

test("layers and the entry point must not import scripts, while scripts may import scripts", () => {
  const root = "/repo";
  const cases: [string, string][] = [
    ["src/policy/answers.ts", "../../scripts/replay/run.ts"],
    ["src/host/main/gate.ts", "../../../scripts/replay/run.ts"],
    ["src/shared/text.ts", "../../scripts/replay/run.ts"],
    ["src/extension.ts", "../scripts/replay/run.ts"],
  ];
  for (const [file, specifier] of cases) {
    expect(checkImport(root, file, specifier), `${file} -> ${specifier}`).toBeString();
  }
  expect(checkImport(root, "scripts/replay/a.ts", "./run.ts")).toBeUndefined();
});

test("Runtime import rejected", async () => {
  const bad = await fixtureViolations("src/host/bad-executor-runtime.ts");
  expect(bad).toHaveLength(1);
  expect(bad[0]?.specifier).toBe("@ttdua/pi-subagents");
  const root = "/repo";
  const file = "src/host/main/gate.ts";
  expect(checkImport(root, file, "../../../packages/pi-subagents/src/index.ts")).toBeString();
  expect(checkImport(root, file, "@ttdua/pi-subagents/settings")).toBeString();
});

test("Type import allowed", async () => {
  expect(await fixtureViolations("src/host/ok-executor-type.ts")).toEqual([]);
  expect(
    typeOnlySpecifiers('import type { A } from "@ttdua/pi-subagents"; import { b } from "x";'),
  ).toEqual(["@ttdua/pi-subagents"]);
});

test("Runtime import rejected for the package subpath and a relative path", async () => {
  for (const file of ["bad-executor-subpath-runtime.ts", "bad-executor-relative-runtime.ts"]) {
    const found = await fixtureViolations(`src/host/${file}`);
    expect(found, file).toHaveLength(1);
  }
});

test("Type import allowed for the package subpath and a relative path", async () => {
  for (const file of ["ok-executor-subpath-type.ts", "ok-executor-relative-type.ts"]) {
    expect(await fixtureViolations(`src/host/${file}`), file).toEqual([]);
  }
  const root = "/repo";
  const file = "src/host/main/gate.ts";
  const relative = "../../../packages/pi-subagents/src/index.ts";
  expect(checkImport(root, file, "@ttdua/pi-subagents/settings", true)).toBeUndefined();
  expect(checkImport(root, file, relative, true)).toBeUndefined();
  expect(checkImport(root, file, relative, false)).toBeString();
});
