import { describe, expect, test } from "bun:test";

import type { Answer } from "../../src/policy/answers.ts";
import type { ModelThinking } from "../../src/policy/effort.ts";
import { TIER_LADDER, type EffectiveLaunch, type TierName } from "../../src/policy/launch.ts";
import {
  launchKind,
  routeLaunch,
  type ForkedLaunch,
  type Route,
  type RouteInput,
  type RouteReason,
} from "../../src/policy/route.ts";
import type { WorkerAnswers } from "../../src/policy/worker.ts";
import { validateLedgerEntry, type WorkerReason } from "../../src/store/ledger-schema.ts";

const _ok: (r: RouteReason) => WorkerReason = (r) => r;
void _ok;

const NO_EXPERT: readonly TierName[] = ["fast", "balanced", "deep"];

function launch(overrides: Partial<EffectiveLaunch> = {}): EffectiveLaunch {
  return {
    resume: false,
    inheritContext: false,
    runInBackground: false,
    modelLocked: false,
    thinkingLocked: false,
    ...overrides,
  };
}

function read(input: {
  tier?: [string, Record<string, number>];
  effort?: string;
  risky?: number;
  expertNeeded?: number;
}): WorkerAnswers {
  const out: Record<string, Answer> = {};
  const unanswered: Record<string, "missing"> = {};
  if (input.tier !== undefined) {
    const [choice, given] = input.tier;
    const probabilities: Record<string, number> = { fast: 0, balanced: 0, deep: 0, expert: 0 };
    for (const [k, v] of Object.entries(given)) probabilities[k] = v;
    out["tier"] = { type: "choice", choice, probabilities };
  } else unanswered["tier"] = "missing";
  if (input.effort !== undefined) {
    out["effort"] = {
      type: "choice",
      choice: input.effort,
      probabilities: { [input.effort]: 0.9 },
    };
  } else unanswered["effort"] = "missing";
  if (input.risky !== undefined) out["risky"] = { type: "noul", noul: input.risky };
  else unanswered["risky"] = "missing";
  if (input.expertNeeded !== undefined) {
    out["expert_needed"] = { type: "noul", noul: input.expertNeeded };
  } else unanswered["expert_needed"] = "missing";
  return { kind: "read", answers: out, unanswered };
}

function input(overrides: Partial<RouteInput> = {}): RouteInput {
  return {
    answers: read({}),
    launch: launch(),
    offered: NO_EXPERT,
    mode: "standard",
    forkedLaunch: "untouched",
    canRun: () => true,
    thinkingOf: (): ModelThinking => ({ reasoning: true }),
    modelOf: (t) => `fx/${t}`,
    ...overrides,
  };
}

function routed(r: Route): Extract<Route, { kind: "routed" }> {
  if (r.kind !== "routed") throw new Error(`expected routed, got ${r.kind}`);
  return r;
}

describe("launchKind", () => {
  const kind = (l: Partial<EffectiveLaunch>, offered = NO_EXPERT, f: ForkedLaunch = "untouched") =>
    launchKind(launch(l), offered, f);
  test("resume is untouched", () => {
    expect(kind({ resume: true })).toEqual({ kind: "untouched", locked: false });
  });
  test("forked untouched is untouched", () => {
    expect(kind({ inheritContext: true })).toEqual({ kind: "untouched", locked: false });
  });
  test("both locked is untouched and locked", () => {
    expect(kind({ modelLocked: true, thinkingLocked: true })).toEqual({
      kind: "untouched",
      locked: true,
    });
  });
  test("forked thinking with thinking locked is untouched", () => {
    expect(kind({ inheritContext: true, thinkingLocked: true }, NO_EXPERT, "thinking")).toEqual({
      kind: "untouched",
      locked: true,
    });
  });
  test("forked thinking asks without a tier question", () => {
    expect(kind({ inheritContext: true }, NO_EXPERT, "thinking")).toEqual({
      kind: "ask",
      tierQuestion: false,
      locked: false,
    });
  });
  test("no tier offered asks without a tier question", () => {
    expect(kind({}, [])).toEqual({ kind: "ask", tierQuestion: false, locked: false });
  });
  test("no tier offered with thinking locked is untouched", () => {
    expect(kind({ thinkingLocked: true }, [])).toEqual({ kind: "untouched", locked: true });
  });
  test("otherwise asks with a tier question", () => {
    expect(kind({ modelLocked: true })).toEqual({
      kind: "ask",
      tierQuestion: true,
      locked: true,
    });
  });
});

