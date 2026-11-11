import { describe, expect, test } from "bun:test";

import type { Answer } from "../../../src/policy/answers.ts";
import type { ModelThinking } from "../../../src/policy/effort.ts";
import { type EffectiveLaunch, type Target, type TierName } from "../../../src/policy/launch.ts";
import { SEED_CUTPOINTS } from "../../../src/policy/worker/seed.ts";
import type { WorkerAnswers } from "../../../src/policy/worker/answers.ts";
import {
  launchKind,
  routeLaunch,
  type ForkedLaunch,
  type Route,
  type RouteInput,
} from "../../../src/policy/worker/route.ts";

const ALL: readonly TierName[] = ["fast", "balanced", "deep"];

function launch(overrides: Partial<EffectiveLaunch> = {}): EffectiveLaunch {
  return {
    inheritContext: false,
    runInBackground: false,
    modelLocked: false,
    thinkingLocked: false,
    ...overrides,
  };
}

function read(o: { tier?: [string, number]; effort?: string; risky?: number }): WorkerAnswers {
  const answers: Record<string, Answer> = {};
  if (o.tier !== undefined) {
    answers["tier"] = {
      type: "choice",
      choice: o.tier[0],
      probabilities: { fast: 0, balanced: 0, deep: 0, expert: 0, [o.tier[0]]: o.tier[1] },
    };
  }
  if (o.effort !== undefined) {
    answers["effort"] = {
      type: "choice",
      choice: o.effort,
      probabilities: { [o.effort]: 0.9 },
    };
  }
  if (o.risky !== undefined) answers["risky"] = { type: "noul", noul: o.risky };
  return { kind: "read", answers, unanswered: {} };
}

type Spy = { models: Target[]; thinkings: Target[]; runs: Target[] };

function build(
  overrides: Partial<RouteInput> = {},
  canRun: (t: Target) => boolean = () => true,
  thinking: ModelThinking | undefined = { reasoning: true },
): { input: RouteInput; spy: Spy } {
  const spy: Spy = { models: [], thinkings: [], runs: [] };
  const input: RouteInput = {
    answers: read({}),
    launch: launch(),
    offered: ALL,
    cuts: SEED_CUTPOINTS.standard,
    forkedLaunch: "untouched",
    canRun: (t) => {
      spy.runs.push(t);
      return canRun(t);
    },
    thinkingOf: (t) => {
      spy.thinkings.push(t);
      return thinking;
    },
    modelOf: (t) => {
      spy.models.push(t);
      return `fx/${t}`;
    },
    slots: [],
    ...overrides,
  };
  return { input, spy };
}

// Reference table for launchKind written from the rules, not from the code.
function expectedKind(f: {
  inherit: boolean;
  mLock: boolean;
  tLock: boolean;
  noTier: boolean;
  forked: ForkedLaunch;
}): Record<string, unknown> {
  const locked = f.mLock || f.tLock;
  const forkedThinking = f.inherit && f.forked === "thinking";
  if (f.inherit && f.forked === "untouched") return { kind: "untouched", locked };
  if (f.mLock && f.tLock) return { kind: "untouched", locked };
  if (f.tLock && (forkedThinking || f.noTier)) return { kind: "untouched", locked };
  return { kind: "ask", tierQuestion: !forkedThinking && !f.noTier, locked };
}

describe("launchKind (exhaustive pin)", () => {
  const bools = [false, true];
  const cases: Parameters<typeof expectedKind>[0][] = [];
  for (const inherit of bools)
    for (const mLock of bools)
      for (const tLock of bools)
        for (const noTier of bools)
          for (const forked of ["untouched", "thinking"] as const)
            cases.push({ inherit, mLock, tLock, noTier, forked });

  test("all 32 launch combinations match the rule table", () => {
    for (const c of cases) {
      const l = launch({
        inheritContext: c.inherit,
        modelLocked: c.mLock,
        thinkingLocked: c.tLock,
      });
      const got = launchKind(l, c.noTier ? [] : ALL, c.forked, 0);
      expect<unknown>(got).toEqual(expectedKind(c));
    }
    expect(cases).toHaveLength(32);
  });

  test("a slot alone counts as a tier for the question", () => {
    expect(launchKind(launch(), [], "untouched", 2)).toEqual({
      kind: "ask",
      tierQuestion: true,
      locked: false,
    });
  });

  test("slotCount defaults to zero", () => {
    expect(launchKind(launch(), [], "untouched")).toEqual({
      kind: "ask",
      tierQuestion: false,
      locked: false,
    });
  });

  test("result key order", () => {
    expect(Object.keys(launchKind(launch(), ALL, "untouched"))).toEqual([
      "kind",
      "tierQuestion",
      "locked",
    ]);
    expect(Object.keys(launchKind(launch({ inheritContext: true }), ALL, "untouched"))).toEqual([
      "kind",
      "locked",
    ]);
  });
});

