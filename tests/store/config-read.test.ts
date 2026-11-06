import { chmodSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { readConfig, type ConfigRead } from "../../src/store/config.ts";
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
      {
        "name": "reviewer",
        "model": "9router/gpt-6.1-sol",
        "when": "Choose when the task is to review, audit or verify existing work and report findings without changing it: a diff, a pull request, a plan, a spec or a completed task, from a small re-review to a whole-branch review. Not for implementing, fixing or researching."
      }
    ]
  },
  "effort": { "holdProviders": ["9router"] },
  "skills": { "inject": "content" },
  "tools": { "mode": "observe" },
  "state": { "parentRequest": false },
  "review": { "cli": "codex" }
}`;

const isRoot = process.getuid?.() === 0;

function withDir<T>(fn: (dir: string) => T): T {
  const dir = tempDir("config-read-");
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function readText(text: string): ConfigRead {
  return withDir((dir) => {
    writeFileSync(join(dir, "config.json"), text);
    return readConfig(dir);
  });
}

function readJson(value: unknown): ConfigRead {
  return readText(JSON.stringify(value));
}

function paths(r: ConfigRead): string[] {
  if (r.kind !== "invalid") throw new Error("expected invalid");
  return r.issues.map((i) => i.path);
}

function expectValid(r: ConfigRead): void {
  expect(r.kind === "invalid" ? r.issues : []).toEqual([]);
  expect(r.kind).toBe("ok");
}

const slot = (name: string) => ({ name, model: "9router/gpt-6.1-sol" });

describe("readConfig", () => {
  test("Valid full example", () => {
    const r = readText(FULL);
    expect(r).toEqual({ kind: "ok", present: true, config: JSON.parse(FULL) });
  });

  test("Several problems reported together", () => {
    const r = readJson({
      classifier: { timeoutMs: 100 },
      crew: { slots: [{ name: "Reviewer", model: "a/b" }] },
    });
    expect(paths(r).sort()).toEqual(["classifier.timeoutMs", "crew.slots[0].name"]);
  });

  test("Invalid result has no values", () => {
    const r = readJson({ tiers: { fast: "a/b" }, classifier: { timeoutMs: 100 } });
    expect(r.kind).toBe("invalid");
    expect("config" in r).toBe(false);
    expect(JSON.stringify(r)).not.toContain("a/b");
  });

  test("Bad JSON", () => {
    expect(paths(readText("{ nope"))).toEqual([""]);
  });

  test("Section of the wrong type", () => {
    expect(paths(readJson({ classifier: "x" }))).toEqual(["classifier"]);
    expect(paths(readJson({ classifier: null }))).toEqual(["classifier"]);
  });

  test("Top level is not an object", () => {
    expect(paths(readText("[]"))).toEqual([""]);
  });

  test("Value is not echoed", () => {
    const secret = "sk-test-0123456789abcdef";
    const r = readJson({ classifier: { apiKeyEnv: secret } });
    expect(paths(r)).toEqual(["classifier.apiKeyEnv"]);
    expect(JSON.stringify(r)).not.toContain(secret);
  });

  test.skipIf(isRoot)("Unreadable file", () => {
    withDir((dir) => {
      const file = join(dir, "config.json");
      writeFileSync(file, "{}");
      chmodSync(file, 0o000);
      try {
        const r = readConfig(dir);
        expect(paths(r)).toEqual([""]);
        expect(JSON.stringify(r)).toContain("EACCES");
      } finally {
        chmodSync(file, 0o600);
      }
    });
  });

  test("No file", () => {
    withDir((dir) => {
      expect(readConfig(dir)).toEqual({ kind: "ok", present: false, config: {} });
    });
  });

  test("Secret-like key", () => {
    expect(paths(readJson({ classifier: { apiKey: "x" } }))).toEqual(["classifier.apiKey"]);
  });

  test("Typo", () => {
    expect(paths(readJson({ classifier: { timeoutMS: 1500 } }))).toEqual(["classifier.timeoutMS"]);
  });

  test("Unknown section", () => {
    expect(paths(readJson({ token: "x" }))).toEqual(["token"]);
  });

  test("Prototype key", () => {
    const r = readText('{"__proto__": {"polluted": true}}');
    expect(paths(r)).toEqual(["__proto__"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("Remote http URL rejected", () => {
    expect(paths(readJson({ classifier: { url: "http://example.com/v1" } }))).toEqual([
      "classifier.url",
    ]);
  });

  test("Loopback http URL accepted", () => {
    expectValid(readJson({ classifier: { url: "http://127.0.0.1:8080/v1" } }));
  });

  test("Other scheme rejected", () => {
    expect(paths(readJson({ classifier: { url: "ftp://127.0.0.1/v1" } }))).toEqual([
      "classifier.url",
    ]);
  });

  test("URL with credentials rejected", () => {
    expect(
      paths(readJson({ classifier: { url: "https://user:pass@api.typesafe.ai/v1" } })),
    ).toEqual(["classifier.url"]);
  });

  test("Timeout bounds", () => {
    const at = (n: number) => readJson({ classifier: { timeoutMs: n } });
    expectValid(at(300));
    expectValid(at(5000));
    for (const n of [299, 5001, 1500.5]) expect(paths(at(n))).toEqual(["classifier.timeoutMs"]);
  });

  test("Key-shaped apiKeyEnv rejected", () => {
    expect(paths(readJson({ classifier: { apiKeyEnv: "sk-test-0123456789abcdef" } }))).toEqual([
      "classifier.apiKeyEnv",
    ]);
  });

  test("Tier without provider rejected", () => {
    expect(paths(readJson({ tiers: { fast: "claude-haiku-5-5" } }))).toEqual(["tiers.fast"]);
  });

  test("Unknown tier rejected", () => {
    expect(paths(readJson({ tiers: { ultra: "a/b" } }))).toEqual(["tiers.ultra"]);
  });

  test("Model too long", () => {
    const ok = "p/" + "x".repeat(126);
    expectValid(readJson({ tiers: { deep: ok } }));
    expect(paths(readJson({ tiers: { deep: ok + "x" } }))).toEqual(["tiers.deep"]);
  });

  test("Slot when bounds", () => {
    const w = (when: string) => readJson({ crew: { slots: [{ ...slot("a"), when }] } });
    expect(paths(w("   "))).toEqual(["crew.slots[0].when"]);
    expect(paths(w("x".repeat(501)))).toEqual(["crew.slots[0].when"]);
  });

  test("Too many slots", () => {
    const slots = Array.from({ length: 9 }, (_, i) => slot(`s${i}`));
    expect(paths(readJson({ crew: { slots } }))).toEqual(["crew.slots"]);
  });

  test("Reserved slot name", () => {
    expect(paths(readJson({ crew: { slots: [slot("review")] } }))).toEqual(["crew.slots[0].name"]);
  });

  test("Duplicate slot name", () => {
    expect(paths(readJson({ crew: { slots: [slot("reviewer"), slot("reviewer")] } }))).toEqual([
      "crew.slots[1].name",
    ]);
  });

  test("Slot without model", () => {
    expect(paths(readJson({ crew: { slots: [{ name: "a" }] } }))).toEqual(["crew.slots[0].model"]);
  });

  test("Duplicate hold provider", () => {
    expect(paths(readJson({ effort: { holdProviders: ["9router", "9router"] } }))).toEqual([
      "effort.holdProviders[1]",
    ]);
  });

  test("Hold provider bounds", () => {
    const many = Array.from({ length: 33 }, (_, i) => `p${i}`);
    expect(paths(readJson({ effort: { holdProviders: many } }))).toEqual(["effort.holdProviders"]);
    expect(paths(readJson({ effort: { holdProviders: ["bad name"] } }))).toEqual([
      "effort.holdProviders[0]",
    ]);
  });

  test("Non-boolean parentRequest", () => {
    expect(paths(readJson({ state: { parentRequest: "yes" } }))).toEqual(["state.parentRequest"]);
  });

  test("Enum values", () => {
    const r = readJson({
      skills: { inject: "full" },
      tools: { mode: "remove" },
      review: { cli: "claude" },
    });
    expect(paths(r).sort()).toEqual(["review.cli", "skills.inject", "tools.mode"]);
  });

  test("Read leaves the file untouched", () => {
    withDir((dir) => {
      const file = join(dir, "config.json");
      writeFileSync(file, '{"classifier": {"timeoutMs": 100}}');
      const bytes = readFileSync(file);
      const mtime = statSync(file).mtimeMs;
      expect(readConfig(dir).kind).toBe("invalid");
      expect(readFileSync(file).equals(bytes)).toBe(true);
      expect(statSync(file).mtimeMs).toBe(mtime);
    });
  });
});
