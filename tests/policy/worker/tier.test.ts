import { describe, expect, test } from "bun:test";

import type { Answer } from "../../../src/policy/answers.ts";
import type { CutPoints } from "../../../src/policy/worker/cutpoints.ts";
import { EFFORT_LEVELS } from "../../../src/policy/effort.ts";
import { TIER_LADDER, type Target, type TierName } from "../../../src/policy/launch.ts";
import { difficultyScore } from "../../../src/policy/worker/score.ts";
import {
  chooseFallback,
  decideTier,
  type FallbackResult,
  type TierDecision,
} from "../../../src/policy/worker/tier.ts";
import type { WorkerAnswers } from "../../../src/policy/worker/answers.ts";

const ALL: readonly TierName[] = TIER_LADDER;
const NO_EXPERT: readonly TierName[] = ["basic", "broad", "deep"];

const BUDGET: CutPoints = {
  basicMax: 1.41,
  broadMax: 2.13,
  frontierMin: Infinity,
};
const STANDARD: CutPoints = {
  basicMax: 1.17,
  broadMax: 1.81,
  frontierMin: 2.34,
};
const PREMIUM: CutPoints = {
  basicMax: -Infinity,
  broadMax: 1.41,
  frontierMin: 2.12,
};

type Input = {
  tier?: [string, Record<string, number>];
  risky?: number;
  effort?: string;
};

