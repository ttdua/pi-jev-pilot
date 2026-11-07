import { describe, expect, test } from "bun:test";

import type { Answer } from "../../src/policy/answers.ts";
import { TIER_LADDER, type Target, type TierName } from "../../src/policy/launch.ts";
import { MODE_NAMES } from "../../src/policy/modes.ts";
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
  effort?: string;
}): WorkerAnswers {
  const out: Record<string, Answer> = {};
  const unanswered: Record<string, "missing"> = {};
  if (input.tier !== undefined) {
    const [choice, given] = input.tier;
    const probabilities: Record<string, number> = {};
    const keys = Object.keys(given);
    if (!keys.some((k) => k.startsWith("slot::"))) {
      Object.assign(probabilities, { fast: 0, balanced: 0, deep: 0, expert: 0 });
    }
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

function decided(tier: Target, reason: Extract<TierDecision, { kind: "decided" }>["reason"]) {
  return { kind: "decided", tier, reason } satisfies TierDecision;
}

describe("Decision order", () => {
  test("Ordinary choice", () => {
    const a = answers({ tier: ["deep", { deep: 0.8 }], risky: 0.1 });
    expect(decideTier(a, ALL, "standard")).toEqual(decided("deep", "choice"));
  });
});

describe("Expert admitted rule", () => {
  test("Expert admitted in standard", () => {
    const a = answers({ tier: ["expert", { expert: 0.9 }], expertNeeded: 0.95 });
    expect(decideTier(a, ALL, "standard")).toEqual(decided("expert", "expert-admitted"));
  });
  test("Standard boundary", () => {
    const a = answers({ tier: ["expert", { expert: 0.9 }], expertNeeded: 0.9 });
    expect(decideTier(a, ALL, "standard")).toEqual(decided("deep", "expert-denied"));
  });
  test("Expert stands on high risk", () => {
    const a = answers({ tier: ["expert", { expert: 0.9 }], expertNeeded: 0.95, risky: 0.9 });
    expect(decideTier(a, ALL, "standard")).toEqual(decided("expert", "expert-admitted"));
  });
  test("Same answers, different modes", () => {
    const a = answers({
      tier: ["deep", { deep: 0.7, expert: 0.2 }],
      effort: "xhigh",
      expertNeeded: 0.3,
      risky: 0.1,
    });
    expect(decideTier(a, ALL, "budget")).toEqual(decided("deep", "choice"));
    expect(decideTier(a, ALL, "standard")).toEqual(decided("deep", "choice"));
    expect(decideTier(a, ALL, "premium")).toEqual(decided("expert", "expert-admitted"));
  });
  test("Premium admits from deep on high risk", () => {
    const a = answers({
      tier: ["deep", { deep: 0.7, expert: 0.3 }],
      effort: "max",
      risky: 0.9,
    });
    expect(decideTier(a, ALL, "premium")).toEqual(decided("expert", "expert-admitted"));
  });
  test("Premium gate passes but expert not offered", () => {
    const a = answers({ tier: ["deep", { deep: 0.7, expert: 0.3 }], effort: "max" });
    expect(decideTier(a, ["fast", "balanced", "deep"], "premium")).toEqual(
      decided("deep", "choice"),
    );
  });
  test("Premium denies expert on low effort", () => {
    const a = answers({
      tier: ["expert", { expert: 0.6 }],
      effort: "high",
      expertNeeded: 0.99,
    });
    expect(decideTier(a, ALL, "premium")).toEqual(decided("deep", "expert-denied"));
  });
  test("Effort unanswered in premium", () => {
    const a = answers({ tier: ["expert", { expert: 0.8 }] });
    expect(decideTier(a, ["deep", "expert"], "premium")).toEqual(decided("deep", "expert-denied"));
  });
});

type Cell = [TierName, "expert-admitted" | "risky" | "expert-denied" | "fast-unsure" | "choice"];
const ROWS: { name: string; answers: WorkerAnswers; standard: Cell; premium: Cell }[] = [
  {
    name: "expert, sure, high effort",
    answers: answers({ tier: ["expert", { expert: 0.8 }], expertNeeded: 0.95, effort: "high" }),
    standard: ["expert", "expert-admitted"],
    premium: ["deep", "expert-denied"],
  },
  {
    name: "expert, sure, max effort",
    answers: answers({ tier: ["expert", { expert: 0.8 }], expertNeeded: 0.95, effort: "max" }),
    standard: ["expert", "expert-admitted"],
    premium: ["expert", "expert-admitted"],
  },
  {
    name: "deep with P(expert) .3, xhigh",
    answers: answers({
      tier: ["deep", { deep: 0.7, expert: 0.3 }],
      effort: "xhigh",
      expertNeeded: 0.2,
    }),
    standard: ["deep", "choice"],
    premium: ["expert", "expert-admitted"],
  },
  {
    name: "deep with P(expert) .05, max",
    answers: answers({ tier: ["deep", { deep: 0.95, expert: 0.05 }], effort: "max" }),
    standard: ["deep", "choice"],
    premium: ["deep", "choice"],
  },
  {
    name: "balanced, risky, max",
    answers: answers({ tier: ["balanced", { balanced: 0.9 }], risky: 0.9, effort: "max" }),
    standard: ["deep", "risky"],
    premium: ["deep", "risky"],
  },
  {
    name: "expert, not needed, medium",
    answers: answers({ tier: ["expert", { expert: 0.8 }], expertNeeded: 0.5, effort: "medium" }),
    standard: ["deep", "expert-denied"],
    premium: ["deep", "expert-denied"],
  },
  {
    name: "fast unsure",
    answers: answers({ tier: ["fast", { fast: 0.55 }] }),
    standard: ["balanced", "fast-unsure"],
    premium: ["balanced", "fast-unsure"],
  },
  {
    name: "fast sure",
    answers: answers({ tier: ["fast", { fast: 0.9 }] }),
    standard: ["fast", "choice"],
    premium: ["fast", "choice"],
  },
  {
    name: "balanced, low risk",
    answers: answers({ tier: ["balanced", { balanced: 0.9 }], risky: 0.1 }),
    standard: ["balanced", "choice"],
    premium: ["balanced", "choice"],
  },
];

describe("Table per mode", () => {
  for (const row of ROWS) {
    for (const mode of ["budget", "standard", "premium"] as const) {
      test(`${row.name} in ${mode}`, () => {
        const [tier, reason] = mode === "premium" ? row.premium : row.standard;
        expect(decideTier(row.answers, ALL, mode)).toEqual(decided(tier, reason));
      });
    }
  }
});

describe("Risk floor rule", () => {
  test("Risk floor", () => {
    const a = answers({ tier: ["fast", { fast: 0.9 }], risky: 0.71 });
    expect(decideTier(a, ALL, "standard")).toEqual(decided("deep", "risky"));
  });
  test("Risk boundary", () => {
    const a = answers({ tier: ["balanced", { balanced: 0.8 }], risky: 0.7 });
    expect(decideTier(a, ALL, "standard")).toEqual(decided("balanced", "choice"));
  });
  test("Risk floor without deep", () => {
    const a = answers({ tier: ["fast", { fast: 0.9 }], risky: 0.9 });
    expect(decideTier(a, ["fast", "balanced"], "standard")).toEqual(decided("balanced", "risky"));
  });
});

describe("Expert denied rule", () => {
  test("Expert denied without deep", () => {
    const a = answers({ tier: ["expert", { expert: 0.9 }], expertNeeded: 0.5 });
    expect(decideTier(a, ["balanced", "expert"], "standard")).toEqual(
      decided("balanced", "expert-denied"),
    );
  });
});

describe("Unsure fast rule", () => {
  test("Fast sure", () => {
    const a = answers({ tier: ["fast", { fast: 0.6 }] });
    expect(decideTier(a, ALL, "standard")).toEqual(decided("fast", "choice"));
  });
  test("Fast unsure", () => {
    const a = answers({ tier: ["fast", { fast: 0.59 }] });
    expect(decideTier(a, ALL, "standard")).toEqual(decided("balanced", "fast-unsure"));
  });
});

describe("Partial answers in the decision", () => {
  test("Risk floor without a tier answer", () => {
    expect(decideTier(answers({ risky: 0.9 }), ["deep"], "standard")).toEqual(
      decided("deep", "risky"),
    );
  });
  test("Expert needed unanswered", () => {
    const a = answers({ tier: ["expert", { expert: 0.9 }] });
    expect(decideTier(a, ["deep"], "standard")).toEqual(decided("deep", "expert-denied"));
  });
  test("No tier answer", () => {
    expect(decideTier(answers({ risky: 0.2 }), ALL, "standard")).toEqual({ kind: "none" });
  });
  test("No tier offered", () => {
    const a = answers({ tier: ["deep", { deep: 0.8 }], risky: 0.9 });
    expect(decideTier(a, [], "standard")).toEqual({ kind: "none" });
  });
  test("Every answer unanswered", () => {
    expect(decideTier(answers({}), ALL, "standard")).toEqual({ kind: "none" });
  });
});

describe("Rules without a qualifying tier", () => {
  test("Risk floor with only fast", () => {
    const a = answers({ tier: ["fast", { fast: 0.9 }], risky: 0.9 });
    expect(decideTier(a, ["fast"], "standard")).toEqual(decided("fast", "risky"));
  });
  test("Fast unsure without a higher tier", () => {
    const a = answers({ tier: ["fast", { fast: 0.4 }] });
    expect(decideTier(a, ["fast"], "standard")).toEqual(decided("fast", "choice"));
  });
  test("Only expert offered and denied", () => {
    const a = answers({ tier: ["expert", { expert: 0.9 }], expertNeeded: 0.5 });
    expect(decideTier(a, ["expert"], "standard")).toEqual({ kind: "none" });
  });
});

describe("Slot rule", () => {
  const R = ["reviewer"];
  const slotAt = (p: number, rest: Record<string, number> = {}) =>
    answers({ tier: ["slot::reviewer", { "slot::reviewer": p, ...rest }] });

  test("Slot at the bar", () => {
    expect(decideTier(slotAt(0.6), ALL, "standard", R)).toEqual(decided("slot::reviewer", "slot"));
  });
  test("Risk wins over a slot", () => {
    const a = answers({ tier: ["slot::reviewer", { "slot::reviewer": 0.95 }], risky: 0.8 });
    expect(decideTier(a, ALL, "standard", R)).toEqual(decided("deep", "risky"));
  });
  test("Risk floor with only a slot", () => {
    const a = answers({ tier: ["slot::reviewer", { "slot::reviewer": 0.95 }], risky: 0.9 });
    expect(decideTier(a, [], "standard", R)).toEqual(decided("slot::reviewer", "slot"));
  });
  test("Two slots", () => {
    const a = answers({ tier: ["slot::bulk", { "slot::bulk": 0.7, "slot::reviewer": 0.1 }] });
    expect(decideTier(a, ALL, "standard", ["reviewer", "bulk"])).toEqual(
      decided("slot::bulk", "slot"),
    );
  });
  test("Slot below the bar", () => {
    const a = slotAt(0.5, { balanced: 0.3, deep: 0.15, fast: 0.05 });
    expect(decideTier(a, ALL, "standard", R)).toEqual(decided("balanced", "choice"));
  });
  test("Below the bar into unsure fast", () => {
    const a = slotAt(0.55, { fast: 0.4, balanced: 0.05 });
    expect(decideTier(a, ALL, "standard", R)).toEqual(decided("balanced", "fast-unsure"));
  });
  test("Below the bar into expert denied", () => {
    const a = slotAt(0.5, { expert: 0.3, deep: 0.1 });
    expect(decideTier(a, ALL, "standard", R)).toEqual(decided("deep", "expert-denied"));
  });
  test("Slot not offered", () => {
    const a = answers({ tier: ["slot::old", { "slot::old": 0.9, balanced: 0.08 }] });
    expect(decideTier(a, ALL, "standard", [])).toEqual(decided("balanced", "choice"));
  });
  test("Slot choice never passes the standard expert gate", () => {
    const a = answers({
      tier: ["slot::reviewer", { "slot::reviewer": 0.5, expert: 0.3, deep: 0.1 }],
      expertNeeded: 0.95,
    });
    expect(decideTier(a, ALL, "standard", R)).toEqual(decided("deep", "expert-denied"));
  });
  test("Slot choice never passes the premium expert gate", () => {
    const a = answers({
      tier: ["slot::reviewer", { "slot::reviewer": 0.5, expert: 0.3, deep: 0.1 }],
      effort: "max",
    });
    expect(decideTier(a, ALL, "premium", R)).toEqual(decided("deep", "expert-denied"));
  });
  test("Slot probability missing", () => {
    const a = answers({ tier: ["slot::reviewer", { balanced: 0.2 }] });
    expect(decideTier(a, ALL, "standard", R)).toEqual(decided("balanced", "choice"));
  });
  test("Below-the-bar tie", () => {
    const a = slotAt(0.5, { fast: 0.2, balanced: 0.2 });
    expect(decideTier(a, ALL, "standard", R)).toEqual(decided("balanced", "fast-unsure"));
  });
  test("Slot below the bar, no tier offered", () => {
    expect(decideTier(slotAt(0.5), [], "standard", R)).toEqual({ kind: "none" });
  });
  for (const mode of MODE_NAMES) {
    test(`Slot in every mode: ${mode}`, () => {
      const a = answers({
        tier: ["slot::reviewer", { "slot::reviewer": 0.92 }],
        effort: "max",
        risky: 0.1,
      });
      expect(decideTier(a, ALL, mode, R)).toEqual(decided("slot::reviewer", "slot"));
    });
  }
  test("A slot target never falls back yet", () => {
    expect(chooseFallback("slot::reviewer", ALL, () => true)).toEqual({ kind: "unchanged" });
  });
});

describe("Decision on Jev failure", () => {
  test("Jev failure", () => {
    expect(decideTier({ kind: "miss", miss: "timeout" }, ALL, "standard")).toEqual({
      kind: "none",
      reason: "miss",
    });
  });
  test("Cancelled", () => {
    const result = decideTier({ kind: "cancelled" }, ALL, "standard");
    expect(result).toEqual({ kind: "none" });
    expect("reason" in result).toBe(false);
  });
});

function runs(...ok: TierName[]): (t: Target) => boolean {
  return (t) => ok.includes(t as TierName);
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