describe("routeLaunch (pin)", () => {
  const good = read({ tier: ["balanced", 0.9], effort: "high" });

  test("untouched launch skips answers and deps", () => {
    const { input, spy } = build({ launch: launch({ inheritContext: true }), answers: good });
    const r = routeLaunch(input);
    expect(r).toEqual({ kind: "untouched" });
    expect(Object.keys(r)).toEqual(["kind"]);
    expect(spy).toEqual({ models: [], thinkings: [], runs: [] });
  });

  test("locked untouched launch key order", () => {
    const { input } = build({ launch: launch({ modelLocked: true, thinkingLocked: true }) });
    const r = routeLaunch(input);
    expect(r).toEqual({ kind: "untouched", locked: true });
    expect(Object.keys(r)).toEqual(["kind", "locked"]);
  });

  test("missing or cancelled answers skip, even when locked", () => {
    for (const answers of [undefined, { kind: "cancelled" } as WorkerAnswers]) {
      expect(routeLaunch(build({ answers }).input)).toEqual({ kind: "skip" });
      const l = launch({ modelLocked: true });
      expect(routeLaunch(build({ answers, launch: l }).input)).toEqual({ kind: "skip" });
    }
  });

  test("a miss routes with no write, keeping the lock after the reason", () => {
    const miss: WorkerAnswers = { kind: "miss", miss: "schema" };
    const plain = routeLaunch(build({ answers: miss }).input);
    expect(plain).toEqual({ kind: "routed", write: {}, record: { reason: "miss" } });
    const { input, spy } = build({ answers: miss, launch: launch({ thinkingLocked: true }) });
    const locked = routeLaunch(input) as Extract<Route, { kind: "routed" }>;
    expect(locked).toEqual({
      kind: "routed",
      write: {},
      record: { reason: "miss", locked: true },
    });
    expect(Object.keys(locked.record)).toEqual(["reason", "locked"]);
    expect(spy).toEqual({ models: [], thinkings: [], runs: [] });
  });

  test("keep: writes model then thinking; record key order", () => {
    const { input, spy } = build({ answers: good });
    const r = routeLaunch(input) as Extract<Route, { kind: "routed" }>;
    expect(r).toEqual({
      kind: "routed",
      write: { model: "fx/balanced", thinking: "high" },
      record: { reason: "cut", tier: "balanced", effort: "high" },
    });
    expect(Object.keys(r)).toEqual(["kind", "write", "record"]);
    expect(Object.keys(r.write)).toEqual(["model", "thinking"]);
    expect(Object.keys(r.record)).toEqual(["reason", "tier", "effort"]);
    expect(spy.models).toEqual(["balanced"]);
    expect(spy.thinkings).toEqual(["balanced"]);
    expect(spy.runs).toEqual(["balanced"]);
  });

  test("keep with a lock puts locked between tier and effort", () => {
    const { input } = build({ answers: good, launch: launch({ thinkingLocked: true }) });
    const r = routeLaunch(input) as Extract<Route, { kind: "routed" }>;
    expect(r.write).toEqual({ model: "fx/balanced" });
    expect(Object.keys(r.record)).toEqual(["reason", "tier", "locked"]);
  });

  test("thinking locked: no effort is computed and thinkingOf is not read", () => {
    const { input, spy } = build({ answers: good, launch: launch({ thinkingLocked: true }) });
    routeLaunch(input);
    expect(spy.thinkings).toEqual([]);
    expect(spy.models).toEqual(["balanced"]);
  });

  test("no effort answer: model only, thinkingOf not read", () => {
    const { input, spy } = build({ answers: read({ tier: ["balanced", 0.9] }) });
    const r = routeLaunch(input) as Extract<Route, { kind: "routed" }>;
    expect(r.write).toEqual({ model: "fx/balanced" });
    expect(r.record).toEqual({ reason: "cut", tier: "balanced" });
    expect(spy.thinkings).toEqual([]);
  });

  test("unknown effort choice yields no thinking", () => {
    const { input } = build({ answers: read({ tier: ["balanced", 0.9], effort: "weird" }) });
    const r = routeLaunch(input) as Extract<Route, { kind: "routed" }>;
    expect(r.write).toEqual({ model: "fx/balanced" });
  });

  test("risky lifts a low effort to high", () => {
    const { input } = build({
      answers: read({ tier: ["fast", 0.9], effort: "low", risky: 0.8 }),
    });
    const r = routeLaunch(input) as Extract<Route, { kind: "routed" }>;
    expect(r.record.reason).toBe("risky");
    expect(r.record.tier).toBe("deep");
    expect(r.write).toEqual({ model: "fx/deep", thinking: "high" });
  });

  test("max effort is capped at xhigh, then clamped to the model's levels", () => {
    const ans = read({ tier: ["deep", 0.9], effort: "max" });
    const a = routeLaunch(
      build({ answers: ans }, () => true, { reasoning: true, thinkingLevelMap: { xhigh: "x" } })
        .input,
    ) as Extract<Route, { kind: "routed" }>;
    expect(a.write.thinking).toBe("xhigh");
    const b = routeLaunch(build({ answers: ans }).input) as Extract<Route, { kind: "routed" }>;
    expect(b.write.thinking).toBe("high");
    expect(b.record.effort).toBe("high");
  });

  test("model without reasoning clamps to off; undefined thinking defaults to reasoning", () => {
    const ans = read({ tier: ["balanced", 0.9], effort: "high" });
    const off = routeLaunch(build({ answers: ans }, () => true, { reasoning: false }).input);
    expect((off as Extract<Route, { kind: "routed" }>).write.thinking).toBe("off");
    const dflt = routeLaunch(build({ answers: ans }, () => true, undefined).input);
    expect((dflt as Extract<Route, { kind: "routed" }>).write.thinking).toBe("high");
  });

  test("moved by fallback: record fallback before effort, effort forced to xhigh then clamped", () => {
    const ans = read({ tier: ["balanced", 0.9], effort: "high" });
    const { input, spy } = build({ answers: ans }, (t) => t !== "balanced", {
      reasoning: true,
      thinkingLevelMap: { xhigh: "x" },
    });
    const r = routeLaunch(input) as Extract<Route, { kind: "routed" }>;
    expect(r).toEqual({
      kind: "routed",
      write: { model: "fx/fast", thinking: "xhigh" },
      record: { reason: "cut", tier: "fast", fallback: "balanced", effort: "xhigh" },
    });
    expect(Object.keys(r.record)).toEqual(["reason", "tier", "fallback", "effort"]);
    expect(spy.models).toEqual(["fast"]);
    expect(spy.thinkings).toEqual(["fast"]);
  });

  test("moved by fallback with lock: locked sits before fallback", () => {
    const ans = read({ tier: ["balanced", 0.9], effort: "high" });
    const { input } = build(
      { answers: ans, launch: launch({ thinkingLocked: true }) },
      (t) => t !== "balanced",
    );
    const r = routeLaunch(input) as Extract<Route, { kind: "routed" }>;
    expect(Object.keys(r.record)).toEqual(["reason", "tier", "locked", "fallback"]);
    expect(r.write).toEqual({ model: "fx/fast" });
  });

  test("unchanged fallback: empty write, fallback equals the decided tier, no model read", () => {
    const { input, spy } = build({ answers: good }, () => false);
    const r = routeLaunch(input) as Extract<Route, { kind: "routed" }>;
    expect(r).toEqual({
      kind: "routed",
      write: {},
      record: { reason: "cut", tier: "balanced", fallback: "balanced" },
    });
    expect(Object.keys(r.record)).toEqual(["reason", "tier", "fallback"]);
    expect(spy.models).toEqual([]);
    expect(spy.thinkings).toEqual([]);
  });

  test("unchanged fallback with lock: locked last", () => {
    const { input } = build(
      { answers: good, launch: launch({ thinkingLocked: true }) },
      () => false,
    );
    const r = routeLaunch(input) as Extract<Route, { kind: "routed" }>;
    expect(Object.keys(r.record)).toEqual(["reason", "tier", "fallback", "locked"]);
  });

  test("slot target kept when runnable", () => {
    const ans = read({ tier: ["slot::x", 0.9], effort: "high" });
    const { input, spy } = build({ answers: ans, slots: ["x"] });
    const r = routeLaunch(input) as Extract<Route, { kind: "routed" }>;
    expect(r).toEqual({
      kind: "routed",
      write: { model: "fx/slot::x", thinking: "high" },
      record: { reason: "slot", tier: "slot::x", effort: "high" },
    });
    expect(spy.models).toEqual(["slot::x"]);
  });

  test("slot target moved to balanced when not runnable", () => {
    const ans = read({ tier: ["slot::x", 0.9], effort: "high" });
    const { input } = build({ answers: ans, slots: ["x"] }, (t) => t !== "slot::x");
    const r = routeLaunch(input) as Extract<Route, { kind: "routed" }>;
    expect(r.record).toEqual({
      reason: "slot",
      tier: "balanced",
      fallback: "slot::x",
      effort: "high",
    });
  });

  test("model locked: thinking-only write, record carries the decided tier then lock then effort", () => {
    const { input, spy } = build({ answers: good, launch: launch({ modelLocked: true }) });
    const r = routeLaunch(input) as Extract<Route, { kind: "routed" }>;
    expect(r).toEqual({
      kind: "routed",
      write: { thinking: "high" },
      record: { reason: "cut", tier: "balanced", locked: true, effort: "high" },
    });
    expect(Object.keys(r.record)).toEqual(["reason", "tier", "locked", "effort"]);
    expect(Object.keys(r.write)).toEqual(["thinking"]);
    expect(spy).toEqual({ models: [], thinkings: [], runs: [] });
  });

  test("model locked: effort is not clamped nor tier-capped (fast tier keeps high)", () => {
    const ans = read({ tier: ["fast", 0.9], effort: "max" });
    const { input } = build({ answers: ans, launch: launch({ modelLocked: true }) }, () => true, {
      reasoning: false,
    });
    const r = routeLaunch(input) as Extract<Route, { kind: "routed" }>;
    expect(r.write).toEqual({ thinking: "xhigh" });
  });

  test("model and thinking locked after a tier question never reach routing", () => {
    const { input } = build({
      answers: good,
      launch: launch({ modelLocked: true, thinkingLocked: true }),
    });
    expect(routeLaunch(input)).toEqual({ kind: "untouched", locked: true });
  });

  test("model locked, thinking free, no effort answer: empty write", () => {
    const { input } = build({
      answers: read({ tier: ["balanced", 0.9] }),
      launch: launch({ modelLocked: true }),
    });
    const r = routeLaunch(input) as Extract<Route, { kind: "routed" }>;
    expect(r.write).toEqual({});
    expect(Object.keys(r.record)).toEqual(["reason", "tier", "locked"]);
  });

  test("no tier question (nothing offered): thinking only, reason untouched", () => {
    const { input, spy } = build({ answers: read({ effort: "medium" }), offered: [] });
    const r = routeLaunch(input) as Extract<Route, { kind: "routed" }>;
    expect(r).toEqual({
      kind: "routed",
      write: { thinking: "medium" },
      record: { reason: "untouched", effort: "medium" },
    });
    expect(Object.keys(r.record)).toEqual(["reason", "effort"]);
    expect(spy).toEqual({ models: [], thinkings: [], runs: [] });
  });

  test("no tier question with model locked: locked sits before effort", () => {
    const { input } = build({
      answers: read({ effort: "medium" }),
      offered: [],
      launch: launch({ modelLocked: true }),
    });
    const r = routeLaunch(input) as Extract<Route, { kind: "routed" }>;
    expect(Object.keys(r.record)).toEqual(["reason", "locked", "effort"]);
  });

  test("forked thinking: thinking only; effort tier cap does not apply", () => {
    const { input } = build({
      answers: read({ tier: ["fast", 0.9], effort: "xhigh" }),
      launch: launch({ inheritContext: true }),
      forkedLaunch: "thinking",
    });
    const r = routeLaunch(input) as Extract<Route, { kind: "routed" }>;
    expect(r.write).toEqual({ thinking: "xhigh" });
    expect(r.record).toEqual({ reason: "untouched", effort: "xhigh" });
  });

  test("tier question with no decision: thinking-only, reason untouched", () => {
    const { input, spy } = build({ answers: read({ effort: "high" }) });
    const r = routeLaunch(input) as Extract<Route, { kind: "routed" }>;
    expect(r).toEqual({
      kind: "routed",
      write: { thinking: "high" },
      record: { reason: "untouched", effort: "high" },
    });
    expect(spy.runs).toEqual([]);
  });

  test("thinking-only with thinking locked and model free writes nothing", () => {
    const { input } = build({
      answers: read({ effort: "high" }),
      offered: [],
      slots: ["x"],
      launch: launch({ thinkingLocked: true }),
    });
    const r = routeLaunch(input) as Extract<Route, { kind: "routed" }>;
    expect(r.write).toEqual({});
    expect(r.record).toEqual({ reason: "untouched", locked: true });
  });

  test("thinking-only without an effort answer writes nothing", () => {
    const { input } = build({ answers: read({}), offered: [] });
    const r = routeLaunch(input) as Extract<Route, { kind: "routed" }>;
    expect(r).toEqual({ kind: "routed", write: {}, record: { reason: "untouched" } });
  });

  test("answers are read only after the launch gate (getter not touched when untouched)", () => {
    let reads = 0;
    const answers = {
      get kind(): never {
        reads++;
        throw new Error("answers read");
      },
    } as unknown as WorkerAnswers;
    const { input } = build({ answers, launch: launch({ inheritContext: true }) });
    expect(routeLaunch(input)).toEqual({ kind: "untouched" });
    expect(reads).toBe(0);
  });
});
