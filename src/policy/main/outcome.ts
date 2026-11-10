import type { Answer, ReadResult } from "../answers.ts";
import { decideEffort, type EffortLevel, type ThinkingLevel } from "../effort.ts";
import { adviseStrategy, type Strategy } from "./strategy.ts";
import type { TurnRecord } from "./record.ts";

/** A classifier reply the plan reads: answered, or missed; a cancelled call never reaches the plan. */
export type ClassifierReply =
  | { kind: "ok"; ms: number; body: unknown }
  | { kind: "miss"; miss: string; reason: string; ms: number };

/** What the turn asked and allows, fixed before the classifier call. */
export type OutcomeFlags = {
  held: boolean;
  effortOn: boolean;
  askEffort: boolean;
  askStrategy: boolean;
  supported: readonly ThinkingLevel[];
};

/** Record fields the outcome sets. */
export type RecordPatch = Partial<
  Pick<
    TurnRecord,
    | "miss"
    | "answered"
    | "risky"
    | "corrects"
    | "effortP"
    | "requested"
    | "strategy"
    | "strategyP"
    | "advised"
  >
>;

/** `adviceBlock` is the text of the `<execution_strategy>` block; the host wraps it into a message. */
type Advised = {
  patch: RecordPatch;
  nextAdvice: Strategy | undefined;
  adviceBlock: string | undefined;
};

export type EffortPlan =
  /** Effort was not answered: show `no answer` when it was asked, else keep the effort suffix. */
  { kind: "unanswered"; showNoAnswer: boolean } | { kind: "target"; target: ThinkingLevel };

export type OutcomePlan =
  | { kind: "miss"; patch: RecordPatch; showNoAnswer: boolean }
  | ({ kind: "held" } & Advised)
  | ({ kind: "answered"; effort: EffortPlan } & Advised);

const noulOf = (answer: Answer | undefined): number | undefined =>
  answer?.type === "noul" ? answer.noul : undefined;

/** Copies the defined values only, so the patch never overwrites a field with `undefined`. */
function definedOnly(patch: Record<string, unknown>): RecordPatch {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
}

/**
 * Gates the strategy answer. A turn that did not ask `strategy` keeps the current advice suffix;
 * an asked strategy is recorded even when it is not advised.
 */
function planAdvice(
  askStrategy: boolean,
  answers: Record<string, Answer>,
  currentAdvice: Strategy | undefined,
): Advised {
  if (!askStrategy) return { patch: {}, nextAdvice: currentAdvice, adviceBlock: undefined };
  const strategy = answers["strategy"];
  const tier = answers["tier"];
  const advice = adviseStrategy({
    ...(strategy?.type === "choice" ? { strategy } : {}),
    ...(tier?.type === "choice" ? { tier: tier.choice } : {}),
  });
  const patch: RecordPatch =
    advice === undefined
      ? {}
      : { strategy: advice.strategy, strategyP: advice.strategyP, advised: advice.advised };
  if (advice?.advised !== true || advice.block === undefined) {
    return { patch, nextAdvice: undefined, adviceBlock: undefined };
  }
  return {
    patch,
    nextAdvice: advice.strategy,
    adviceBlock: advice.block,
  };
}

/** The miss kind, or undefined when the reply was read. */
function missOf(outcome: ClassifierReply, read: ReadResult | undefined): string | undefined {
  if (outcome.kind === "miss") return outcome.miss;
  if (read === undefined || read.kind === "miss") return "schema";
  return undefined;
}

/** A held prompt keeps the level: record the outcome and advice, never plan an effort target. */
function planHeld(
  flags: OutcomeFlags,
  answers: Record<string, Answer>,
  currentAdvice: Strategy | undefined,
): OutcomePlan {
  const advice = planAdvice(flags.askStrategy, answers, currentAdvice);
  const patch = definedOnly({ answered: true, corrects: noulOf(answers["corrects"]) });
  return { kind: "held", ...advice, patch: { ...patch, ...advice.patch } };
}

function planEffort(
  flags: OutcomeFlags,
  effort: Answer | undefined,
  risky: number | undefined,
): { patch: RecordPatch; effort: EffortPlan } {
  if (effort?.type !== "choice") {
    return { patch: {}, effort: { kind: "unanswered", showNoAnswer: flags.askEffort } };
  }
  const { requested, target } = decideEffort({
    choice: effort.choice as EffortLevel,
    ...(risky === undefined ? {} : { risky }),
    supported: flags.supported,
  });
  return {
    patch: { effortP: effort.probabilities, requested },
    effort: { kind: "target", target },
  };
}

/**
 * Turns the classifier outcome into what the turn records and what the host applies.
 * Pure: the host reads the thinking level and draws the status from the plan.
 */
export function planOutcome(
  flags: OutcomeFlags,
  outcome: ClassifierReply,
  read: ReadResult | undefined,
  currentAdvice: Strategy | undefined,
): OutcomePlan {
  const miss = missOf(outcome, read);
  if (flags.held) {
    if (miss !== undefined || read?.kind !== "read") {
      // A miss on a held prompt clears the advice suffix.
      return {
        kind: "held",
        patch: { miss: miss ?? "schema" },
        nextAdvice: undefined,
        adviceBlock: undefined,
      };
    }
    return planHeld(flags, read.answers, currentAdvice);
  }
  if (miss !== undefined || read?.kind !== "read") {
    // `no answer` shows only when effort or advice has a suffix to show.
    return {
      kind: "miss",
      patch: { miss: miss ?? "schema" },
      showNoAnswer: flags.effortOn || flags.askStrategy,
    };
  }
  const { answers } = read;
  const risky = noulOf(answers["risky"]);
  const recorded = definedOnly({ answered: true, risky, corrects: noulOf(answers["corrects"]) });
  const advice = planAdvice(flags.askStrategy, answers, currentAdvice);
  const effort = planEffort(flags, answers["effort"], risky);
  return {
    kind: "answered",
    ...advice,
    patch: { ...recorded, ...advice.patch, ...effort.patch },
    effort: effort.effort,
  };
}
