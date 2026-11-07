// Question sets for main and worker requests. Wording lives in ./rubrics.ts.
import type { QuestionSpec } from "../policy/answers.ts";
import { EFFORT_LEVELS } from "../policy/effort.ts";
import { TIER_LADDER, type TierName } from "../policy/launch.ts";
import { GATE_KEYS, NONE_OPTION, type SkillEntry, skillCriterion } from "../policy/skill.ts";
import {
  type BareNoulQuestion,
  CORRECTS_QUESTION,
  EXPERT_NEEDED_QUESTION,
  GATE_QUESTIONS,
  MAIN_EFFORT_INSTRUCTION,
  NONE_CRITERION,
  RISKY_QUESTION,
  STANDARD_TIER_CRITERIA,
  TIER_INSTRUCTION,
  WHICH_INSTRUCTION,
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

/** Main questions plus the skill question and gates; gates are bare noul questions. */
export type SkillQuestions = {
  wire: Record<string, WireQuestion | BareNoulQuestion>;
  specs: Record<string, QuestionSpec>;
};

// `which` over one list, so criteria and options cannot drift apart.
function whichQuestion(batch: readonly SkillEntry[]): { wire: WireQuestion; spec: QuestionSpec } {
  const criteria: Record<string, string> = {};
  for (const entry of batch) criteria[entry.name] = skillCriterion(entry);
  criteria[NONE_OPTION] = NONE_CRITERION;
  return {
    wire: { type: "choice", instructions: WHICH_INSTRUCTION, criteria },
    spec: { type: "choice", options: Object.keys(criteria) },
  };
}

/** Later skill batches: `which` only. */
export function skillBatchQuestions(batch: readonly SkillEntry[]): MainQuestions {
  const { wire, spec } = whichQuestion(batch);
  return { wire: { which: wire }, specs: { which: spec } };
}

/** Questions for a main request; `effort` and `risky` only when `askEffort`. */
export function mainQuestions(o: { askEffort: boolean; skills?: undefined }): MainQuestions;
/** With a non-empty first skill batch, appends `which` then the three gates. */
export function mainQuestions(o: {
  askEffort: boolean;
  skills: readonly SkillEntry[];
}): SkillQuestions;
export function mainQuestions(o: {
  askEffort: boolean;
  skills?: readonly SkillEntry[] | undefined;
}): SkillQuestions {
  const wire: Record<string, WireQuestion | BareNoulQuestion> = {};
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
  if (o.skills !== undefined && o.skills.length > 0) {
    const which = whichQuestion(o.skills);
    wire["which"] = which.wire;
    specs["which"] = which.spec;
    for (const key of GATE_KEYS) {
      wire[key] = { ...GATE_QUESTIONS[key] };
      specs[key] = { type: "noul" };
    }
  }
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
