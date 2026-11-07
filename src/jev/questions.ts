// Question sets for main and worker requests. Wording lives in ./rubrics.ts.
import type { QuestionSpec } from "../policy/answers.ts";
import { EFFORT_LEVELS } from "../policy/effort.ts";
import { STRATEGIES } from "../policy/strategy.ts";
import { slotTarget, TIER_LADDER, type TierName } from "../policy/launch.ts";
import { GATE_KEYS, NONE_OPTION, type SkillEntry, skillCriterion } from "../policy/skill.ts";
import {
  type BareNoulQuestion,
  CORRECTS_QUESTION,
  GATE_QUESTIONS,
  MAIN_EFFORT_INSTRUCTION,
  MAIN_TIER_QUESTION,
  NONE_CRITERION,
  RISKY_QUESTION,
  SLOT_CRITERION_INFIX,
  STRATEGY_QUESTION,
  TIER_INSTRUCTION,
  TOOL_QUESTION,
  WHICH_INSTRUCTION,
  WORKER_EFFORT_QUESTION,
  WORKER_TIER_CRITERIA,
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
  // Integer-like names keep JS key order in `criteria`; `options` keep catalog order and drive ties.
  const criteria: Record<string, string> = {};
  const define = (name: string, value: string): void => {
    Object.defineProperty(criteria, name, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  };
  for (const entry of batch) define(entry.name, skillCriterion(entry));
  define(NONE_OPTION, NONE_CRITERION);
  return {
    wire: { type: "choice", instructions: WHICH_INSTRUCTION, criteria },
    spec: { type: "choice", options: [...batch.map((e) => e.name), NONE_OPTION] },
  };
}

/** Later skill batches: `which` only. */
export function skillBatchQuestions(batch: readonly SkillEntry[]): MainQuestions {
  const { wire, spec } = whichQuestion(batch);
  return { wire: { which: wire }, specs: { which: spec } };
}

/**
 * Questions for a main request: `effort` and `risky` when `askEffort`, `tier` and `strategy` when
 * `askStrategy`, then `corrects`.
 */
export function mainQuestions(o: {
  askEffort: boolean;
  askStrategy?: boolean;
  skills?: undefined;
}): MainQuestions;
/** With a non-empty first skill batch, appends `which` then the three gates. */
export function mainQuestions(o: {
  askEffort: boolean;
  askStrategy?: boolean;
  skills: readonly SkillEntry[];
}): SkillQuestions;
export function mainQuestions(o: {
  askEffort: boolean;
  askStrategy?: boolean;
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
  if (o.askStrategy === true) {
    wire["tier"] = copy(MAIN_TIER_QUESTION);
    specs["tier"] = { type: "choice", options: Object.keys(MAIN_TIER_QUESTION.criteria) };
    wire["strategy"] = copy(STRATEGY_QUESTION);
    specs["strategy"] = { type: "choice", options: [...STRATEGIES] };
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

/** A configured slot as offered to the worker question. */
export type SlotOption = { name: string; model: string; when: string; displayName?: string };

function slotCriterion(slot: SlotOption): string {
  const name =
    slot.displayName === undefined || slot.displayName === "" ? slot.model : slot.displayName;
  return `${name}${SLOT_CRITERION_INFIX}${slot.when}`;
}

export function buildWorkerQuestions(
  offered: readonly TierName[],
  displayNames: Partial<Record<TierName, string>>,
  slots: readonly SlotOption[] = [],
): { questions: Record<string, WireQuestion>; specs: Record<string, QuestionSpec> } {
  const questions: Record<string, WireQuestion> = {};
  const specs: Record<string, QuestionSpec> = {};
  const ordered = TIER_LADDER.filter((tier) => offered.includes(tier));
  if (ordered.length > 0 || slots.length > 0) {
    const criteria: Record<string, string> = {};
    for (const tier of ordered) {
      const name = displayNames[tier];
      const text = WORKER_TIER_CRITERIA[tier];
      criteria[tier] = name === undefined || name === "" ? text : `${name}. ${text}`;
    }
    for (const slot of slots) criteria[slotTarget(slot.name)] = slotCriterion(slot);
    questions["tier"] = { type: "choice", instructions: TIER_INSTRUCTION, criteria };
    specs["tier"] = { type: "choice", options: Object.keys(criteria) };
  }
  questions["effort"] = copy(WORKER_EFFORT_QUESTION);
  specs["effort"] = { type: "choice", options: Object.keys(WORKER_EFFORT_QUESTION.criteria) };
  questions["risky"] = copy(RISKY_QUESTION);
  specs["risky"] = { type: "noul" };
  return { questions, specs };
}

/** One noul per candidate tool, keyed `tool::<name>`. */
export function buildToolQuestions(names: readonly string[]): {
  questions: Record<string, WireQuestion>;
  specs: Record<string, QuestionSpec>;
} {
  const questions: Record<string, WireQuestion> = {};
  const specs: Record<string, QuestionSpec> = {};
  for (const name of names) {
    // TOOL_QUESTION builds a fresh object per call, so no copy() is needed.
    questions[`tool::${name}`] = TOOL_QUESTION(name);
    specs[`tool::${name}`] = { type: "noul" };
  }
  return { questions, specs };
}
