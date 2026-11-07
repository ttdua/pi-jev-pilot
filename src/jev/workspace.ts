// Reads workspace facts from file names only; never file contents.
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

type Marker = { platform: string; files?: RegExp; dirs?: string[]; paths?: string[] };

// Order follows docs/jev-contract.md `workspace.platforms`.
const MARKERS: Marker[] = [
  { platform: "Vercel", files: /^vercel\.json$/, dirs: [".vercel"] },
  { platform: "AWS CDK", files: /^cdk\.json$/ },
  { platform: "AWS Serverless", files: /^serverless\.(yml|yaml|ts|js)$/ },
  { platform: "AWS SAM", files: /^(template\.ya?ml|samconfig\.toml)$/ },
  { platform: "AWS CodeBuild", files: /^buildspec\.ya?ml$/ },
  { platform: "AWS Amplify", files: /^amplify\.ya?ml$/, dirs: ["amplify"] },
  { platform: "Netlify", files: /^netlify\.toml$/ },
  { platform: "Firebase", files: /^firebase\.json$/ },
  { platform: "Supabase", paths: ["supabase/config.toml"] },
  { platform: "Fly.io", files: /^fly\.toml$/ },
  { platform: "Cloudflare Workers", files: /^wrangler\.(toml|json|jsonc)$/ },
  { platform: "Google Cloud", files: /^(app|cloudbuild)\.ya?ml$/ },
  { platform: "Render", files: /^render\.ya?ml$/ },
  { platform: "Railway", files: /^railway\.(json|toml)$/ },
  { platform: "Docker Compose", files: /^(docker-)?compose\.ya?ml$/ },
  { platform: "Docker", files: /^Dockerfile$/ },
  { platform: "GitHub Actions", paths: [".github/workflows"] },
  { platform: "Bitbucket Pipelines", files: /^bitbucket-pipelines\.yml$/ },
];

export const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "out",
  "cdk.out",
  "vendor",
  "target",
  ".venv",
  "venv",
  "__pycache__",
  "coverage",
]);

function isDir(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

function listDir(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Platform markers by file name at `cwd` and one level below; never file contents. */
export function scanPlatforms(cwd: string): string[] {
  const found = new Set<string>();
  try {
    const roots = [cwd];
    for (const entry of listDir(cwd)) {
      if (entry.isSymbolicLink() || !entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      roots.push(join(cwd, entry.name));
    }
    for (const root of roots) {
      const entries = listDir(root).filter((e) => !e.isSymbolicLink());
      for (const marker of MARKERS) {
        if (found.has(marker.platform)) continue;
        const byName = entries.some(
          (e) =>
            (marker.files !== undefined && e.isFile() && marker.files.test(e.name)) ||
            (marker.dirs !== undefined && e.isDirectory() && marker.dirs.includes(e.name)),
        );
        const byPath = (marker.paths ?? []).some((p) => {
          const full = join(root, p);
          return p.endsWith(".toml") ? isFile(full) : isDir(full);
        });
        if (byName || byPath) found.add(marker.platform);
      }
    }
  } catch {
    // Scanning is best effort and never throws.
  }
  return found.size === 0
    ? ["none found"]
    : MARKERS.map((m) => m.platform).filter((p) => found.has(p));
}

const LANGUAGES: Record<string, string[]> = {
  TypeScript: ["ts", "tsx", "mts", "cts"],
  JavaScript: ["js", "jsx", "mjs", "cjs"],
  Python: ["py"],
  Go: ["go"],
  Rust: ["rs"],
  Java: ["java"],
  Kotlin: ["kt", "kts"],
  Swift: ["swift"],
  C: ["c", "h"],
  "C++": ["cc", "cpp", "cxx", "hpp"],
  "C#": ["cs"],
  Ruby: ["rb"],
  PHP: ["php"],
  Shell: ["sh", "bash", "zsh"],
  Svelte: ["svelte"],
  Vue: ["vue"],
  Dart: ["dart"],
  Elixir: ["ex", "exs"],
  Scala: ["scala"],
  Lua: ["lua"],
  SQL: ["sql"],
  HTML: ["html"],
  CSS: ["css", "scss"],
  Zig: ["zig"],
  Haskell: ["hs"],
};

const LANGUAGE_BY_EXT = new Map(
  Object.entries(LANGUAGES).flatMap(([name, exts]) => exts.map((ext) => [ext, name] as const)),
);

const MAX_LANGUAGES = 5;
const MAX_DEPTH = 3;
const MAX_ENTRIES = 5000;
const MIN_FILES = 3;
const MIN_SHARE = 0.05;

function languageOf(fileName: string): string | undefined {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? undefined : LANGUAGE_BY_EXT.get(fileName.slice(dot + 1));
}

/** File counts per language, breadth first, bounded by depth and entries visited. */
function countLanguages(cwd: string): Map<string, number> {
  const counts = new Map<string, number>();
  let visited = 0;
  let level = [cwd];
  for (let depth = 0; depth <= MAX_DEPTH && level.length > 0; depth++) {
    const next: string[] = [];
    for (const dir of level) {
      for (const entry of listDir(dir)) {
        if (++visited > MAX_ENTRIES) return counts;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) next.push(join(dir, entry.name));
        } else if (entry.isFile()) {
          const language = languageOf(entry.name);
          if (language !== undefined) counts.set(language, (counts.get(language) ?? 0) + 1);
        }
      }
    }
    level = next;
  }
  return counts;
}

/** Up to 5 languages by file-name extension, most files first; never file contents. */
export function scanLanguages(cwd: string): string[] {
  let counts: Map<string, number>;
  try {
    counts = countLanguages(cwd);
  } catch {
    return ["none found"];
  }
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const ranked = [...counts]
    .filter(([, n]) => n >= MIN_FILES && n >= total * MIN_SHARE)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_LANGUAGES)
    .map(([name]) => name);
  return ranked.length === 0 ? ["none found"] : ranked;
}
