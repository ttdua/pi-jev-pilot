import type { BeforeAgentStartEventResult } from "@earendil-works/pi-coding-agent";
import type { ReadResult } from "../policy/answers.ts";
import type { ThinkingLevel } from "../policy/effort.ts";
import type { Strategy } from "../policy/strategy.ts";
import { showDecision, thinkingLevel, type MainHost, type Turn } from "./main-host.ts";
import { planOutcome, type Answered, type OutcomeFlags, type OutcomePlan } from "./main-outcome.ts";

type AnsweredPlan = Extract<OutcomePlan, { kind: "answered" }>;

/** Advice-only redraw: the effort part stays as it is. */
function keepEffort(
  host: MainHost,
  turn: Turn,
  askStrategy: boolean,
  nextAdvice: Strategy | undefined,
): void {
  const current = host.session.current;
  if (askStrategy && nextAdvice !== current?.advice) {
    showDecision(host, turn, current?.effort, nextAdvice);
  }
}

/** Applies the effort target unless the operator moved the level during the wait. */
function applyTarget(
  host: MainHost,
  turn: Turn,
  target: ThinkingLevel,
  plan: AnsweredPlan & { askStrategy: boolean },
): void {
  const { rec, from } = turn;
  // Operator changed the level (or the model) during the wait: discard, keep the old suffix.
  if (thinkingLevel(host) !== from)
    return keepEffort(host, turn, plan.askStrategy, plan.nextAdvice);
  if (from === "max") {
    rec.effective = "max";
    return showDecision(host, turn, { kind: "level", level: "max" }, plan.nextAdvice);
  }
  if (target !== from) host.pi.setThinkingLevel(target as never);
  rec.effective = thinkingLevel(host);
  rec.applied = rec.effective;
  showDecision(host, turn, { kind: "level", level: rec.effective }, plan.nextAdvice);
}

function applyAnswered(host: MainHost, turn: Turn, plan: AnsweredPlan, askStrategy: boolean): void {
  const { effort, nextAdvice } = plan;
  if (effort.kind === "target") {
    return applyTarget(host, turn, effort.target, { ...plan, askStrategy });
  }
  if (effort.showNoAnswer) return showDecision(host, turn, { kind: "no-answer" }, nextAdvice);
  keepEffort(host, turn, askStrategy, nextAdvice);
}

/** Records the classifier outcome and, when the turn is decided, applies and draws the result. */
export function applyOutcome(
  host: MainHost,
  turn: Turn,
  flags: OutcomeFlags,
  reply: { outcome: Answered; read: ReadResult | undefined },
): BeforeAgentStartEventResult | undefined {
  const plan = planOutcome(flags, reply.outcome, reply.read, host.session.current?.advice);
  Object.assign(turn.rec, plan.patch);
  if (plan.kind === "miss") {
    if (plan.showNoAnswer) showDecision(host, turn, { kind: "no-answer" }, undefined);
    return undefined;
  }
  if (plan.kind === "held") {
    // A held prompt keeps the level; the suffix shows the level as it is.
    turn.rec.effective = thinkingLevel(host);
    showDecision(host, turn, { kind: "level", level: turn.rec.effective }, plan.nextAdvice);
    return plan.message;
  }
  applyAnswered(host, turn, plan, flags.askStrategy);
  return plan.message;
}