describe("Route result", () => {
  test("Locked flag", () => {
    const r = routed(
      routeLaunch(
        input({
          launch: launch({ thinkingLocked: true }),
          answers: read({ tier: ["balanced", { balanced: 0.9 }], effort: "high" }),
        }),
      ),
    );
    expect(r.record.locked).toBe(true);
  });
  test("Locked untouched launch", () => {
    const r = routeLaunch(input({ launch: launch({ modelLocked: true, thinkingLocked: true }) }));
    expect(r).toEqual({ kind: "untouched", locked: true });
  });
  test("No lock", () => {
    const r = routed(
      routeLaunch(input({ answers: read({ tier: ["balanced", { balanced: 0.9 }] }) })),
    );
    expect("locked" in r.record).toBe(false);
  });
});

describe("Launches left untouched", () => {
  test("Resume", () => {
    expect(routeLaunch(input({ answers: undefined, launch: launch({ resume: true }) }))).toEqual({
      kind: "untouched",
    });
  });
  test("Forked launch left alone", () => {
    const r = routeLaunch(input({ answers: undefined, launch: launch({ inheritContext: true }) }));
    expect(r).toEqual({ kind: "untouched" });
  });
  test("Both fields locked", () => {
    const l = launch({ modelLocked: true, thinkingLocked: true });
    expect(routeLaunch(input({ answers: undefined, launch: l }))).toEqual({
      kind: "untouched",
      locked: true,
    });
  });
  test("Forked thinking with thinking locked", () => {
    const r = routeLaunch(
      input({
        answers: undefined,
        launch: launch({ inheritContext: true, thinkingLocked: true }),
        forkedLaunch: "thinking",
      }),
    );
    expect(r).toEqual({ kind: "untouched", locked: true });
  });
  test("Missing answers on an asked launch skip", () => {
    expect(routeLaunch(input({ answers: undefined }))).toEqual({ kind: "skip" });
  });
});

describe("Route on Jev failure", () => {
  test("Cancelled", () => {
    expect(routeLaunch(input({ answers: { kind: "cancelled" } }))).toEqual({ kind: "skip" });
  });
  test("Miss", () => {
    const r = routeLaunch(input({ answers: { kind: "miss", miss: "timeout" } }));
    expect(r).toEqual({ kind: "routed", write: {}, record: { reason: "miss" } });
  });
});

describe("Route writes thinking only", () => {
  test("Forked launch with thinking", () => {
    const r = routeLaunch(
      input({
        launch: launch({ inheritContext: true }),
        forkedLaunch: "thinking",
        answers: read({ effort: "medium", risky: 0.9 }),
      }),
    );
    expect(r).toEqual({
      kind: "routed",
      write: { thinking: "high" },
      record: { reason: "untouched", effort: "high" },
    });
  });
  test("No tier offered", () => {
    const r = routeLaunch(input({ offered: [], answers: read({ effort: "max" }) }));
    expect(r).toEqual({
      kind: "routed",
      write: { thinking: "xhigh" },
      record: { reason: "untouched", effort: "xhigh" },
    });
  });
  test("No tier decided", () => {
    const r = routeLaunch(input({ answers: read({ risky: 0.2, effort: "medium" }) }));
    expect(r).toEqual({
      kind: "routed",
      write: { thinking: "medium" },
      record: { reason: "untouched", effort: "medium" },
    });
  });
  test("No effort answer", () => {
    const r = routeLaunch(input({ answers: read({ risky: 0.2 }) }));
    expect(r).toEqual({ kind: "routed", write: {}, record: { reason: "untouched" } });
  });
  test("No tier decided with thinking locked", () => {
    const r = routeLaunch(
      input({ launch: launch({ thinkingLocked: true }), answers: read({ effort: "high" }) }),
    );
    expect(r).toEqual({
      kind: "routed",
      write: {},
      record: { reason: "untouched", locked: true },
    });
  });
});

