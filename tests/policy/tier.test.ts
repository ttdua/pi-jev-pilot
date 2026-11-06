import { describe, expect, test } from "bun:test";

import type { Answer } from "../../src/policy/answers.ts";
import { TIER_LADDER, type TierName } from "../../src/policy/launch.ts";
import {
  chooseFallback,
  decideTier,
  type FallbackResult,
  type TierDecision,
} from "../../src/policy/tier.ts";
import type { WorkerAnswers } from "../../src/policy/worker.ts";

const ALL: readonly TierName[] = TIER_LADDER;

function answers(input: {
  tier?: [string, Record<string, number>];
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
  if (input.risky !== undefined) out["risky"] = { type: "noul", noul: input.risky };
  else unanswered["risky"] = "missing";
  if (input.expertNeeded !== undefined) {
    out["expert_needed"] = { type: "noul", noul: input.expertNeeded };
  } else unanswered["expert_needed"] = "missing";
  return { kind: "read", answers: out, unanswered };
}

function decided(tier: TierName, reason: Extract<TierDecision, { kind: "decided" }>["reason"]) {
  return { kind: "decided", tier, reason } satisfies TierDecision;
}

describe("Decision order", () => {
  test("Ordinary choice", () => {
    const a = answers({ tier: ["deep", { deep: 0.8 }], risky: 0.1 });
    expect(decideTier(a, ALL)).toEqual(decided("deep", "choice"));
  });
});

describe("Fable rule", () => {
  test("Fable passes", () => {
    const a = answers({ tier: ["expert", { expert: 0.9 }], expertNeeded: 0.95 });
    expect(decideTier(a, ALL)).toEqual(decided("expert", "fable"));
  });
  test("Fable boundary", () => {
    const a = answers({ tier: ["expert", { expert: 0.9 }], expertNeeded: 0.9 });
    expect(decideTier(a, ALL)).toEqual(decided("deep", "expert-denied"));
  });
  test("Expert stands on high risk", () => {
    const a = answers({ tier: ["expert", { expert: 0.9 }], expertNeeded: 0.95, risky: 0.9 });
    expect(decideTier(a, ALL)).toEqual(decided("expert", "fable"));
  });
});

describe("Risk floor rule", () => {
  test("Risk floor", () => {
    const a = answers({ tier: ["fast", { fast: 0.9 }], risky: 0.71 });
    expect(decideTier(a, ALL)).toEqual(decided("deep", "risky"));
  });
  test("Risk boundary", () => {
    const a = answers({ tier: ["balanced", { balanced: 0.8 }], risky: 0.7 });
    expect(decideTier(a, ALL)).toEqual(decided("balanced", "choice"));
  });
  test("Risk floor without deep", () => {
    const a = answers({ tier: ["fast", { fast: 0.9 }], risky: 0.9 });
    expect(decideTier(a, ["fast", "balanced"])).toEqual(decided("balanced", "risky"));
  });
});

describe("Expert denied rule", () => {
  test("Expert denied without deep", () => {
    const a = answers({ tier: ["expert", { expert: 0.9 }], expertNeeded: 0.5 });
    expect(decideTier(a, ["balanced", "expert"])).toEqual(decided("balanced", "expert-denied"));
  });
});

describe("Unsure fast rule", () => {
  test("Fast sure", () => {
    const a = answers({ tier: ["fast", { fast: 0.6 }] });
    expect(decideTier(a, ALL)).toEqual(decided("fast", "choice"));
  });
  test("Fast unsure", () => {
    const a = answers({ tier: ["fast", { fast: 0.59 }] });
    expect(decideTier(a, ALL)).toEqual(decided("balanced", "fast-unsure"));
  });
});

describe("Partial answers in the decision", () => {
  test("Risk floor without a tier answer", () => {
    expect(decideTier(answers({ risky: 0.9 }), ["deep"])).toEqual(decided("deep", "risky"));
  });
  test("Expert needed unanswered", () => {
    const a = answers({ tier: ["expert", { expert: 0.9 }] });
    expect(decideTier(a, ["deep"])).toEqual(decided("deep", "expert-denied"));
  });
  test("No tier answer", () => {
    expect(decideTier(answers({ risky: 0.2 }), ALL)).toEqual({ kind: "none" });
  });
  test("No tier offered", () => {
    const a = answers({ tier: ["deep", { deep: 0.8 }], risky: 0.9 });
    expect(decideTier(a, [])).toEqual({ kind: "none" });
  });
  test("Every answer unanswered", () => {
    expect(decideTier(answers({}), ALL)).toEqual({ kind: "none" });
  });
});

describe("Rules without a qualifying tier", () => {
  test("Risk floor with only fast", () => {
    const a = answers({ tier: ["fast", { fast: 0.9 }], risky: 0.9 });
    expect(decideTier(a, ["fast"])).toEqual(decided("fast", "risky"));
  });
  test("Fast unsure without a higher tier", () => {
    const a = answers({ tier: ["fast", { fast: 0.4 }] });
    expect(decideTier(a, ["fast"])).toEqual(decided("fast", "choice"));
  });
  test("Only expert offered and denied", () => {
    const a = answers({ tier: ["expert", { expert: 0.9 }], expertNeeded: 0.5 });
    expect(decideTier(a, ["expert"])).toEqual({ kind: "none" });
  });
});

describe("Decision on Jev failure", () => {
  test("Jev failure", () => {
    expect(decideTier({ kind: "miss", miss: "timeout" }, ALL)).toEqual({
      kind: "none",
      reason: "miss",
    });
  });
  test("Cancelled", () => {
    const result = decideTier({ kind: "cancelled" }, ALL);
    expect(result).toEqual({ kind: "none" });
    expect("reason" in result).toBe(false);
  });
});

function runs(...ok: TierName[]): (t: TierName) => boolean {
  return (t) => ok.includes(t);
}

describe("Fallback choice", () => {
  const cases: [string, TierName, readonly TierName[], TierName[], FallbackResult][] = [
    ["Target usable", "deep", ALL, ["deep"], { kind: "keep", tier: "deep" }],
    ["Usable expert kept", "expert", ALL, ["expert"], { kind: "keep", tier: "expert" }],
    ["Move down", "deep", ALL, ["balanced"], { kind: "moved", tier: "balanced", from: "deep" }],
    [
      "Skip an unusable lower tier",
      "deep",
      ALL,
      ["fast"],
      { kind: "moved", tier: "fast", from: "deep" },
    ],
    [
      "Unoffered tier skipped",
      "deep",
      ["fast", "deep"],
      ["balanced", "fast"],
      { kind: "moved", tier: "fast", from: "deep" },
    ],
    [
      "Expert never a target",
      "expert",
      ALL,
      ["deep", "balanced", "fast"],
      { kind: "moved", tier: "deep", from: "expert" },
    ],
    ["Fast cannot run", "fast", ALL, [], { kind: "unchanged" }],
    ["Nothing can run", "balanced", ALL, ["deep", "expert"], { kind: "unchanged" }],
  ];
  for (const [name, tier, offered, ok, expected] of cases) {
    test(name, () => {
      expect(chooseFallback(tier, offered, runs(...ok))).toEqual(expected);
    });
  }
});
