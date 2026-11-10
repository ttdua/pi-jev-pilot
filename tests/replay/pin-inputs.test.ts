import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MainSample } from "../../scripts/replay/corpus.ts";
import { readSnapshot, rebuildRich, SnapshotError } from "../../scripts/replay/inputs.ts";
import type { SessionEntry } from "../../scripts/replay/sessions.ts";

const custom = (id: string, customType: string, data?: unknown, type = "custom"): SessionEntry => ({
  type,
  id,
  customType,
  ...(data === undefined ? {} : { data }),
});
const sampleOf = (before: SessionEntry[]): MainSample => ({
  session: "s",
  cwd: "/nonexistent-replay-cwd",
  entryId: "u",
  prompt: "go",
  branch: [...before, { type: "message", id: "u", message: { role: "user", content: "go" } }],
});
const decisionOf = (before: SessionEntry[], ledger = new Map<string, object>()) =>
  rebuildRich(sampleOf(before), { ledger }).rich.lastDecision;

describe("lastDecision characterization", () => {
  const eff = (id: string, data: unknown) => custom(id, "jev-pilot:effort", data);
  const turn = (id: string, turnId: unknown) => custom(id, "jev-turn", { turnId });
  const cases: [string, SessionEntry[], Map<string, object>, unknown][] = [
    ["none", [], new Map(), undefined],
    ["effort only", [eff("a", { requested: "high" })], new Map(), { effort: "high" }],
    [
      "strategy only",
      [eff("a", { decision: { strategy: "direct" } })],
      new Map(),
      { strategy: "direct" },
    ],
    ["empty effort entry still decides", [eff("a", {})], new Map(), {}],
    ["non-string requested dropped", [eff("a", { requested: 3 })], new Map(), {}],
    [
      "non-object decision dropped",
      [eff("a", { requested: "low", decision: "x" })],
      new Map(),
      { effort: "low" },
    ],
    [
      "empty strings dropped",
      [eff("a", { requested: "", decision: { strategy: "" } })],
      new Map(),
      {},
    ],
    [
      "latest entry wins",
      [eff("a", { requested: "low" }), eff("b", { requested: "high" })],
      new Map(),
      { effort: "high" },
    ],
    [
      "jev-turn joined with ledger, key order effort then strategy",
      [turn("t", "t1")],
      new Map([["t1", { effective: "m", strategy: "s" }]]),
      { effort: "m", strategy: "s" },
    ],
    [
      "jev-turn partial ledger",
      [turn("t", "t1")],
      new Map([["t1", { strategy: "s" }]]),
      { strategy: "s" },
    ],
    ["jev-turn with empty ledger row decides {}", [turn("t", "t1")], new Map([["t1", {}]]), {}],
    [
      "unjoined jev-turn is skipped to the earlier decision",
      [eff("a", { requested: "low" }), turn("t", "nope")],
      new Map(),
      { effort: "low" },
    ],
    [
      "jev-turn without turnId is skipped",
      [eff("a", { requested: "low" }), turn("t", 5)],
      new Map(),
      { effort: "low" },
    ],
    [
      "entry without data is skipped",
      [eff("a", { requested: "low" }), custom("x", "jev-pilot:effort")],
      new Map(),
      { effort: "low" },
    ],
    [
      "non-object data is skipped",
      [eff("a", { requested: "low" }), custom("x", "jev-turn", "str")],
      new Map(),
      { effort: "low" },
    ],
    [
      "non-custom type is skipped",
      [
        eff("a", { requested: "low" }),
        custom("x", "jev-pilot:effort", { requested: "high" }, "message"),
      ],
      new Map(),
      { effort: "low" },
    ],
    [
      "unknown customType is skipped",
      [eff("a", { requested: "low" }), custom("x", "other", { requested: "high" })],
      new Map(),
      { effort: "low" },
    ],
  ];
  for (const [name, before, ledger, expected] of cases) {
    test(name, () => {
      const got = decisionOf(before, ledger);
      expect(got).toEqual(expected as never);
      if (got !== undefined && "effort" in got && "strategy" in got) {
        expect(Object.keys(got)).toEqual(["effort", "strategy"]);
      }
    });
  }
});

describe("isAgent characterization (via readSnapshot)", () => {
  const agent = {
    name: "scout",
    source: "project",
    description: "d",
    instructionsExcerpt: "",
    declaredTools: null,
    maxTurns: null,
    sets: { model: false, thinking: false },
  };
  const load = (a: unknown) => {
    const dir = mkdtempSync(join(tmpdir(), "replay-pin-snap-"));
    try {
      const path = join(dir, "s.json");
      writeFileSync(path, JSON.stringify({ v: 1, tools: [], agents: [a] }));
      return readSnapshot(path);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const valid: [string, object][] = [
    ["baseline", {}],
    ["global source", { source: "global" }],
    ["builtin source", { source: "builtin" }],
    ["declaredTools strings", { declaredTools: ["a", "b"] }],
    ["declaredTools empty", { declaredTools: [] }],
    ["maxTurns number", { maxTurns: 0 }],
    ["runInBackground bool", { runInBackground: false }],
    ["inheritContext bool", { inheritContext: true }],
    ["locked true", { locked: true }],
    ["locked empty array", { locked: [] }],
    ["locked fields", { locked: ["model", "thinking"] }],
    ["sets both true", { sets: { model: true, thinking: true } }],
    ["extra keys tolerated", { extra: 1 }],
  ];
  for (const [name, over] of valid) {
    test(`accepts: ${name}`, () => {
      expect(load({ ...agent, ...over }).agents).toHaveLength(1);
    });
  }
  const invalid: [string, unknown][] = [
    ["string agent", "x"],
    ["array agent", []],
    ["description number", { ...agent, description: 1 }],
    ["description missing", { ...agent, description: undefined }],
    ["instructionsExcerpt number", { ...agent, instructionsExcerpt: 1 }],
    ["instructionsExcerpt missing", { ...agent, instructionsExcerpt: undefined }],
    ["source missing", { ...agent, source: undefined }],
    ["declaredTools string", { ...agent, declaredTools: "a" }],
    ["maxTurns missing", { ...agent, maxTurns: undefined }],
    ["runInBackground string", { ...agent, runInBackground: "x" }],
    ["runInBackground null", { ...agent, runInBackground: null }],
    ["inheritContext number", { ...agent, inheritContext: 1 }],
    ["locked null", { ...agent, locked: null }],
    ["locked unknown field", { ...agent, locked: ["nope"] }],
    ["locked mixed", { ...agent, locked: ["model", "nope"] }],
    ["sets missing", { ...agent, sets: undefined }],
    ["sets array-less null", { ...agent, sets: null }],
    ["sets.thinking missing", { ...agent, sets: { model: true } }],
    ["sets.thinking string", { ...agent, sets: { model: true, thinking: "y" } }],
    ["sets.model missing", { ...agent, sets: { thinking: true } }],
  ];
  for (const [name, a] of invalid) {
    test(`rejects: ${name}`, () => {
      expect(() => load(a)).toThrow(SnapshotError);
    });
  }
});
