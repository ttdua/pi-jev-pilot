import { describe, expect, test } from "bun:test";

import type { Answer } from "../../../src/policy/answers.ts";
import type { CutPoints } from "../../../src/policy/worker/cutpoints.ts";
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
const NO_FRONTIER: readonly TierName[] = ["basic", "broad", "deep"];

const BUDGET: CutPoints = { basicMax: 1.0, broadMax: 1.9, frontierMin: Infinity };
const STANDARD: CutPoints = { basicMax: 0.9, broadMax: 1.5, frontierMin: 2.5 };
const PREMIUM: CutPoints = { basicMax: -Infinity, broadMax: 1.2, frontierMin: 2.3 };

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

// Answers whose difficulty score is `score`: tier probabilities spread over two adjacent ranks.
function answersForScore(score: number, effort?: string, risky?: number): WorkerAnswers {
  const r = Math.min(Math.floor(score), 2);
  const probs = { basic: 0, broad: 0, deep: 0, frontier: 0 };
  probs[TIER_LADDER[r] as TierName] = r + 1 - score;
  probs[TIER_LADDER[r + 1] as TierName] = score - r;
  const choice = TIER_LADDER[Math.round(score)] ?? "deep";
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
    expect(scoreOf(answersForScore(3, "max"))).toBe(3);
  });
  test("a named tier mix gives 1.9", () => {
    expect(
      scoreOf(
        answers({
          tier: ["deep", { deep: 0.9, broad: 0.1 }],
          effort: "xhigh",
        }),
      ),
    ).toBe(1.9);
  });
});

describe("Decision order", () => {
  test("Ordinary choice", () => {
    const cuts: CutPoints = { basicMax: 0.9, broadMax: 1.5, frontierMin: 2.3 };
    expect(decideTier(answersForScore(1.2, undefined, 0.1), ALL, cuts)).toEqual(
      decided("broad", "cut"),
    );
  });
  test("Same answers, different modes", () => {
    const a = answersForScore(2.4);
    expect(decideTier(a, ALL, BUDGET)).toEqual(decided("deep", "cut"));
    expect(decideTier(a, ALL, STANDARD)).toEqual(decided("deep", "cut"));
    expect(decideTier(a, ALL, PREMIUM)).toEqual(decided("frontier", "frontier"));
  });
  test("Same score, different tiers", () => {
    const a = answersForScore(1.6);
    expect(decideTier(a, ALL, BUDGET)).toEqual(decided("broad", "cut"));
    expect(decideTier(a, ALL, PREMIUM)).toEqual(decided("deep", "cut"));
  });
  test("Effort does not move the tier", () => {
    for (const cuts of [BUDGET, STANDARD, PREMIUM]) {
      const low = decideTier(answersForScore(2.4, "low"), ALL, cuts);
      expect(decideTier(answersForScore(2.4, "max"), ALL, cuts)).toEqual(low);
    }
  });
});

describe("Frontier rule", () => {
  const cuts: CutPoints = { basicMax: 0.9, broadMax: 1.5, frontierMin: 2.3 };
  test("Expert by score and effort", () => {
    expect(decideTier(answersForScore(2.35), ALL, cuts)).toEqual(decided("frontier", "frontier"));
  });
  test("Expert at the cut", () => {
    expect(decideTier(answersForScore(2.3), ALL, cuts)).toEqual(decided("frontier", "frontier"));
  });
  test("High effort is not enough", () => {
    expect(decideTier(answersForScore(2.4, "low"), ALL, cuts)).toEqual(
      decided("frontier", "frontier"),
    );
  });
  test("Below the frontier cut", () => {
    expect(decideTier(answersForScore(2.29), ALL, cuts)).toEqual(decided("deep", "cut"));
  });
  test("Expert not offered", () => {
    expect(decideTier(answersForScore(2.4), NO_FRONTIER, cuts)).toEqual(decided("deep", "cut"));
  });
  test("Budget never reaches expert", () => {
    expect(decideTier(answersForScore(3.0), ALL, BUDGET)).toEqual(decided("deep", "cut"));
  });
  test("Expert stands on high risk", () => {
    const a = answers({
      tier: ["slot::reviewer", { "slot::reviewer": 0.6, frontier: 0.4 }],
      risky: 0.9,
    });
    expect(scoreOf(a)).toBe(3);
    expect(decideTier(a, ALL, cuts, ["reviewer"])).toEqual(decided("frontier", "frontier"));
  });
});