describe("Routed launch", () => {
  test("Chosen tier written", () => {
    const r = routeLaunch(
      input({
        answers: read({ tier: ["balanced", { balanced: 0.95 }], effort: "high" }),
      }),
    );
    expect(r).toEqual({
      kind: "routed",
      write: { model: "fx/balanced", thinking: "high" },
      record: { reason: "choice", tier: "balanced", effort: "high" },
    });
  });
  test("Clamped to the model", () => {
    const r = routeLaunch(
      input({
        answers: read({ tier: ["balanced", { balanced: 0.95 }], effort: "xhigh" }),
      }),
    );
    expect(r).toEqual({
      kind: "routed",
      write: { model: "fx/balanced", thinking: "high" },
      record: { reason: "choice", tier: "balanced", effort: "high" },
    });
  });
  test("Cascade with xhigh", () => {
    const r = routeLaunch(
      input({
        answers: read({ tier: ["deep", { deep: 0.95 }], effort: "low" }),
        canRun: (t) => t !== "deep",
        thinkingOf: (t) => (t === "balanced" ? { reasoning: true } : undefined),
      }),
    );
    expect(r).toEqual({
      kind: "routed",
      write: { model: "fx/balanced", thinking: "high" },
      record: { reason: "choice", tier: "balanced", fallback: "deep", effort: "high" },
    });
  });
});

describe("Nothing can run", () => {
  test("All lower tiers unusable", () => {
    const r = routeLaunch(
      input({
        answers: read({ tier: ["balanced", { balanced: 0.95 }], effort: "high" }),
        canRun: (t) => t === "deep",
      }),
    );
    expect(r).toEqual({
      kind: "routed",
      write: {},
      record: { reason: "choice", tier: "balanced", fallback: "balanced" },
    });
  });
  test("Expert never a cascade target", () => {
    const r = routeLaunch(
      input({
        offered: TIER_LADDER,
        answers: read({ tier: ["fast", { fast: 0.9 }], risky: 0.9, effort: "high" }),
        canRun: (t) => t === "expert",
      }),
    );
    expect(r).toEqual({
      kind: "routed",
      write: {},
      record: { reason: "risky", tier: "deep", fallback: "deep" },
    });
  });
});

describe("Locks in the route", () => {
  test("Model locked", () => {
    const r = routeLaunch(
      input({
        launch: launch({ modelLocked: true }),
        answers: read({ tier: ["fast", { fast: 0.9 }], effort: "high" }),
      }),
    );
    expect(r).toEqual({
      kind: "routed",
      write: { thinking: "high" },
      record: { reason: "choice", tier: "fast", effort: "high", locked: true },
    });
  });
  test("Model locked without a decided tier", () => {
    const r = routeLaunch(input({ launch: launch({ modelLocked: true }), answers: read({}) }));
    expect(r).toEqual({
      kind: "routed",
      write: {},
      record: { reason: "untouched", locked: true },
    });
  });
  test("Thinking locked", () => {
    const r = routeLaunch(
      input({
        launch: launch({ thinkingLocked: true }),
        answers: read({ tier: ["fast", { fast: 0.9 }], effort: "high" }),
      }),
    );
    expect(r).toEqual({
      kind: "routed",
      write: { model: "fx/fast" },
      record: { reason: "choice", tier: "fast", locked: true },
    });
  });
});

describe("Recorded results", () => {
  test("Recorded results validate", () => {
    const reasons: Record<RouteReason, Route> = {
      choice: routeLaunch(input({ answers: read({ tier: ["balanced", { balanced: 0.9 }] }) })),
      risky: routeLaunch(input({ answers: read({ risky: 0.9 }) })),
      "fast-unsure": routeLaunch(input({ answers: read({ tier: ["fast", { fast: 0.4 }] }) })),
      "expert-denied": routeLaunch(
        input({ answers: read({ tier: ["expert", { expert: 0.9 }] }), offered: TIER_LADDER }),
      ),
      "expert-admitted": routeLaunch(
        input({
          answers: read({ tier: ["expert", { expert: 0.9 }], expertNeeded: 0.95 }),
          offered: TIER_LADDER,
        }),
      ),
      untouched: routeLaunch(input({ answers: read({ risky: 0.2 }) })),
      miss: routeLaunch(input({ answers: { kind: "miss", miss: "timeout" } })),
    };
    for (const [reason, route] of Object.entries(reasons)) {
      const r = routed(route);
      expect(r.record.reason).toBe(reason as RouteReason);
      const line = {
        v: 1,
        at: 1,
        kind: "worker",
        session: "s1",
        mode: "standard",
        answered: reason !== "miss",
        ...(reason === "miss" ? { miss: "timeout" } : {}),
        agent: "scout",
        briefChars: 10,
        status: "completed",
        ...r.record,
      };
      const result = validateLedgerEntry(line);
      expect(result.ok).toBe(true);
    }
  });
});
