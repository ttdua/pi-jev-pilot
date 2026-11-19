import { describe, expect, test } from "bun:test";

import type { Answer } from "../../../src/policy/answers.ts";
import type { ModelThinking } from "../../../src/policy/effort.ts";
import {
  TIER_LADDER,
  effectiveLaunch,
  type EffectiveLaunch,
  type Target,
  type TierName,
} from "../../../src/policy/launch.ts";
import {
  launchKind,
  routeLaunch,
  type ForkLaunch,
  type Route,
  type RouteInput,
  type RouteReason,
} from "../../../src/policy/worker/route.ts";
import type { WorkerAnswers } from "../../../src/policy/worker/answers.ts";
import { validateLedgerEntry, type WorkerReason } from "../../../src/store/ledger-schema.ts";

const _ok: (r: RouteReason) => WorkerReason = (r) => r;
void _ok;

const NO_EXPERT: readonly TierName[] = ["basic", "broad", "deep"];

// Fixed cuts, independent of the shipped seed: score 0 → basic, 1 → broad, 2 → deep, 3 → frontier.
const CUTS = { basicMax: 0.9, broadMax: 1.5, frontierMin: 2.5 };

function launch(overrides: Partial<EffectiveLaunch> = {}): EffectiveLaunch {
  return {
    context: "fresh",
    runInBackground: false,
    modelLocked: false,
    thinkingLocked: false,
    ...overrides,
  };
}

type LaunchReq = Parameters<typeof effectiveLaunch>[0];

/** A service launch request as the policy sees it; override any field. */
function serviceRequest(over: Partial<LaunchReq> = {}): LaunchReq {
  return {
    origin: { kind: "service" },
    callerNamedModel: false,
    context: "fresh",
    isBackground: false,
    locked: [],
    ...over,
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
    const probabilities: Record<string, number> = {
      basic: 0,
      broad: 0,
      deep: 0,
      frontier: 0,
    };
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
    cuts: CUTS,
    forkLaunch: "untouched",
    canRun: () => true,
    thinkingOf: (): ModelThinking => ({ reasoning: true }),
    modelOf: (t) => `fx/${t}`,
    slots: [],
    ...overrides,
  };
}

function routed(r: Route): Extract<Route, { kind: "routed" }> {
  if (r.kind !== "routed") throw new Error(`expected routed, got ${r.kind}`);
  return r;
}

