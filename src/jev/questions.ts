import type { QuestionSpec } from "../policy/answers.ts";
import { TIER_LADDER, type TierName } from "../policy/launch.ts";
import {
  EXPERT_NEEDED_QUESTION,
  RISKY_QUESTION,
  STANDARD_TIER_CRITERIA,
  TIER_INSTRUCTION,
  WORKER_EFFORT_QUESTION,
  type WireQuestion,
} from "./rubrics.ts";

export type { WireQuestion };

/** Configured tiers in ladder order; `expert` only when its switch is on. */
export function offeredTiers(
  tiers: Partial<Record<TierName, string>>,
  expertOn: boolean,
): TierName[] {
  return TIER_LADDER.filter((tier) => {
    if (tier === "expert" && !expertOn) return false;
    const value = tiers[tier];
    return typeof value === "string" && value !== "";
  });
}

function copy(question: WireQuestion): WireQuestion {
  return { ...question, criteria: { ...question.criteria } };
}

export function buildWorkerQuestions(
  offered: readonly TierName[],
  displayNames: Partial<Record<TierName, string>>,
): { questions: Record<string, WireQuestion>; specs: Record<string, QuestionSpec> } {
  const questions: Record<string, WireQuestion> = {};
  const specs: Record<string, QuestionSpec> = {};
  const ordered = TIER_LADDER.filter((tier) => offered.includes(tier));
  if (ordered.length > 0) {
    const criteria: Record<string, string> = {};
    for (const tier of ordered) {
      const name = displayNames[tier];
      const text = STANDARD_TIER_CRITERIA[tier];
      criteria[tier] = name === undefined || name === "" ? text : `${name}. ${text}`;
    }
    questions["tier"] = { type: "choice", instructions: TIER_INSTRUCTION, criteria };
    specs["tier"] = { type: "choice", options: ordered };
  }
  questions["effort"] = copy(WORKER_EFFORT_QUESTION);
  specs["effort"] = { type: "choice", options: Object.keys(WORKER_EFFORT_QUESTION.criteria) };
  questions["risky"] = copy(RISKY_QUESTION);
  specs["risky"] = { type: "noul" };
  if (ordered.includes("expert")) {
    questions["expert_needed"] = copy(EXPERT_NEEDED_QUESTION);
    specs["expert_needed"] = { type: "noul" };
  }
  return { questions, specs };
}
