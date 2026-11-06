import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../../src/store/atomic.ts";
import { tempDir } from "../helpers.ts";

const mode = (p: string): number => statSync(p).mode & 0o777;
const isRoot = process.getuid?.() === 0;

describe("writeFileAtomic", () => {
  test("created directory and file are owner-only", () => {
    const root = tempDir("atomic-");
    try {
      const dir = join(root, "jev");
      expect(writeFileAtomic(dir, "a.json", "x")).toEqual({ ok: true });
      expect(mode(dir)).toBe(0o700);
      expect(mode(join(dir, "a.json"))).toBe(0o600);
      expect(readFileSync(join(dir, "a.json"), "utf8")).toBe("x");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("existing mode kept with keepMode", () => {
    const root = tempDir("atomic-");
    try {
      const f = join(root, "a.json");
      writeFileSync(f, "old");
      chmodSync(f, 0o640);
      expect(writeFileAtomic(root, "a.json", "new", { keepMode: true })).toEqual({ ok: true });
      expect(mode(f)).toBe(0o640);
      expect(readFileSync(f, "utf8")).toBe("new");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("no temporary file after success", () => {
    const root = tempDir("atomic-");
    try {
      writeFileAtomic(root, "a.json", "x");
      expect(readdirSync(root)).toEqual(["a.json"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("failed write leaves the target unchanged", () => {
    const root = tempDir("atomic-");
    try {
      const target = join(root, "a.json");
      mkdirSync(target);
      writeFileSync(join(target, "keep"), "content");
      const r = writeFileAtomic(root, "a.json", "x");
      expect(r.ok).toBe(false);
      expect(statSync(target).isDirectory()).toBe(true);
      expect(readFileSync(join(target, "keep"), "utf8")).toBe("content");
      expect(readdirSync(root).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test.skipIf(isRoot)("read-only directory returns EACCES", () => {
    const root = tempDir("atomic-");
    try {
      chmodSync(root, 0o500);
      expect(writeFileAtomic(root, "a.json", "x")).toEqual({ ok: false, code: "EACCES" });
    } finally {
      chmodSync(root, 0o700);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