describe("launchKind", () => {
  const kind = (l: Partial<EffectiveLaunch>, offered = NO_EXPERT, f: ForkLaunch = "untouched") =>
    launchKind(launch(l), offered, f);
  test("Slot alone with thinking locked", () => {
    expect(launchKind(launch({ thinkingLocked: true }), [], "untouched", 1)).toEqual({
      kind: "ask",
      tierQuestion: true,
      locked: true,
    });
  });
  test("forked untouched is untouched", () => {
    expect(kind({ context: "fork" })).toEqual({
      kind: "untouched",
      locked: false,
    });
  });
  test("both locked is untouched and locked", () => {
    expect(kind({ modelLocked: true, thinkingLocked: true })).toEqual({
      kind: "untouched",
      locked: true,
    });
  });
  test("forked thinking with thinking locked is untouched", () => {
    expect(kind({ context: "fork", thinkingLocked: true }, NO_EXPERT, "thinking")).toEqual({
      kind: "untouched",
      locked: true,
    });
  });
  test("forked thinking asks without a tier question", () => {
    expect(kind({ context: "fork" }, NO_EXPERT, "thinking")).toEqual({
      kind: "ask",
      tierQuestion: false,
      locked: false,
    });
  });
  test("no tier offered asks without a tier question", () => {
    expect(kind({}, [])).toEqual({
      kind: "ask",
      tierQuestion: false,
      locked: false,
    });
  });
  test("no tier offered with thinking locked is untouched", () => {
    expect(kind({ thinkingLocked: true }, [])).toEqual({
      kind: "untouched",
      locked: true,
    });
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
  test("Service launch naming a model", () => {
    const l = effectiveLaunch(serviceRequest({ callerNamedModel: true }));
    const r = routed(
      routeLaunch(input({ launch: l, answers: read({ tier: ["broad", { broad: 0.9 }] }) })),
    );
    expect(r.record.locked).toBe(true);
  });
  test("Locked flag", () => {
    const r = routed(
      routeLaunch(
        input({
          launch: launch({ thinkingLocked: true }),
          answers: read({
            tier: ["broad", { broad: 0.9 }],
            effort: "high",
          }),
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
    const r = routed(routeLaunch(input({ answers: read({ tier: ["broad", { broad: 0.9 }] }) })));
    expect("locked" in r.record).toBe(false);
  });
});

describe("Launches left untouched", () => {
  test("Resume", () => {
    // A resume never reaches the launch policy, so the effective launch has no resume field and
    // nothing here can compute a route for one.
    const l = effectiveLaunch(serviceRequest({ origin: { kind: "tool", toolCallId: "c" } }));
    expect("resume" in l).toBe(false);
  });
  test("Forked launch left alone", () => {
    const r = routeLaunch(input({ answers: undefined, launch: launch({ context: "fork" }) }));
    expect(r).toEqual({ kind: "untouched" });
  });
  test("Service launch with a model and locked thinking", () => {
    const l = effectiveLaunch(serviceRequest({ callerNamedModel: true, locked: ["thinking"] }));
    expect(routeLaunch(input({ answers: undefined, launch: l }))).toEqual({
      kind: "untouched",
      locked: true,
    });
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
        launch: launch({ context: "fork", thinkingLocked: true }),
        forkLaunch: "thinking",
      }),
    );
    expect(r).toEqual({ kind: "untouched", locked: true });
  });
  test("Missing answers on an asked launch skip", () => {
    expect(routeLaunch(input({ answers: undefined }))).toEqual({
      kind: "skip",
    });
  });
});

describe("Route on Jev failure", () => {
  test("Cancelled", () => {
    expect(routeLaunch(input({ answers: { kind: "cancelled" } }))).toEqual({
      kind: "skip",
    });
  });
  test("Miss", () => {
    const r = routeLaunch(input({ answers: { kind: "miss", miss: "timeout" } }));
    expect(r).toEqual({
      kind: "routed",
      write: {},
      record: { reason: "miss" },
    });
  });
});

describe("Route writes thinking only", () => {
  test("Forked launch with thinking", () => {
    const r = routeLaunch(
      input({
        launch: launch({ context: "fork" }),
        forkLaunch: "thinking",
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
    expect(r).toEqual({
      kind: "routed",
      write: {},
      record: { reason: "untouched" },
    });
  });
  test("No tier decided with thinking locked", () => {
    const r = routeLaunch(
      input({
        launch: launch({ thinkingLocked: true }),
        answers: read({ effort: "high" }),
      }),
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
        answers: read({
          tier: ["broad", { broad: 0.95 }],
          effort: "high",
        }),
      }),
    );
    expect(r).toEqual({
      kind: "routed",
      write: { model: "fx/broad", thinking: "high" },
      record: { reason: "cut", tier: "broad", effort: "high" },
    });
  });
  test("Clamped to the model", () => {
    const r = routeLaunch(
      input({
        answers: read({
          tier: ["broad", { broad: 0.95 }],
          effort: "xhigh",
        }),
      }),
    );
    expect(r).toEqual({
      kind: "routed",
      write: { model: "fx/broad", thinking: "high" },
      record: { reason: "cut", tier: "broad", effort: "high" },
    });
  });
  test("Cascade with xhigh", () => {
    const r = routeLaunch(
      input({
        answers: read({ tier: ["deep", { deep: 0.95 }], effort: "low" }),
        cuts: { basicMax: 0.9, broadMax: 1.5, frontierMin: 2.5 },
        canRun: (t) => t !== "deep",
        thinkingOf: (t) => (t === "broad" ? { reasoning: true } : undefined),
      }),
    );
    expect(r).toEqual({
      kind: "routed",
      write: { model: "fx/broad", thinking: "high" },
      record: {
        reason: "cut",
        tier: "broad",
        fallback: "deep",
        effort: "high",
      },
    });
  });
});

describe("Nothing can run", () => {
  test("All lower tiers unusable", () => {
    const r = routeLaunch(
      input({
        answers: read({
          tier: ["broad", { broad: 0.95 }],
          effort: "high",
        }),
        canRun: (t) => t === "deep",
      }),
    );
    expect(r).toEqual({
      kind: "routed",
      write: {},
      record: { reason: "cut", tier: "broad", fallback: "broad" },
    });
  });
  test("Expert never a cascade target", () => {
    const r = routeLaunch(
      input({
        offered: TIER_LADDER,
        answers: read({
          tier: ["deep", { deep: 0.9 }],
          risky: 0.9,
          effort: "high",
        }),
        cuts: { basicMax: 0.9, broadMax: 1.5, frontierMin: 2.5 },
        canRun: (t) => t === "frontier",
      }),
    );
    expect(r).toEqual({
      kind: "routed",
      write: {},
      record: { reason: "cut", tier: "deep", fallback: "deep" },
    });
  });
});

describe("Locks in the route", () => {
  test("Service launch with a model", () => {
    const l = effectiveLaunch(serviceRequest({ callerNamedModel: true }));
    const r = routeLaunch(
      input({ launch: l, answers: read({ tier: ["basic", { basic: 0.9 }], effort: "high" }) }),
    );
    expect(r).toEqual({
      kind: "routed",
      write: { thinking: "high" },
      record: { reason: "cut", tier: "basic", effort: "high", locked: true },
    });
  });
  test("Model locked", () => {
    const r = routeLaunch(
      input({
        launch: launch({ modelLocked: true }),
        answers: read({ tier: ["basic", { basic: 0.9 }], effort: "high" }),
      }),
    );
    expect(r).toEqual({
      kind: "routed",
      write: { thinking: "high" },
      record: { reason: "cut", tier: "basic", effort: "high", locked: true },
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
        answers: read({ tier: ["basic", { basic: 0.9 }], effort: "high" }),
      }),
    );
    expect(r).toEqual({
      kind: "routed",
      write: { model: "fx/basic" },
      record: { reason: "cut", tier: "basic", locked: true },
    });
  });
});

const R = ["reviewer"];
const SLOT_PICK: [string, Record<string, number>] = ["slot::reviewer", { "slot::reviewer": 0.92 }];
const slotModels: Record<string, string> = {
  "slot::reviewer": "fixture/fixture-review",
  broad: "fx/broad",
};

function slotInput(overrides: Partial<RouteInput> = {}): RouteInput {
  return input({
    slots: R,
    modelOf: (t) => slotModels[t] ?? `fx/${t}`,
    ...overrides,
  });
}

describe("Slot routes", () => {
  test("Slot written", () => {
    const r = routeLaunch(slotInput({ answers: read({ tier: SLOT_PICK, effort: "high" }) }));
    expect(r).toEqual({
      kind: "routed",
      write: { model: "fixture/fixture-review", thinking: "high" },
      record: { reason: "slot", tier: "slot::reviewer", effort: "high" },
    });
  });
  test("Slot falls back with xhigh", () => {
    const r = routeLaunch(
      slotInput({
        answers: read({ tier: SLOT_PICK, effort: "low" }),
        canRun: (t: Target) => t !== "slot::reviewer",
        thinkingOf: (): ModelThinking => ({
          reasoning: true,
          thinkingLevelMap: { xhigh: "xhigh" },
        }),
      }),
    );
    expect(r).toEqual({
      kind: "routed",
      write: { model: "fx/broad", thinking: "xhigh" },
      record: {
        reason: "slot",
        tier: "broad",
        fallback: "slot::reviewer",
        effort: "xhigh",
      },
    });
  });
  test("Unusable slot alone", () => {
    const r = routeLaunch(
      slotInput({
        offered: [],
        answers: read({ tier: SLOT_PICK }),
        canRun: () => false,
      }),
    );
    expect(r).toEqual({
      kind: "routed",
      write: {},
      record: {
        reason: "slot",
        tier: "slot::reviewer",
        fallback: "slot::reviewer",
      },
    });
  });
  test("Slot below the bar with no tier", () => {
    const r = routeLaunch(
      slotInput({
        offered: [],
        answers: read({
          tier: ["slot::reviewer", { "slot::reviewer": 0.5 }],
          effort: "medium",
        }),
      }),
    );
    expect(r).toEqual({
      kind: "routed",
      write: { thinking: "medium" },
      record: { reason: "untouched", effort: "medium" },
    });
  });
  test("Model locked with a slot decided", () => {
    const r = routeLaunch(
      slotInput({
        launch: launch({ modelLocked: true }),
        answers: read({ tier: SLOT_PICK, effort: "high" }),
      }),
    );
    expect(r).toEqual({
      kind: "routed",
      write: { thinking: "high" },
      record: {
        reason: "slot",
        tier: "slot::reviewer",
        effort: "high",
        locked: true,
      },
    });
  });
});

describe("Recorded results", () => {
  test("Recorded results validate", () => {
    const reasons: Record<RouteReason, Route> = {
      cut: routeLaunch(input({ answers: read({ tier: ["broad", { broad: 0.9 }] }) })),
      frontier: routeLaunch(
        input({
          answers: read({ tier: ["frontier", { frontier: 0.9 }], effort: "xhigh" }),
          offered: TIER_LADDER,
        }),
      ),
      slot: routeLaunch(slotInput({ answers: read({ tier: SLOT_PICK }) })),
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
