import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
} from "@earendil-works/pi-coding-agent";
import type { JevOutcome } from "../jev/client.ts";
import { mainState, SHIPPED_MAIN_GROUPS } from "../jev/state.ts";
import { readAnswers } from "../policy/answers.ts";
import type { SkillPick } from "../policy/skill.ts";
import { isChild } from "./child.ts";
import { branchItems, previousTurnId } from "./context.ts";
import { applyOutcome } from "./main-apply.ts";
import { gateTurn, newTurnRecord, type TurnPlan } from "./main-gate.ts";
import { drawTurn, thinkingLevel, type Ctx, type MainHost, type Turn } from "./main-host.ts";
import type { Answered } from "./main-outcome.ts";
import type { TurnRecord } from "./main-record.ts";
import {
  askLaterBatches,
  joinMessages,
  pickSkillSafely,
  planSkills,
  skillMessage,
  type CommonRequest,
} from "./main-skills.ts";
import { buildRichInputs } from "./rich.ts";

type StartResult = BeforeAgentStartEventResult | undefined;

/** Reads the gate inputs from the context and the deps, lazily and in gate order. */
function gate(host: MainHost, prompt: string | undefined, ctx: Ctx): TurnPlan | undefined {
  const { deps } = host;
  // Every dependency is called through `deps`, so a method-style dependency keeps its receiver.
  return gateTurn({
    prompt,
    sessionId: () => ctx.sessionManager.getSessionId(),
    isChild,
    load: () => deps.load(),
    model: () => ctx.model,
    apiKey: (keyVar) => deps.env()[keyVar],
    branch: () => ctx.sessionManager.getBranch(),
    planSkills: (skillsOn) => planSkills(prompt ?? "", skillsOn, deps),
  });
}

/** This prompt's classifier state, with the optional rich groups. */
async function classifierState(host: MainHost, prompt: string, ctx: Ctx, plan: TurnPlan) {
  const { deps, session } = host;
  const last = session.lastDecided;
  const rich = await buildRichInputs({
    groups: deps.rich?.groups ?? SHIPPED_MAIN_GROUPS,
    cwd: ctx.cwd,
    ...(last === undefined ? {} : { last }),
    tools: () => deps.rich?.tools() ?? [],
    agents: () => deps.rich?.agents(ctx.cwd) ?? [],
  });
  return mainState({
    prompt,
    items: branchItems(plan.branch),
    platforms: deps.platforms(ctx.cwd),
    rich,
  });
}

function commonRequest(plan: TurnPlan, ctx: Ctx, state: CommonRequest["state"]): CommonRequest {
  const { classifier } = plan.snapshot.settings;
  return {
    url: classifier.url,
    apiKey: plan.apiKey,
    model: classifier.model,
    timeoutMs: classifier.timeoutMs,
    state,
    ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
  };
}

/** Put the pick's name (only when picked), leader probability and gate mean on the record. */
function recordPick(rec: TurnRecord, pick: SkillPick): void {
  if (pick.kind === "picked") rec.skill = pick.name;
  if ("p" in pick) rec.skillP = pick.p;
  if ("gate" in pick && pick.gate !== undefined) rec.gate = pick.gate;
}

/** Asks for this prompt's tally text. A failure keeps the old overlay. Returns whether it changed. */
function refreshOverlay(host: MainHost): boolean {
  let next: string | undefined;
  try {
    next = host.deps.tallyText?.();
  } catch {
    return false; // the old overlay stays
  }
  return host.session.updateOverlay(next);
}

/** Reads the reply, picks the skill and applies the outcome; redraws a changed overlay. */
async function settleReply(
  host: MainHost,
  turn: Turn,
  plan: TurnPlan,
  reply: { outcome: Answered; later: readonly Promise<JevOutcome>[] | undefined },
): Promise<StartResult> {
  const { rec, ctx, snapshot } = turn;
  const { outcome, later } = reply;
  const changed = refreshOverlay(host);
  try {
    const { specs } = plan.questions;
    const read = outcome.kind === "ok" ? readAnswers(specs, outcome.body) : undefined;
    const pick = await pickSkillSafely(plan.batches, specs, read, later);
    recordPick(rec, pick);
    const skill = skillMessage(pick, plan.batches, {
      inject: () => snapshot.settings.skills.inject,
      entries: () => ctx.sessionManager.buildSessionProjection().entries,
    });
    return joinMessages(skill, applyOutcome(host, turn, plan, { outcome, read }));
  } finally {
    // The overlay changed but no branch drew: show it (or its removal) over the old suffix.
    if (changed && !host.session.hasDrawn(rec)) {
      try {
        drawTurn(host, turn);
      } catch {
        /* fail open: the old status stays */
      }
    }
  }
}

/**
 * `before_agent_start` for one prompt: gate, start the record, ask Jev, then apply the reply.
 * `mine.rec` reports this run's record to the caller, so a throw drops only its own record.
 */
export async function startTurn(
  host: MainHost,
  event: BeforeAgentStartEvent,
  ctx: Ctx,
  mine: { rec?: TurnRecord },
): Promise<StartResult> {
  const prompt = event.messageType === "user" ? event.prompt : undefined;
  const plan = gate(host, prompt, ctx);
  if (plan === undefined || prompt === undefined) return undefined;
  const { snapshot } = plan;
  // `from` and `at` are read before the rich inputs are awaited, so a level change during that wait
  // or the Jev call is seen.
  const from = thinkingLevel(host);
  const at = host.deps.now();
  const state = await classifierState(host, prompt, ctx, plan);
  // The previous turn is looked up after the rich inputs, as the branch stands when the record starts.
  const previous = previousTurnId(plan.branch);
  const rec = newTurnRecord(plan, {
    turnId: host.deps.newId(),
    at,
    mode: snapshot.settings.mode,
    from,
    ...(previous === undefined ? {} : { previousTurnId: previous }),
  });
  mine.rec = rec;
  host.session.begin(rec, ctx, snapshot);

  const common = commonRequest(plan, ctx, state);
  const asked = host.deps.ask({ ...common, questions: plan.questions.wire });
  const later = askLaterBatches((request) => host.deps.ask(request), plan.batches.slice(1), common);
  const outcome = await asked;
  if (outcome.kind === "cancelled") {
    host.session.drop(rec);
    return undefined;
  }
  rec.ms = outcome.ms;
  return settleReply(host, { rec, ctx, snapshot, from }, plan, { outcome, later });
}
