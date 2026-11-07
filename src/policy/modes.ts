// Pure per-mode expert gate. Imports nothing outside src/policy/.

import type { Answer } from "./answers.ts";

export const MODE_NAMES = ["budget", "standard", "premium"] as const;
export type ModeName = (typeof MODE_NAMES)[number];

type ChoiceAnswer = Extract<Answer, { type: "choice" }>;

function choiceOf(answer: Answer | undefined): ChoiceAnswer | undefined {
  return answer?.type === "choice" ? answer : undefined;
}

// budget and standard: the model chose expert and is sure it is needed.
function standardGate(answers: Record<string, Answer>): boolean {
  const needed = answers["expert_needed"];
  return (
    choiceOf(answers["tier"])?.choice === "expert" && needed?.type === "noul" && needed.noul > 0.9
  );
}

// premium: a deep or expert choice with some expert probability and high effort.
function premiumGate(answers: Record<string, Answer>): boolean {
  const tier = choiceOf(answers["tier"]);
  const effort = choiceOf(answers["effort"]);
  if (tier === undefined || effort === undefined) return false;
  return (
    (tier.choice === "deep" || tier.choice === "expert") &&
    (tier.probabilities["expert"] ?? 0) >= 0.1 &&
    (effort.choice === "xhigh" || effort.choice === "max")
  );
}

// Reads raw worker answers, before any cap or clamp. Unanswered counts as not passing.
export function expertAdmitted(mode: ModeName, answers: Record<string, Answer>): boolean {
  return mode === "premium" ? premiumGate(answers) : standardGate(answers);
}
