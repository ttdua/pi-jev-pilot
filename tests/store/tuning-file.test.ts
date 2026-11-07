import { chmodSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { readTuning } from "../../src/store/tuning-file.ts";
import { tempDir } from "../helpers.ts";

const isRoot = process.getuid?.() === 0;

function withDir(fn: (dir: string) => void): void {
  const dir = tempDir("jev-tuning-");
  try {
    fn(dir);
  } finally {
    try {
      chmodSync(join(dir, "tuning.json"), 0o600);
    } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
}

const entry = { at: 1, parameter: "timeoutMs", from: 1500, to: 1700, cause: "rule" } as const;
const full = {
  off: false,
  timeoutMs: { value: 1700, base: 1500 },
  pending: { from: 1500, to: 1700, at: 5, before: { asked: 20, timeouts: 3 } },
  block: { value: 1900, at: 7 },
  history: [entry],
};

function put(dir: string, doc: unknown): void {
  writeFileSync(join(dir, "tuning.json"), typeof doc === "string" ? doc : JSON.stringify(doc));
}

function paths(r: ReturnType<typeof readTuning>): string[] {
  return "issues" in r ? r.issues.map((i) => i.path) : [];
}

function read(doc: unknown): ReturnType<typeof readTuning> {
  let out!: ReturnType<typeof readTuning>;
  withDir((dir) => {
    put(dir, doc);
    out = readTuning(dir);
  });
  return out;
}

describe("tuning content", () => {
  test("Valid file read", () => {
    expect(read({ version: 1, ...full })).toEqual({ kind: "ok", record: full });
  });
  test("Other parameter rejected", () => {
    expect(paths(read({ version: 1, riskFloor: 1 }))).toEqual(["riskFloor"]);
  });
  test("Missing inner key", () => {
    expect(paths(read({ version: 1, timeoutMs: { value: 1700 } }))).toEqual(["timeoutMs.base"]);
  });
  test("Out of range", () => {
    expect(paths(read({ version: 1, timeoutMs: { value: 9000, base: 1500 } }))).toEqual([
      "timeoutMs.value",
    ]);
  });
  test("Too much history", () => {
    const r = read({ version: 1, history: Array.from({ length: 51 }, () => entry) });
    expect(r.kind).toBe("malformed");
    expect(paths(r).some((p) => p.includes("history"))).toBe(true);
  });
  test("Unknown cause", () => {
    const history = [entry, entry, entry, { ...entry, cause: "manual" }];
    expect(paths(read({ version: 1, history }))).toEqual(["history[3].cause"]);
  });
  test("More timeouts than asked", () => {
    const pending = { ...full.pending, before: { asked: 10, timeouts: 11 } };
    expect(paths(read({ version: 1, pending }))).toEqual(["pending.before.timeouts"]);
  });
  test("future version", () => {
    expect(paths(read({ version: 2 }))).toEqual(["version"]);
  });
});

describe("tuning file states", () => {
  test("No file", () =>
    withDir((dir) => {
      expect(readTuning(dir)).toEqual({ kind: "missing", record: {} });
    }));
  test("Bad JSON", () => {
    const r = read('{"version":1,');
    expect(r.kind).toBe("malformed");
    expect(r.record).toEqual({});
    expect(paths(r)).toEqual([""]);
  });
  test("Partly valid file is not salvaged", () => {
    const r = read({ version: 1, timeoutMs: full.timeoutMs, history: "x" });
    expect(r.kind).toBe("malformed");
    expect(r.record).toEqual({});
  });
  test("Value not echoed", () => {
    const r = read({ version: 1, timeoutMs: { value: 1700, base: "secret-123" } });
    expect(r.kind).toBe("malformed");
    expect(JSON.stringify(r)).not.toContain("secret-123");
  });
  test.skipIf(isRoot)("Permission denied (read)", () =>
    withDir((dir) => {
      put(dir, { version: 1 });
      chmodSync(join(dir, "tuning.json"), 0o000);
      const r = readTuning(dir);
      expect(r.kind).toBe("unreadable");
      expect(JSON.stringify(r)).toContain("EACCES");
    }),
  );
});
