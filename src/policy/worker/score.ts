// Pure difficulty score from Jev's worker answers. Imports nothing outside src/policy/.

import type { Answer } from "../answers.ts";
import { TIER_LADDER } from "../launch.ts";

// Probability-weighted tier rank (basic 0 … frontier 3), over tier keys only. Slot keys never count.
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

// Mode independent; ignores `effort`. Undefined when there is no usable `tier` answer.
export function difficultyScore(answers: Record<string, Answer>): number | undefined {
  const tier = tierRank(answers["tier"]);
  return tier === undefined ? undefined : Math.round(tier * 1000) / 1000;
}
