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
const NO_EXPERT: readonly TierName[] = ["fast", "balanced", "deep"];

const BUDGET: CutPoints = {
  fastMax: 1.41,
  balancedMax: 2.13,
  expertMin: Infinity,
};
const STANDARD: CutPoints = {
  fastMax: 1.17,
  balancedMax: 1.81,
  expertMin: 2.34,
};
const PREMIUM: CutPoints = {
  fastMax: -Infinity,
  balancedMax: 1.41,
  expertMin: 2.12,
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
        fast: 0,
        balanced: 0,
        deep: 0,
        expert: 0,
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
  const probs = { fast: 0, balanced: 0, deep: 0, expert: 0 };
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
          tier: ["deep", { deep: 0.9, balanced: 0.1 }],
          effort: "xhigh",
        }),
      ),
    ).toBe(2.275);
  });
});

describe("Decision order", () => {
  test("Ordinary choice", () => {
    expect(decideTier(answersForScore(1.3, "high", 0.1), ALL, STANDARD)).toEqual(
      decided("balanced", "cut"),
    );
  });
  test("Same answers, different modes", () => {
    const a = answersForScore(2.2, "xhigh", 0.1);
    expect(decideTier(a, ALL, BUDGET)).toEqual(decided("deep", "cut"));
    expect(decideTier(a, ALL, STANDARD)).toEqual(decided("deep", "cut"));
    expect(decideTier(a, ALL, PREMIUM)).toEqual(decided("expert", "expert"));
  });
  test("Same score, different tiers", () => {
    const a = answersForScore(1.85, "high");
    const budget: CutPoints = {
      fastMax: 1.41,
      balancedMax: 2.13,
      expertMin: Infinity,
    };
    const premium: CutPoints = {
      fastMax: -Infinity,
      balancedMax: 1.41,
      expertMin: 2.12,
    };
    expect(decideTier(a, ALL, budget)).toEqual(decided("balanced", "cut"));
    expect(decideTier(a, ALL, premium)).toEqual(decided("deep", "cut"));
  });
});

describe("Expert rule", () => {
  const cuts: CutPoints = { fastMax: 1.17, balancedMax: 1.81, expertMin: 2.3 };
  test("Expert by score and effort", () => {
    expect(decideTier(answersForScore(2.35, "xhigh"), ALL, cuts)).toEqual(
      decided("expert", "expert"),
    );
  });
  test("Expert at the cut", () => {
    expect(decideTier(answersForScore(2.3, "max"), ALL, cuts)).toEqual(decided("expert", "expert"));
  });
  test("High effort is not enough", () => {
    expect(decideTier(answersForScore(2.4, "high"), ALL, cuts)).toEqual(decided("deep", "cut"));
  });
  test("Expert not offered", () => {
    expect(decideTier(answersForScore(2.4, "max"), NO_EXPERT, cuts)).toEqual(
      decided("deep", "cut"),
    );
  });
  test("Budget never reaches expert", () => {
    expect(decideTier(answersForScore(3.4, "max"), ALL, BUDGET)).toEqual(decided("deep", "cut"));
  });
  test("expert switched off gives expertMin +Infinity and no expert", () => {
    const off: CutPoints = {
      fastMax: 1.17,
      balancedMax: 1.81,
      expertMin: Infinity,
    };
    expect(decideTier(answersForScore(3.4, "max"), NO_EXPERT, off)).toEqual(decided("deep", "cut"));
  });
  test("Expert stands on high risk", () => {
    expect(decideTier(answersForScore(2.4, "max", 0.9), ALL, cuts)).toEqual(
      decided("expert", "expert"),
    );
  });
});

describe("Cut rule", () => {
  const cuts: CutPoints = {
    fastMax: 1.17,
    balancedMax: 1.81,
    expertMin: Infinity,
  };
  test("Fast at the cut", () => {
    expect(decideTier(answersForScore(1.17, "high"), ALL, cuts)).toEqual(decided("fast", "cut"));
  });
  test("Balanced", () => {
    expect(decideTier(answersForScore(1.5, "high"), ALL, cuts)).toEqual(decided("balanced", "cut"));
  });
  test("Deep", () => {
    expect(decideTier(answersForScore(1.82, "high"), ALL, cuts)).toEqual(decided("deep", "cut"));
  });
  test("Premium never cuts to fast", () => {
    expect(decideTier(answersForScore(0, "low"), ALL, PREMIUM)).toEqual(decided("balanced", "cut"));
  });
  test("Unoffered tier moves down", () => {
    expect(decideTier(answersForScore(1.5, "high"), ["fast", "deep"], cuts)).toEqual(
      decided("fast", "cut"),
    );
  });
  test("Unoffered tier moves up", () => {
    expect(decideTier(answersForScore(0.5, "high"), ["balanced", "deep"], cuts)).toEqual(
      decided("balanced", "cut"),
    );
  });
});

