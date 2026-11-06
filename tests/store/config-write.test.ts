import { chmodSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { readConfig, writeSlots, type Slot } from "../../src/store/config.ts";
import { tempDir } from "../helpers.ts";

const FULL = `{
  "classifier": {
    "url": "https://api.typesafe.ai/v1/systemone",
    "model": "jev-latest",
    "apiKeyEnv": "TYPESAFE_API_KEY",
    "timeoutMs": 1500
  },
  "tiers": {
    "fast": "claude-code/claude-haiku-5-5",
    "balanced": "claude-code/claude-sonnet-5-5",
    "deep": "claude-code/claude-opus-5-5",
    "expert": "claude-code/claude-fable-5-1"
  },
  "crew": {
    "slots": [
      { "name": "reviewer", "model": "9router/gpt-6.1-sol", "when": "Choose for reviews." }
    ]
  },
  "effort": { "holdProviders": ["9router"] },
  "skills": { "inject": "content" },
  "tools": { "mode": "observe" },
  "state": { "parentRequest": false },
  "review": { "cli": "codex" }
}`;

const isRoot = process.getuid?.() === 0;
const slot = (name: string): Slot => ({ name, model: "9router/gpt-6.1-sol", when: "Choose it." });

function withDir<T>(fn: (dir: string) => T): T {
  const dir = tempDir("config-write-");
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function shape(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(shape);
  if (v !== null && typeof v === "object")
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)]));
  return v;
}

function keysDeep(v: unknown, skip: string): unknown {
  if (Array.isArray(v)) return v.map((x) => keysDeep(x, skip));
  if (v !== null && typeof v === "object") {
    return Object.keys(v).map((k) => [k, k === skip ? null : keysDeep((v as never)[k], skip)]);
  }
  return null;
}

describe("writeSlots", () => {
  test("Slot writer refuses an invalid file", () =>
    withDir((dir) => {
      const text = '{ "tools": { "mode": "remove" } }';
      writeFileSync(join(dir, "config.json"), text);
      const r = writeSlots(dir, [slot("a")]);
      expect(r).toEqual({
        ok: false,
        issues: [{ path: "tools.mode", message: expect.any(String) }],
      });
      expect(readFileSync(join(dir, "config.json"), "utf8")).toBe(text);
    }));

  test("writeSlots validates what it rewrites", () =>
    withDir((dir) => {
      for (const text of ['{ "tools": { "mode": "remove" } }', "{ not json", "[]"]) {
        writeFileSync(join(dir, "config.json"), text);
        const r = writeSlots(dir, [slot("a")]);
        expect(r.ok).toBe(false);
        expect(readFileSync(join(dir, "config.json"), "utf8")).toBe(text);
      }
      writeFileSync(join(dir, "config.json"), "{ not json");
      expect(writeSlots(dir, [slot("a")])).toEqual({
        ok: false,
        issues: [{ path: "", message: "config.json is not valid JSON" }],
      });
    }));

  test("Other keys kept", () =>
    withDir((dir) => {
      writeFileSync(join(dir, "config.json"), FULL);
      const before = JSON.parse(FULL) as Record<string, unknown>;
      const slots = [...(before.crew as { slots: Slot[] }).slots, slot("helper")];
      expect(writeSlots(dir, slots)).toEqual({ ok: true });
      const after = JSON.parse(readFileSync(join(dir, "config.json"), "utf8")) as Record<
        string,
        unknown
      >;
      expect(Object.keys(after)).toEqual(Object.keys(before));
      expect(Object.keys(after.crew as object)).toEqual(["slots"]);
      for (const key of Object.keys(before)) {
        if (key === "crew") continue;
        expect(after[key]).toEqual(before[key]);
        expect(keysDeep(after[key], "")).toEqual(keysDeep(before[key], ""));
      }
      const read = readConfig(dir);
      expect(read.kind === "ok" ? read.config.crew?.slots : undefined).toEqual(slots);
      expect(shape(after.crew)).toEqual({ slots });
    }));

  test("Invalid new slot refused", () =>
    withDir((dir) => {
      writeFileSync(join(dir, "config.json"), FULL);
      const r = writeSlots(dir, [slot("all")]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.issues.map((i) => i.path)).toEqual(["crew.slots[0].name"]);
      expect(readFileSync(join(dir, "config.json"), "utf8")).toBe(FULL);
    }));

  test("New crew key goes last", () =>
    withDir((dir) => {
      writeFileSync(
        join(dir, "config.json"),
        JSON.stringify({ classifier: { model: "m" }, review: { cli: "codex" } }),
      );
      expect(writeSlots(dir, [slot("a")])).toEqual({ ok: true });
      const after = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
      expect(Object.keys(after)).toEqual(["classifier", "review", "crew"]);
    }));

  test("Last slot removed", () =>
    withDir((dir) => {
      writeFileSync(
        join(dir, "config.json"),
        JSON.stringify({ tools: { mode: "observe" }, crew: { slots: [slot("a")] } }),
      );
      expect(writeSlots(dir, [])).toEqual({ ok: true });
      const after = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
      expect(after).toEqual({ tools: { mode: "observe" } });
      expect("crew" in after).toBe(false);
    }));

  test("Created from nothing", () =>
    withDir((dir) => {
      expect(writeSlots(dir, [slot("a")])).toEqual({ ok: true });
      const file = join(dir, "config.json");
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ crew: { slots: [slot("a")] } });
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }));

  test("empty list without a file writes nothing", () =>
    withDir((dir) => {
      expect(writeSlots(dir, [])).toEqual({ ok: true });
      expect(existsSync(join(dir, "config.json"))).toBe(false);
    }));

  test("Existing config mode is kept", () =>
    withDir((dir) => {
      const file = join(dir, "config.json");
      writeFileSync(file, FULL);
      chmodSync(file, 0o640);
      expect(writeSlots(dir, [slot("a")])).toEqual({ ok: true });
      expect(statSync(file).mode & 0o777).toBe(0o640);
    }));

  test.skipIf(isRoot)("write failure is returned, not thrown", () =>
    withDir((dir) => {
      const file = join(dir, "config.json");
      writeFileSync(file, FULL);
      chmodSync(dir, 0o500);
      try {
        const r = writeSlots(dir, [slot("a")]);
        expect(r).toEqual({
          ok: false,
          issues: [{ path: "", message: "cannot write config.json (EACCES)" }],
        });
        expect(readFileSync(file, "utf8")).toBe(FULL);
      } finally {
        chmodSync(dir, 0o700);
      }
    }),
  );
});