function answers(input: Input): WorkerAnswers {
  const out: Record<string, Answer> = {};
  const unanswered: Record<string, "missing"> = {};
  if (input.tier !== undefined) {
    const [choice, given] = input.tier;
    const probabilities: Record<string, number> = {};
    if (!Object.keys(given).some((k) => k.startsWith("slot::"))) {
      Object.assign(probabilities, {
        basic: 0,
        broad: 0,
        deep: 0,
        frontier: 0,
      });
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
  return { kind: "read", answers: out, unanswered };
}

// Answers whose difficulty score is `score`: the expected tier rank is score minus the effort part.
function answersForScore(score: number, effort?: string, risky?: number): WorkerAnswers {
  const rank =
    effort === undefined ? EFFORT_LEVELS.indexOf("high") : EFFORT_LEVELS.indexOf(effort as never);
  const x = score - rank / 8;
  const r = Math.min(Math.floor(x), 2);
  const probs = { basic: 0, broad: 0, deep: 0, frontier: 0 };
  probs[TIER_LADDER[r] as TierName] = r + 1 - x;
  probs[TIER_LADDER[r + 1] as TierName] = x - r;
  const choice = TIER_LADDER[Math.round(x)] ?? "deep";
  return answers({
    tier: [choice, probs],
    ...(effort === undefined ? {} : { effort }),
    ...(risky === undefined ? {} : { risky }),
  });
}

function scoreOf(a: WorkerAnswers): number | undefined {
  return a.kind === "read" ? difficultyScore(a.answers) : undefined;
}

function decided(tier: Target, reason: Extract<TierDecision, { kind: "decided" }>["reason"]) {
  return { kind: "decided", tier, reason } satisfies TierDecision;
}

describe("Score helper", () => {
  test("answersForScore reproduces the score", () => {
    expect(scoreOf(answersForScore(2.4, "max"))).toBe(2.4);
    expect(scoreOf(answersForScore(1.17, "high"))).toBe(1.17);
    expect(scoreOf(answersForScore(0, "low"))).toBe(0);
    expect(scoreOf(answersForScore(3.4, "max"))).toBe(3.4);
  });
  test("a named tier mix gives 2.275", () => {
    expect(
      scoreOf(
        answers({
          tier: ["deep", { deep: 0.9, broad: 0.1 }],
          effort: "xhigh",
        }),
      ),
    ).toBe(2.275);
  });
});

describe("Decision order", () => {
  test("Ordinary choice", () => {
    expect(decideTier(answersForScore(1.3, "high", 0.1), ALL, STANDARD)).toEqual(
      decided("broad", "cut"),
    );
  });
  test("Same answers, different modes", () => {
    const a = answersForScore(2.2, "xhigh", 0.1);
    expect(decideTier(a, ALL, BUDGET)).toEqual(decided("deep", "cut"));
    expect(decideTier(a, ALL, STANDARD)).toEqual(decided("deep", "cut"));
    expect(decideTier(a, ALL, PREMIUM)).toEqual(decided("frontier", "frontier"));
  });
  test("Same score, different tiers", () => {
    const a = answersForScore(1.85, "high");
    const budget: CutPoints = {
      basicMax: 1.41,
      broadMax: 2.13,
      frontierMin: Infinity,
    };
    const premium: CutPoints = {
      basicMax: -Infinity,
      broadMax: 1.41,
      frontierMin: 2.12,
    };
    expect(decideTier(a, ALL, budget)).toEqual(decided("broad", "cut"));
    expect(decideTier(a, ALL, premium)).toEqual(decided("deep", "cut"));
  });
});

describe("Expert rule", () => {
  const cuts: CutPoints = { basicMax: 1.17, broadMax: 1.81, frontierMin: 2.3 };
  test("Expert by score and effort", () => {
    expect(decideTier(answersForScore(2.35, "xhigh"), ALL, cuts)).toEqual(
      decided("frontier", "frontier"),
    );
  });
  test("Expert at the cut", () => {
    expect(decideTier(answersForScore(2.3, "max"), ALL, cuts)).toEqual(
      decided("frontier", "frontier"),
    );
  });
  test("High effort is not enough", () => {
    expect(decideTier(answersForScore(2.4, "high"), ALL, cuts)).toEqual(decided("deep", "cut"));
  });
  test("Expert not offered", () => {
    expect(decideTier(answersForScore(2.4, "max"), NO_EXPERT, cuts)).toEqual(
      decided("deep", "cut"),
    );
  });
  test("Budget never reaches frontier", () => {
    expect(decideTier(answersForScore(3.4, "max"), ALL, BUDGET)).toEqual(decided("deep", "cut"));
  });
  test("frontier switched off gives frontierMin +Infinity and no frontier", () => {
    const off: CutPoints = {
      basicMax: 1.17,
      broadMax: 1.81,
      frontierMin: Infinity,
    };
    expect(decideTier(answersForScore(3.4, "max"), NO_EXPERT, off)).toEqual(decided("deep", "cut"));
  });
  test("Expert stands on high risk", () => {
    expect(decideTier(answersForScore(2.4, "max", 0.9), ALL, cuts)).toEqual(
      decided("frontier", "frontier"),
    );
  });
});

describe("Cut rule", () => {
  const cuts: CutPoints = {
    basicMax: 1.17,
    broadMax: 1.81,
    frontierMin: Infinity,
  };
  test("Fast at the cut", () => {
    expect(decideTier(answersForScore(1.17, "high"), ALL, cuts)).toEqual(decided("basic", "cut"));
  });
  test("Balanced", () => {
    expect(decideTier(answersForScore(1.5, "high"), ALL, cuts)).toEqual(decided("broad", "cut"));
  });
  test("Deep", () => {
    expect(decideTier(answersForScore(1.82, "high"), ALL, cuts)).toEqual(decided("deep", "cut"));
  });
  test("Premium never cuts to basic", () => {
    expect(decideTier(answersForScore(0, "low"), ALL, PREMIUM)).toEqual(decided("broad", "cut"));
  });
  test("Unoffered tier moves down", () => {
    expect(decideTier(answersForScore(1.5, "high"), ["basic", "deep"], cuts)).toEqual(
      decided("basic", "cut"),
    );
  });
  test("Unoffered tier moves up", () => {
    expect(decideTier(answersForScore(0.5, "high"), ["broad", "deep"], cuts)).toEqual(
      decided("broad", "cut"),
    );
  });
});

type Cell = [TierName, "frontier" | "risky" | "cut"];
const ROWS: {
  name: string;
  answers: WorkerAnswers;
  cells: [Cell, Cell, Cell];
}[] = [
  {
    name: "score 2.4, max, risky .9",
    answers: answersForScore(2.4, "max", 0.9),
    cells: [
      ["deep", "risky"],
      ["frontier", "frontier"],
      ["frontier", "frontier"],
    ],
  },
  {
    name: "score 2.4, high",
    answers: answersForScore(2.4, "high"),
    cells: [
      ["deep", "cut"],
      ["deep", "cut"],
      ["deep", "cut"],
    ],
  },
  {
    name: "score 2.2, xhigh",
    answers: answersForScore(2.2, "xhigh"),
    cells: [
      ["deep", "cut"],
      ["deep", "cut"],
      ["frontier", "frontier"],
    ],
  },
  {
    name: "score 1.9, high",
    answers: answersForScore(1.9, "high"),
    cells: [
      ["broad", "cut"],
      ["deep", "cut"],
      ["deep", "cut"],
    ],
  },
  {
    name: "score 1.3, high",
    answers: answersForScore(1.3, "high"),
    cells: [
      ["basic", "cut"],
      ["broad", "cut"],
      ["broad", "cut"],
    ],
  },
  {
    name: "score 1.0, risky .9",
    answers: answersForScore(1.0, undefined, 0.9),
    cells: [
      ["deep", "risky"],
      ["deep", "risky"],
      ["deep", "risky"],
    ],
  },
  {
    name: "score 1.0, risky .7",
    answers: answersForScore(1.0, undefined, 0.7),
    cells: [
      ["basic", "cut"],
      ["basic", "cut"],
      ["broad", "cut"],
    ],
  },
];
const MODE_CUTS: [string, CutPoints][] = [
  ["budget", BUDGET],
  ["standard", STANDARD],
  ["premium", PREMIUM],
];

describe("Table per mode", () => {
  test.each(
    ROWS.flatMap((row) =>
      MODE_CUTS.map(([mode, cuts], i) => ({
        row: row.name,
        mode,
        cuts,
        a: row.answers,
        cell: row.cells[i] as Cell,
      })),
    ),
  )("$row in $mode", ({ a, cuts, cell }) => {
    expect(decideTier(a, ALL, cuts)).toEqual(decided(cell[0], cell[1]));
  });
});

describe("Risk floor rule", () => {
  test("Risk floor", () => {
    expect(decideTier(answersForScore(0.5, "high", 0.71), ALL, STANDARD)).toEqual(
      decided("deep", "risky"),
    );
  });
  test("Risk boundary", () => {
    expect(decideTier(answersForScore(1.5, "high", 0.7), ALL, STANDARD)).toEqual(
      decided("broad", "cut"),
    );
  });
  test("Risk floor without deep", () => {
    expect(decideTier(answersForScore(0.5, "high", 0.9), ["basic", "broad"], STANDARD)).toEqual(
      decided("broad", "risky"),
    );
  });
});

describe("Partial answers in the decision", () => {
  test("Risk floor without a tier answer", () => {
    expect(decideTier(answers({ risky: 0.9 }), ["deep"], STANDARD)).toEqual(
      decided("deep", "risky"),
    );
  });
  test("Expert needed unanswered (no rule reads it)", () => {
    expect(decideTier(answersForScore(2.4, "max"), ALL, STANDARD)).toEqual(
      decided("frontier", "frontier"),
    );
  });
  test("Effort unanswered in premium", () => {
    const a = answersForScore(3.0);
    expect(scoreOf(a)).toBe(3);
    expect(decideTier(a, ALL, PREMIUM)).toEqual(decided("deep", "cut"));
  });
  test("Slot without a score", () => {
    const a = answers({
      tier: ["slot::reviewer", { "slot::reviewer": 0.95 }],
      risky: 0.1,
    });
    expect(decideTier(a, [], STANDARD, ["reviewer"])).toEqual(decided("slot::reviewer", "slot"));
  });
  test("No tier answer", () => {
    expect(decideTier(answers({ risky: 0.2 }), ALL, STANDARD)).toEqual({
      kind: "none",
    });
  });
  test("No tier offered", () => {
    expect(decideTier(answers({ risky: 0.9 }), [], STANDARD)).toEqual({
      kind: "none",
    });
  });
  test("Every answer unanswered", () => {
    expect(decideTier(answers({}), ALL, STANDARD)).toEqual({ kind: "none" });
  });
});

describe("Fallthrough without a qualifying tier", () => {
  test("Risk floor with only basic", () => {
    expect(decideTier(answersForScore(0.5, "high", 0.9), ["basic"], STANDARD)).toEqual(
      decided("basic", "risky"),
    );
  });
  test("Risk floor with only a slot", () => {
    const a = answers({
      tier: ["slot::reviewer", { "slot::reviewer": 0.95 }],
      risky: 0.9,
    });
    expect(decideTier(a, [], STANDARD, ["reviewer"])).toEqual(decided("slot::reviewer", "slot"));
  });
  test("Only basic offered", () => {
    expect(decideTier(answersForScore(2.0, "high"), ["basic"], STANDARD)).toEqual(
      decided("basic", "cut"),
    );
  });
  test("Only frontier offered", () => {
    expect(decideTier(answersForScore(2.0, "high"), ["frontier"], STANDARD)).toEqual({
      kind: "none",
    });
  });
});

describe("Slot rule", () => {
  const R = ["reviewer"];
  const slotAt = (p: number, rest: Record<string, number> = {}, effort = "high") =>
    answers({
      tier: ["slot::reviewer", { "slot::reviewer": p, ...rest }],
      effort,
    });

  test("Slot at the bar", () => {
    expect(decideTier(slotAt(0.6), ALL, STANDARD, R)).toEqual(decided("slot::reviewer", "slot"));
  });
  test("Risk wins over a slot", () => {
    const a = answers({
      tier: ["slot::reviewer", { "slot::reviewer": 0.95 }],
      risky: 0.8,
    });
    expect(decideTier(a, ALL, STANDARD, R)).toEqual(decided("deep", "risky"));
  });
  test("Two slots", () => {
    const a = answers({
      tier: ["slot::bulk", { "slot::bulk": 0.7, "slot::reviewer": 0.1 }],
    });
    expect(decideTier(a, ALL, STANDARD, ["reviewer", "bulk"])).toEqual(
      decided("slot::bulk", "slot"),
    );
  });
  test("Slot in every mode", () => {
    const a = answers({
      tier: ["slot::reviewer", { "slot::reviewer": 0.92, broad: 0.02, deep: 0.06 }],
      effort: "high",
      risky: 0.1,
    });
    expect(scoreOf(a)).toBe(2);
    for (const cuts of [BUDGET, STANDARD, PREMIUM]) {
      expect(decideTier(a, ALL, cuts, R)).toEqual(decided("slot::reviewer", "slot"));
    }
  });
  test("Slot below the bar", () => {
    const a = slotAt(0.5, { broad: 0.3, deep: 0.15, basic: 0.05 });
    expect(scoreOf(a)).toBe(1.45);
    expect(decideTier(a, ALL, STANDARD, R)).toEqual(decided("broad", "cut"));
  });
  test("Slot not offered", () => {
    const a = answers({
      tier: ["slot::old", { "slot::old": 0.9, broad: 0.08 }],
      effort: "high",
    });
    expect(decideTier(a, ALL, STANDARD, [])).toEqual(decided("broad", "cut"));
  });
  test("Slot below the bar reaches frontier", () => {
    const a = slotAt(0.5, { deep: 0.975, frontier: 0.025 }, "xhigh");
    expect(scoreOf(a)).toBe(2.4);
    const cuts: CutPoints = { ...STANDARD, frontierMin: 2.34 };
    expect(decideTier(a, ALL, cuts, R)).toEqual(decided("frontier", "frontier"));
  });
  test("Only a slot offered below the bar", () => {
    expect(decideTier(slotAt(0.5), [], STANDARD, R)).toEqual({ kind: "none" });
  });

  const notReviewer = (t: Target) => t !== "slot::reviewer";
  test("Usable slot kept", () => {
    expect(chooseFallback("slot::reviewer", ALL, () => true, R)).toEqual({
      kind: "keep",
      tier: "slot::reviewer",
    });
  });
  test("Runnable slot not in slots is not kept", () => {
    expect(chooseFallback("slot::reviewer", ALL, () => true, [])).toEqual({
      kind: "moved",
      tier: "broad",
      from: "slot::reviewer",
    });
  });
  test("Slot falls back to broad", () => {
    expect(chooseFallback("slot::reviewer", ALL, notReviewer, R)).toEqual({
      kind: "moved",
      tier: "broad",
      from: "slot::reviewer",
    });
  });
  test("Slot falls back to basic", () => {
    expect(chooseFallback("slot::reviewer", ["basic", "deep"], notReviewer, R)).toEqual({
      kind: "moved",
      tier: "basic",
      from: "slot::reviewer",
    });
  });
  test("Slot never moves up", () => {
    const deepOnly = (t: Target) => t === "deep" || t === "frontier";
    expect(chooseFallback("slot::reviewer", ALL, deepOnly, R)).toEqual({
      kind: "unchanged",
    });
  });
});

describe("Decision on Jev failure", () => {
  test("Jev failure", () => {
    expect(decideTier({ kind: "miss", miss: "timeout" }, ALL, STANDARD)).toEqual({
      kind: "none",
      reason: "miss",
    });
  });
  test("Cancelled", () => {
    const result = decideTier({ kind: "cancelled" }, ALL, STANDARD);
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
    ["Usable frontier kept", "frontier", ALL, ["frontier"], { kind: "keep", tier: "frontier" }],
    ["Move down", "deep", ALL, ["broad"], { kind: "moved", tier: "broad", from: "deep" }],
    [
      "Skip an unusable lower tier",
      "deep",
      ALL,
      ["basic"],
      { kind: "moved", tier: "basic", from: "deep" },
    ],
    [
      "Unoffered tier skipped",
      "deep",
      ["basic", "deep"],
      ["broad", "basic"],
      { kind: "moved", tier: "basic", from: "deep" },
    ],
    [
      "Expert never a target",
      "frontier",
      ALL,
      ["deep", "broad", "basic"],
      { kind: "moved", tier: "deep", from: "frontier" },
    ],
    ["Fast cannot run", "basic", ALL, [], { kind: "unchanged" }],
    ["Nothing can run", "broad", ALL, ["deep", "frontier"], { kind: "unchanged" }],
  ];
  for (const [name, tier, offered, ok, expected] of cases) {
    test(name, () => {
      expect(chooseFallback(tier, offered, runs(...ok))).toEqual(expected);
    });
  }
});
