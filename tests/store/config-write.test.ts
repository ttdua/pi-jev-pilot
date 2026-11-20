import { chmodSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  migrateConfigFile,
  migrateLegacyKeys,
  readConfig,
  writeSlots,
  type Slot,
} from "../../src/store/config.ts";
import { tempDir } from "../helpers.ts";

const FULL = `{
  "classifier": {
    "url": "https://api.typesafe.ai/v1/systemone",
    "model": "jev-latest",
    "apiKeyEnv": "TYPESAFE_API_KEY",
    "timeoutMs": 1500
  },
  "tiers": {
    "basic": "claude-code/claude-haiku-5-5",
    "broad": "claude-code/claude-sonnet-5-5",
    "deep": "claude-code/claude-opus-5-5",
    "frontier": "claude-code/claude-fable-5-1"
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
      const text = '{ "skills": { "inject": "full" } }';
      writeFileSync(join(dir, "config.json"), text);
      const r = writeSlots(dir, [slot("a")]);
      expect(r).toEqual({
        ok: false,
        issues: [{ path: "skills.inject", message: expect.any(String) }],
      });
      expect(readFileSync(join(dir, "config.json"), "utf8")).toBe(text);
    }));

  test("writeSlots validates what it rewrites", () =>
    withDir((dir) => {
      for (const text of ['{ "skills": { "inject": "full" } }', "{ not json", "[]"]) {
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
      const { review: _review, ...before } = JSON.parse(FULL) as Record<string, unknown>;
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

  test("Slot writer refuses a slot without when", () =>
    withDir((dir) => {
      writeFileSync(join(dir, "config.json"), FULL);
      const r = writeSlots(dir, [{ name: "reviewer", model: "a/b" } as unknown as Slot]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.issues.map((i) => i.path)).toEqual(["crew.slots[0].when"]);
      expect(readFileSync(join(dir, "config.json"), "utf8")).toBe(FULL);
    }));

  test("New crew key goes last", () =>
    withDir((dir) => {
      writeFileSync(
        join(dir, "config.json"),
        JSON.stringify({ classifier: { model: "m" }, skills: {} }),
      );
      expect(writeSlots(dir, [slot("a")])).toEqual({ ok: true });
      const after = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
      expect(Object.keys(after)).toEqual(["classifier", "skills", "crew"]);
    }));

  test("Retired review section not written back", () =>
    withDir((dir) => {
      writeFileSync(
        join(dir, "config.json"),
        JSON.stringify({ classifier: { model: "m" }, review: { cli: "codex" }, skills: {} }),
      );
      expect(writeSlots(dir, [slot("a")])).toEqual({ ok: true });
      const after = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
      expect(Object.keys(after)).toEqual(["classifier", "skills", "crew"]);
    }));

  test("slot writer keeps an opaque tools section", () =>
    withDir((dir) => {
      writeFileSync(
        join(dir, "config.json"),
        JSON.stringify({ tools: { mode: "enforce" }, crew: { slots: [slot("a")] } }),
      );
      expect(writeSlots(dir, [slot("b")])).toEqual({ ok: true });
      const after = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
      expect(after.tools).toEqual({ mode: "enforce" });
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

describe("slot name frontier", () => {
  test("New frontier slot refused", () =>
    withDir((dir) => {
      writeFileSync(join(dir, "config.json"), FULL);
      const r = writeSlots(dir, [slot("frontier")]);
      expect(r).toEqual({
        ok: false,
        issues: [
          {
            path: "crew.slots[0].name",
            message: 'expected a name that is not reserved; rename the "frontier" slot',
          },
        ],
      });
      expect(readFileSync(join(dir, "config.json"), "utf8")).toBe(FULL);
    }));

  test("slot writes emit only new tier keys", () =>
    withDir((dir) => {
      const file = join(dir, "config.json");
      writeFileSync(file, '{"tiers":{"fast":"a/x","expert":"a/y"},"skills":{"inject":"content"}}');
      expect(writeSlots(dir, [slot("reviewer")])).toEqual({ ok: true });
      const out = JSON.parse(readFileSync(file, "utf8"));
      expect(Object.keys(out)).toEqual(["tiers", "skills", "crew"]);
      expect(out.tiers).toEqual({ basic: "a/x", frontier: "a/y" });
      expect(Object.keys(out.tiers)).toEqual(["basic", "frontier"]);
    }));
});

describe("migrateLegacyKeys", () => {
  test("renames in place and lists the renames", () => {
    const raw = {
      classifier: { timeoutMs: 1500 },
      tiers: { fast: "a/x", deep: "a/y", expert: "a/z" },
      skills: { inject: "content" },
    };
    const out = migrateLegacyKeys(structuredClone(raw));
    expect(out?.renamed).toEqual([
      ["tiers.fast", "tiers.basic"],
      ["tiers.expert", "tiers.frontier"],
    ]);
    expect(out?.removed).toEqual([]);
    expect(JSON.stringify(out?.raw)).toBe(
      JSON.stringify({
        classifier: { timeoutMs: 1500 },
        tiers: { basic: "a/x", deep: "a/y", frontier: "a/z" },
        skills: { inject: "content" },
      }),
    );
  });

  test("undefined when both fork keys are present", () => {
    expect(
      migrateLegacyKeys({
        tiers: { fast: "a/x" },
        subagents: { forkLaunch: "thinking", forkedLaunch: "thinking" },
      }),
    ).toBeUndefined();
  });

  test("undefined when clean, conflicting or invalid", () => {
    expect(migrateLegacyKeys({ tiers: { basic: "a/x" } })).toBeUndefined();
    expect(migrateLegacyKeys({})).toBeUndefined();
    expect(migrateLegacyKeys({ tiers: { expert: "a/x", frontier: "a/y" } })).toBeUndefined();
    expect(
      migrateLegacyKeys({ tiers: { fast: "a/x" }, classifier: { timeoutMs: 100 } }),
    ).toBeUndefined();
    expect(migrateLegacyKeys({ review: 1, classifier: { timeoutMs: 100 } })).toBeUndefined();
  });

  test("removes a top-level review key, keeping the other keys in order", () => {
    expect(migrateLegacyKeys({ review: { enabled: true }, skills: {} })).toEqual({
      raw: { skills: {} },
      renamed: [],
      removed: ["review"],
    });
  });

  test("renames and removes in one result", () => {
    expect(migrateLegacyKeys({ tiers: { fast: "a/x" }, review: 1 })).toEqual({
      raw: { tiers: { basic: "a/x" } },
      renamed: [["tiers.fast", "tiers.basic"]],
      removed: ["review"],
    });
  });

  test("a frontier slot is never renamed", () => {
    const out = migrateLegacyKeys({
      tiers: { fast: "a/x" },
      crew: { slots: [{ name: "frontier", model: "a/y", when: "Choose it." }] },
    });
    expect(out?.renamed).toEqual([["tiers.fast", "tiers.basic"]]);
    const crew = out!.raw.crew as { slots: { name: string }[] };
    expect(crew.slots[0]?.name).toBe("frontier");
  });
});

describe("migrateConfigFile", () => {
  test("rewrites the file keeping the key order and the mode", () =>
    withDir((dir) => {
      const file = join(dir, "config.json");
      writeFileSync(
        file,
        '{"classifier":{"timeoutMs":1500},"tiers":{"fast":"a/x","deep":"a/y","expert":"a/z"}}',
      );
      chmodSync(file, 0o640);
      const r = migrateConfigFile(dir);
      expect(r).toEqual({
        renamed: [
          ["tiers.fast", "tiers.basic"],
          ["tiers.expert", "tiers.frontier"],
        ],
        removed: [],
      });
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
        classifier: { timeoutMs: 1500 },
        tiers: { basic: "a/x", deep: "a/y", frontier: "a/z" },
      });
      expect(Object.keys(JSON.parse(readFileSync(file, "utf8")).tiers)).toEqual([
        "basic",
        "deep",
        "frontier",
      ]);
      expect(statSync(file).mode & 0o777).toBe(0o640);
    }));

  test("nothing to migrate leaves the file alone", () =>
    withDir((dir) => {
      const file = join(dir, "config.json");
      const text = '{"classifier":{"timeoutMs":1500},"tiers":{"basic":"a/x"}}';
      writeFileSync(file, text);
      const before = statSync(file).mtimeMs;
      expect(migrateConfigFile(dir)).toBeUndefined();
      expect(readFileSync(file, "utf8")).toBe(text);
      expect(statSync(file).mtimeMs).toBe(before);
    }));

  test("a missing file is nothing to migrate", () =>
    withDir((dir) => {
      expect(migrateConfigFile(dir)).toBeUndefined();
      expect(existsSync(join(dir, "config.json"))).toBe(false);
    }));

  test("Migration refuses an invalid file", () =>
    withDir((dir) => {
      for (const text of [
        '{"tiers":{"fast":"a/x"},"classifier":{"timeoutMs":100}}',
        '{"review":{"cli":"codex"},"classifier":{"timeoutMs":100}}',
      ]) {
        writeFileSync(join(dir, "config.json"), text);
        expect(migrateConfigFile(dir)).toBeUndefined();
        expect(readFileSync(join(dir, "config.json"), "utf8")).toBe(text);
      }
    }));

  test("removes only a review key and keeps the mode and key order", () =>
    withDir((dir) => {
      const file = join(dir, "config.json");
      writeFileSync(file, '{"review":{"cli":"codex","enabled":true},"skills":{"inject":"suggest"}}');
      chmodSync(file, 0o640);
      expect(migrateConfigFile(dir)).toEqual({ renamed: [], removed: ["review"] });
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ skills: { inject: "suggest" } });
      expect(statSync(file).mode & 0o777).toBe(0o640);
    }));

  test("Conflicting keys left alone", () =>
    withDir((dir) => {
      const text = '{"tiers":{"expert":"a/x","frontier":"a/y"}}';
      writeFileSync(join(dir, "config.json"), text);
      expect(migrateConfigFile(dir)).toBeUndefined();
      expect(readFileSync(join(dir, "config.json"), "utf8")).toBe(text);
    }));

  test.skipIf(isRoot)("Write failure is returned, not thrown", () =>
    withDir((dir) => {
      const file = join(dir, "config.json");
      const text = '{"tiers":{"fast":"a/x"}}';
      writeFileSync(file, text);
      chmodSync(dir, 0o500);
      try {
        expect(migrateConfigFile(dir)).toEqual({ error: "cannot write config.json (EACCES)" });
        expect(readFileSync(file, "utf8")).toBe(text);
      } finally {
        chmodSync(dir, 0o700);
      }
    }),
  );
});
