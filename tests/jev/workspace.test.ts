import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scanLanguages } from "../../src/jev/workspace.ts";
import { tempDir } from "../helpers.ts";

const dirs: string[] = [];
function tree(files: Record<string, number> | string[]): string {
  const root = tempDir("jev-lang-");
  dirs.push(root);
  const list = Array.isArray(files)
    ? files
    : Object.entries(files).flatMap(([ext, n]) =>
        Array.from({ length: n }, (_, i) => `f${i}.${ext}`),
      );
  for (const rel of list) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, "");
  }
  return root;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("scanLanguages", () => {
  test("ranked languages", () => {
    expect(scanLanguages(tree({ ts: 10, py: 4, go: 1 }))).toEqual(["TypeScript", "Python"]);
  });

  test("ties by name", () => {
    expect(scanLanguages(tree({ rs: 3, go: 3, py: 3 }))).toEqual(["Go", "Python", "Rust"]);
  });

  test("at most 5", () => {
    const r = scanLanguages(tree({ ts: 3, py: 3, go: 3, rs: 3, java: 3, rb: 3, php: 3 }));
    expect(r).toHaveLength(5);
  });

  test("skipped directory", () => {
    expect(scanLanguages(tree(["node_modules/a.ts"]))).toEqual(["none found"]);
  });

  test("too deep", () => {
    const deep = ["a/b/c/d/x.ts", "a/b/c/d/y.ts", "a/b/c/d/z.ts"];
    expect(scanLanguages(tree(deep))).toEqual(["none found"]);
    const ok = ["a/b/c/x.ts", "a/b/c/y.ts", "a/b/c/z.ts"];
    expect(scanLanguages(tree(ok))).toEqual(["TypeScript"]);
  });

  test("symlink skipped", () => {
    const root = tree([]);
    const real = tree(["x.ts", "y.ts", "z.ts"]);
    symlinkSync(real, join(root, "link"));
    expect(scanLanguages(root)).toEqual(["none found"]);
  });

  test("unreadable dir skipped", () => {
    if (process.getuid?.() === 0) return;
    const root = tree(["ok/a.py", "ok/b.py", "ok/c.py", "locked/a.ts"]);
    chmodSync(join(root, "locked"), 0o000);
    try {
      expect(scanLanguages(root)).toEqual(["Python"]);
    } finally {
      chmodSync(join(root, "locked"), 0o755);
    }
  });

  test("stops at the entry cap", () => {
    const root = tree([]);
    for (let i = 0; i < 6000; i++) writeFileSync(join(root, `f${i}.ts`), "");
    const started = Date.now();
    expect(scanLanguages(root)).toEqual(["TypeScript"]);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
