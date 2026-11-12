import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./helpers";

const VENDOR_DIR = join(REPO_ROOT, "packages", "pi-subagents");
const read = (path: string): string => readFileSync(path, "utf8");
const vendoredDoc = (): string => read(join(VENDOR_DIR, "VENDORED.md"));

/** Files this repository adds beside the upstream tree. */
const OWN_FILES: ReadonlySet<string> = new Set(["VENDORED.md", ".upstream-manifest"]);

function vendoredFiles(dir: string, prefix = ""): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const rel = prefix === "" ? name : `${prefix}/${name}`;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...vendoredFiles(full, rel));
    else if (!OWN_FILES.has(rel)) found.push(rel);
  }
  return found.sort();
}

/** Blob ids recorded at the upstream split commit: `path sha` per line. */
function upstreamBlobs(): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of read(join(VENDOR_DIR, ".upstream-manifest")).split("\n")) {
    if (line.trim() === "") continue;
    const at = line.lastIndexOf(" ");
    map.set(line.slice(0, at), line.slice(at + 1));
  }
  return map;
}

/** Paths named in the first backticked cell of the Local changes table rows. */
function listedPaths(doc: string): Set<string> {
  const section = doc.split(/^## Local changes\s*$/m)[1] ?? "";
  const rows = section.split("\n").filter((l) => l.startsWith("|"));
  return new Set(rows.map((r) => /^\|\s*`([^`]+)`/.exec(r)?.[1]).filter((p) => p !== undefined));
}

/** Blob ids of vendored files, hashed in one `git` process to keep the test fast. */
function blobIds(files: readonly string[]): Map<string, string> {
  if (files.length === 0) return new Map();
  const r = Bun.spawnSync(["git", "hash-object", "--stdin-paths"], {
    cwd: REPO_ROOT,
    stdin: Buffer.from(files.map((f) => `${join(VENDOR_DIR, f)}\n`).join("")),
  });
  if (r.exitCode !== 0) throw new Error(`git hash-object failed: ${r.stderr.toString()}`);
  const ids = r.stdout.toString().trim().split("\n");
  if (ids.length !== files.length) {
    throw new Error(`git hash-object returned ${ids.length} ids for ${files.length} files`);
  }
  return new Map(files.map((f, i) => [f, ids[i] ?? ""]));
}

test("VENDORED.md records the upstream", () => {
  const doc = vendoredDoc();
  expect(doc).toContain("gotgenes/pi-packages");
  expect(doc).toContain("packages/pi-subagents");
  expect(doc).toMatch(/^- Tag: `pi-subagents-v25\.0\.5`/m);
  expect(doc).toMatch(/^- Commit: `[0-9a-f]{40}`/m);
  const tree = /^- Upstream tree commit: `([0-9a-f]{40})`/m.exec(doc)?.[1];
  const split = /^- Upstream split commit: `([0-9a-f]{40})`/m.exec(doc)?.[1];
  expect(tree).toBeString();
  expect(split).toBeString();
  expect(tree).not.toBe(split);
  // The squash commit exists in this repository and holds the vendored tree.
  const archive = Bun.spawnSync(["git", "cat-file", "-t", `${tree}`], { cwd: REPO_ROOT });
  expect(archive.stdout.toString().trim()).toBe("commit");
});

test("NOTICE.md has an entry for the vendored package", () => {
  const notice = read(join(REPO_ROOT, "NOTICE.md"));
  const entry = notice.split("\n").find((l) => l.includes("packages/pi-subagents")) ?? "";
  expect(entry).toContain("gotgenes/pi-packages");
  expect(entry).toContain("MIT");
});

test("notice credits tintinweb for the fleet list", () => {
  const notice = read(join(REPO_ROOT, "NOTICE.md"));
  const entry = notice.split("\n").find((l) => l.startsWith("- [tintinweb/pi-subagents]")) ?? "";
  expect(entry).toContain("tintinweb/pi-subagents");
  expect(entry).toContain("0.23.2");
  expect(entry).toContain("MIT");
});

test("the vendored LICENSE is the upstream one", () => {
  expect(upstreamBlobs().get("LICENSE")).toBe(blobIds(["LICENSE"]).get("LICENSE"));
});

test("unlisted edit detected", () => {
  const upstream = upstreamBlobs();
  const listed = listedPaths(vendoredDoc());
  const unlisted: string[] = [];
  const files = vendoredFiles(VENDOR_DIR);
  const current = blobIds(files);
  for (const file of files) {
    const changed = upstream.get(file) !== current.get(file);
    if (changed && !listed.has(file)) unlisted.push(file);
  }
  for (const file of upstream.keys()) {
    if (!existsSync(join(VENDOR_DIR, file)) && !listed.has(file)) unlisted.push(file);
  }
  expect(unlisted, `edited without a VENDORED.md entry: ${unlisted.join(", ")}`).toEqual([]);
});