describe("Cut rule", () => {
  const cuts: CutPoints = { basicMax: 0.9, broadMax: 1.5, frontierMin: Infinity };
  test("Fast at the cut", () => {
    expect(decideTier(answersForScore(0.9), ALL, cuts)).toEqual(decided("basic", "cut"));
  });
  test("Balanced", () => {
    expect(decideTier(answersForScore(1.2), ALL, cuts)).toEqual(decided("broad", "cut"));
  });
  test("Deep", () => {
    expect(decideTier(answersForScore(1.51), ALL, cuts)).toEqual(decided("deep", "cut"));
  });
  test("Premium never cuts to fast", () => {
    expect(decideTier(answersForScore(0), ALL, PREMIUM)).toEqual(decided("broad", "cut"));
  });
  test("Unoffered tier moves down", () => {
    expect(decideTier(answersForScore(1.2), ["basic", "deep"], cuts)).toEqual(
      decided("basic", "cut"),
    );
  });
  test("Unoffered tier moves up", () => {
    expect(decideTier(answersForScore(0.5), ["broad", "deep"], cuts)).toEqual(
      decided("broad", "cut"),
    );
  });
});

type Cell = [TierName, "frontier" | "cut"];
const ROWS: {
  name: string;
  answers: WorkerAnswers;
  cells: [Cell, Cell, Cell];
}[] = [
  {
    name: "score 2.6, low",
    answers: answersForScore(2.6, "low"),
    cells: [
      ["deep", "cut"],
      ["frontier", "frontier"],
      ["frontier", "frontier"],
    ],
  },
  {
    name: "score 2.4, max",
    answers: answersForScore(2.4, "max"),
    cells: [
      ["deep", "cut"],
      ["deep", "cut"],
      ["frontier", "frontier"],
    ],
  },
  {
    name: "score 1.7, low",
    answers: answersForScore(1.7, "low"),
    cells: [
      ["broad", "cut"],
      ["deep", "cut"],
      ["deep", "cut"],
    ],
  },
  {
    name: "score 1.0, max",
    answers: answersForScore(1.0, "max"),
    cells: [
      ["basic", "cut"],
      ["broad", "cut"],
      ["broad", "cut"],
    ],
  },
  {
    name: "score 0.5, risky .9",
    answers: answersForScore(0.5, undefined, 0.9),
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

describe("Partial answers in the decision", () => {
  test("Risk floor without a tier answer", () => {
    expect(decideTier(answers({ risky: 0.9 }), ["deep"], STANDARD)).toEqual({ kind: "none" });
  });
  test("Effort unanswered in premium", () => {
    const a = answersForScore(3.0);
    expect(scoreOf(a)).toBe(3);
    expect(decideTier(a, ALL, PREMIUM)).toEqual(decided("frontier", "frontier"));
  });
  test("Expert needed unanswered", () => {
    expect(decideTier(answersForScore(2.6), ALL, STANDARD)).toEqual(
      decided("frontier", "frontier"),
    );
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
  test("Risk floor with only a slot", () => {
    const a = answers({
      tier: ["slot::reviewer", { "slot::reviewer": 0.95 }],
      risky: 0.9,
    });
    expect(decideTier(a, [], STANDARD, ["reviewer"])).toEqual(decided("slot::reviewer", "slot"));
  });
  test("Risk floor with only fast", () => {
    expect(decideTier(answersForScore(2.0, undefined, 0.9), ["basic"], STANDARD)).toEqual(
      decided("basic", "cut"),
    );
  });
  test("Only fast offered", () => {
    expect(decideTier(answersForScore(2.0), ["basic"], STANDARD)).toEqual(decided("basic", "cut"));
  });
  test("Only expert offered", () => {
    expect(decideTier(answersForScore(2.0), ["frontier"], STANDARD)).toEqual({
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
    expect(decideTier(a, ALL, STANDARD, R)).toEqual(decided("slot::reviewer", "slot"));
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
      tier: ["slot::reviewer", { "slot::reviewer": 0.92, deep: 0.08 }],
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
    expect(scoreOf(a)).toBe(1.2);
    const cuts: CutPoints = { basicMax: 0.9, broadMax: 1.5, frontierMin: 2.5 };
    expect(decideTier(a, ALL, cuts, R)).toEqual(decided("broad", "cut"));
  });
  test("Slot not offered", () => {
    const a = answers({
      tier: ["slot::old", { "slot::old": 0.9, broad: 0.08 }],
      effort: "high",
    });
    expect(decideTier(a, ALL, STANDARD, [])).toEqual(decided("broad", "cut"));
  });
  test("Slot below the bar reaches expert", () => {
    const a = slotAt(0.5, { deep: 0.6, frontier: 0.4 });
    expect(scoreOf(a)).toBe(2.4);
    const cuts: CutPoints = { ...STANDARD, frontierMin: 2.3 };
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
  test("Slot falls back to balanced", () => {
    expect(chooseFallback("slot::reviewer", ALL, notReviewer, R)).toEqual({
      kind: "moved",
      tier: "broad",
      from: "slot::reviewer",
    });
  });
  test("Slot falls back to fast", () => {
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
    ["Usable expert kept", "frontier", ALL, ["frontier"], { kind: "keep", tier: "frontier" }],
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
