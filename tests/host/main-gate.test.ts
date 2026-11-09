import { describe, expect, test } from "bun:test";
import { gateTurn, newTurnRecord, type GateInput } from "../../src/host/main-gate.ts";
import { buildSnapshot, type Snapshot } from "../../src/host/readiness.ts";
import type { CatalogSkill } from "../../src/host/skills.ts";
import type { State } from "../../src/store/state-file.ts";

const snapshot = (state: State = {}, env = { TYPESAFE_API_KEY: "k" }): Snapshot =>
  buildSnapshot({
    configRead: { kind: "ok", present: true, config: {} as never },
    stateRead: { kind: "ok", state },
    env,
    toolNames: [],
  });
const skill: CatalogSkill = {
  name: "debug",
  body: "Do it.",
  path: "/s/debug/SKILL.md",
  baseDir: "/s/debug",
  fingerprint: "fp",
};
const model = { provider: "p", id: "m", reasoning: true, thinkingLevelMap: { xhigh: "xhigh" } };
const input = (over: Partial<GateInput> = {}): GateInput => ({
  prompt: "do the thing",
  isChildSession: false,
  load: () => snapshot({ switches: { strategy: false, skills: false } }),
  model,
  apiKey: () => "k",
  branch: () => [],
  planSkills: () => undefined,
  ...over,
});

describe("gateTurn: untouched turns", () => {
  const untouched: [string, Partial<GateInput>][] = [
    ["a run started by a custom message", { prompt: undefined }],
    ["a blank prompt", { prompt: "  " }],
    ["a child session", { isChildSession: true }],
    ["no model", { model: undefined }],
    ["no API key value", { apiKey: () => undefined }],
    ["an empty API key", { apiKey: () => "" }],
    ["no key set in the snapshot", { load: () => snapshot({}, {} as never) }],
    [
      "every feature off",
      { load: () => snapshot({ switches: { effort: false, strategy: false, skills: false } }) },
    ],
  ];
  for (const [name, over] of untouched) {
    test(`returns undefined for ${name}`, () => {
      expect(gateTurn(input(over))).toBeUndefined();
    });
  }

  test("does not read the catalog when the turn is untouched for another reason", () => {
    let reads = 0;
    gateTurn(input({ apiKey: () => undefined, planSkills: () => (reads++, undefined) }));
    expect(reads).toBe(0);
  });

  test("does not load the snapshot for a child session or a blank prompt", () => {
    let loads = 0;
    const load = () => (loads++, snapshot());
    gateTurn(input({ isChildSession: true, load }));
    gateTurn(input({ prompt: " ", load }));
    expect(loads).toBe(0);
  });
});

describe("gateTurn: decided turns", () => {
  test("asks effort when effort is on and the model supports two effort levels", () => {
    const plan = gateTurn(input());
    expect(plan).toMatchObject({
      effortOn: true,
      askEffort: true,
      askStrategy: false,
      held: false,
    });
    expect(Object.keys(plan!.questions.wire)).toContain("effort");
  });

  test("asks no effort for a model without reasoning", () => {
    const plan = gateTurn(input({ model: { ...model, reasoning: false } }));
    expect(plan).toMatchObject({ askEffort: false, supported: ["off"] });
  });

  test("proceeds with only skills on when a batch exists", () => {
    const state = { switches: { effort: false, strategy: false, skills: true } };
    const plan = gateTurn(input({ load: () => snapshot(state), planSkills: () => [[skill]] }));
    expect(plan?.batches).toEqual([[skill]]);
    expect(Object.keys(plan!.questions.wire)).toContain("which");
  });

  test("returns undefined with only skills on and no batch", () => {
    const state = { switches: { effort: false, strategy: false, skills: true } };
    expect(gateTurn(input({ load: () => snapshot(state) }))).toBeUndefined();
  });

  test("holds effort for a held provider on the decided model", () => {
    const decided = { provider: "p", model: "m", level: "high" };
    const branch = [{ type: "custom", customType: "jev-turn", data: { turnId: "t", decided } }];
    const held = buildSnapshot({
      configRead: {
        kind: "ok",
        present: true,
        config: { effort: { holdProviders: ["p"] } } as never,
      },
      stateRead: { kind: "ok", state: { switches: { strategy: false, skills: false } } },
      env: { TYPESAFE_API_KEY: "k" },
      toolNames: [],
    });
    const plan = gateTurn(input({ load: () => held, branch: () => branch as never }));
    expect(plan).toMatchObject({ held: true, askEffort: false });
  });

  test("carries provider, model, compaction and previous turn from the branch", () => {
    const branch = [
      { type: "compaction", id: "c-1" },
      { type: "custom", customType: "jev-turn", data: { turnId: "t-0" } },
    ];
    expect(gateTurn(input({ branch: () => branch as never }))).toMatchObject({
      provider: "p",
      modelId: "m",
      compactionId: "c-1",
      previousTurnId: "t-0",
    });
  });
});

describe("newTurnRecord", () => {
  test("starts an empty record with only the defined context fields", () => {
    const plan = gateTurn(input())!;
    const rec = newTurnRecord(plan, {
      turnId: "t-1",
      at: 1000,
      sessionId: "s",
      mode: "balanced",
      from: "low",
    });
    expect(rec).toEqual({
      turnId: "t-1",
      at: 1000,
      sessionId: "s",
      mode: "balanced",
      from: "low",
      provider: "p",
      model: "m",
      answered: false,
      ms: 0,
      sawRequest: false,
      toolCalls: 0,
      failures: 0,
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  test("marks a held turn", () => {
    const plan = { ...gateTurn(input())!, held: true };
    const ids = { turnId: "t", at: 1, sessionId: "s", mode: "balanced", from: "low" } as const;
    expect(newTurnRecord(plan, ids).held).toBe(true);
  });
});
