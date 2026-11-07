// Question sets for main and worker requests. Wording lives in ./rubrics.ts.
import type { QuestionSpec } from "../policy/answers.ts";
import { EFFORT_LEVELS } from "../policy/effort.ts";
import { TIER_LADDER, type TierName } from "../policy/launch.ts";
import type { ModeName } from "../policy/modes.ts";
import {
  CORRECTS_QUESTION,
  EXPERT_NEEDED_QUESTIONS,
  MAIN_EFFORT_INSTRUCTION,
  RISKY_QUESTION,
  TIER_CRITERIA,
  TIER_INSTRUCTION,
  WORKER_EFFORT_QUESTION,
  type WireQuestion,
} from "./rubrics.ts";

export type { WireQuestion };

export type MainQuestions = {
  wire: Record<string, WireQuestion>;
  specs: Record<string, QuestionSpec>;
};

// A fresh copy per call, so a caller mutating a result cannot change the next one.
function copy(question: WireQuestion): WireQuestion {
  return { ...question, criteria: { ...question.criteria } };
}

/** Questions for a main request; `effort` and `risky` only when `askEffort`. */
export function mainQuestions(o: { askEffort: boolean }): MainQuestions {
  const wire: Record<string, WireQuestion> = {};
  const specs: Record<string, QuestionSpec> = {};
  if (o.askEffort) {
    // The five effort criteria are shared with the worker question; only the instruction differs.
    wire["effort"] = {
      type: "choice",
      instructions: MAIN_EFFORT_INSTRUCTION,
      criteria: { ...WORKER_EFFORT_QUESTION.criteria },
    };
    specs["effort"] = { type: "choice", options: EFFORT_LEVELS };
    wire["risky"] = copy(RISKY_QUESTION);
    specs["risky"] = { type: "noul" };
  }
  wire["corrects"] = copy(CORRECTS_QUESTION);
  specs["corrects"] = { type: "noul" };
  return { wire, specs };
}
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

export function buildWorkerQuestions(
  offered: readonly TierName[],
  displayNames: Partial<Record<TierName, string>>,
  mode: ModeName,
): { questions: Record<string, WireQuestion>; specs: Record<string, QuestionSpec> } {
  const questions: Record<string, WireQuestion> = {};
  const specs: Record<string, QuestionSpec> = {};
  const ordered = TIER_LADDER.filter((tier) => offered.includes(tier));
  if (ordered.length > 0) {
    const criteria: Record<string, string> = {};
    for (const tier of ordered) {
      const name = displayNames[tier];
      const text = TIER_CRITERIA[mode][tier];
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
    questions["expert_needed"] = copy(EXPERT_NEEDED_QUESTIONS[mode]);
    specs["expert_needed"] = { type: "noul" };
  }
  return { questions, specs };
}