type Cell = [TierName, "expert" | "risky" | "cut"];
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
      ["expert", "expert"],
      ["expert", "expert"],
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
      ["expert", "expert"],
    ],
  },
  {
    name: "score 1.9, high",
    answers: answersForScore(1.9, "high"),
    cells: [
      ["balanced", "cut"],
      ["deep", "cut"],
      ["deep", "cut"],
    ],
  },
  {
    name: "score 1.3, high",
    answers: answersForScore(1.3, "high"),
    cells: [
      ["fast", "cut"],
      ["balanced", "cut"],
      ["balanced", "cut"],
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
      ["fast", "cut"],
      ["fast", "cut"],
      ["balanced", "cut"],
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
      decided("balanced", "cut"),
    );
  });
  test("Risk floor without deep", () => {
    expect(decideTier(answersForScore(0.5, "high", 0.9), ["fast", "balanced"], STANDARD)).toEqual(
      decided("balanced", "risky"),
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
      decided("expert", "expert"),
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
  test("Risk floor with only fast", () => {
    expect(decideTier(answersForScore(0.5, "high", 0.9), ["fast"], STANDARD)).toEqual(
      decided("fast", "risky"),
    );
  });
  test("Risk floor with only a slot", () => {
    const a = answers({
      tier: ["slot::reviewer", { "slot::reviewer": 0.95 }],
      risky: 0.9,
    });
    expect(decideTier(a, [], STANDARD, ["reviewer"])).toEqual(decided("slot::reviewer", "slot"));
  });
  test("Only fast offered", () => {
    expect(decideTier(answersForScore(2.0, "high"), ["fast"], STANDARD)).toEqual(
      decided("fast", "cut"),
    );
  });
  test("Only expert offered", () => {
    expect(decideTier(answersForScore(2.0, "high"), ["expert"], STANDARD)).toEqual({
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
      tier: ["slot::reviewer", { "slot::reviewer": 0.92, balanced: 0.02, deep: 0.06 }],
      effort: "high",
      risky: 0.1,
    });
    expect(scoreOf(a)).toBe(2);
    for (const cuts of [BUDGET, STANDARD, PREMIUM]) {
      expect(decideTier(a, ALL, cuts, R)).toEqual(decided("slot::reviewer", "slot"));
    }
  });
  test("Slot below the bar", () => {
    const a = slotAt(0.5, { balanced: 0.3, deep: 0.15, fast: 0.05 });
    expect(scoreOf(a)).toBe(1.45);
    expect(decideTier(a, ALL, STANDARD, R)).toEqual(decided("balanced", "cut"));
  });
  test("Slot not offered", () => {
    const a = answers({
      tier: ["slot::old", { "slot::old": 0.9, balanced: 0.08 }],
      effort: "high",
    });
    expect(decideTier(a, ALL, STANDARD, [])).toEqual(decided("balanced", "cut"));
  });
  test("Slot below the bar reaches expert", () => {
    const a = slotAt(0.5, { deep: 0.975, expert: 0.025 }, "xhigh");
    expect(scoreOf(a)).toBe(2.4);
    const cuts: CutPoints = { ...STANDARD, expertMin: 2.34 };
    expect(decideTier(a, ALL, cuts, R)).toEqual(decided("expert", "expert"));
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
      tier: "balanced",
      from: "slot::reviewer",
    });
  });
  test("Slot falls back to balanced", () => {
    expect(chooseFallback("slot::reviewer", ALL, notReviewer, R)).toEqual({
      kind: "moved",
      tier: "balanced",
      from: "slot::reviewer",
    });
  });
  test("Slot falls back to fast", () => {
    expect(chooseFallback("slot::reviewer", ["fast", "deep"], notReviewer, R)).toEqual({
      kind: "moved",
      tier: "fast",
      from: "slot::reviewer",
    });
  });
  test("Slot never moves up", () => {
    const deepOnly = (t: Target) => t === "deep" || t === "expert";
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
