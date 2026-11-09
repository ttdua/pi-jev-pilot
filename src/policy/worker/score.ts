// Pure difficulty score from Jev's worker answers. Imports nothing outside src/policy/.

import type { Answer } from "./answers.ts";
import { EFFORT_LEVELS } from "./effort.ts";
import { TIER_LADDER } from "./launch.ts";

const EFFORT_DIVISOR = 8;
const DEFAULT_EFFORT_RANK = EFFORT_LEVELS.indexOf("high");

// Probability-weighted tier rank (fast 0 … expert 3), over tier keys only. Slot keys never count.
function tierRank(answer: Answer | undefined): number | undefined {
  if (answer?.type !== "choice") return undefined;
  let sum = 0;
  let weighted = 0;
  TIER_LADDER.forEach((tier, rank) => {
    const p = answer.probabilities[tier] ?? 0;
    sum += p;
    weighted += rank * p;
  });
  return sum > 0 ? weighted / sum : undefined;
}

// An unanswered or unknown effort counts as `high`.
function effortRank(answer: Answer | undefined): number {
  if (answer?.type !== "choice") return DEFAULT_EFFORT_RANK;
  const index = EFFORT_LEVELS.findIndex((level) => level === answer.choice);
  return index < 0 ? DEFAULT_EFFORT_RANK : index;
}

// Mode independent. Undefined when there is no usable `tier` answer.
export function difficultyScore(answers: Record<string, Answer>): number | undefined {
  const tier = tierRank(answers["tier"]);
  if (tier === undefined) return undefined;
  const raw = tier + effortRank(answers["effort"]) / EFFORT_DIVISOR;
  return Math.round(raw * 1000) / 1000;
}
