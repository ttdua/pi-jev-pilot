// Pure launch route. Imports nothing outside src/policy/.

import {
  clampLevel,
  supportedLevels,
  workerEffort,
  type ModelThinking,
  type ThinkingLevel,
} from "../effort.ts";
import type { EffectiveLaunch, Target, TierName } from "../launch.ts";
import type { CutPoints } from "./cutpoints.ts";
import { chooseFallback, decideTier, type TierDecision } from "./tier.ts";
import type { WorkerAnswers } from "./answers.ts";

export type ForkedLaunch = "untouched" | "thinking";

export type LaunchKind =
  | { kind: "untouched"; locked: boolean }
  | { kind: "ask"; tierQuestion: boolean; locked: boolean };

export type RouteReason =
  | Extract<TierDecision, { kind: "decided" }>["reason"]
  | "untouched"
  | "miss";

export type RouteInput = {
  answers: WorkerAnswers | undefined;
  launch: EffectiveLaunch;
  offered: readonly TierName[];
  cuts: CutPoints;
  forkedLaunch: ForkedLaunch;
  canRun: (t: Target) => boolean;
  thinkingOf: (t: Target) => ModelThinking | undefined;
  modelOf: (t: Target) => string;
  slots: readonly string[];
};

export type Route =
  | { kind: "untouched"; locked?: true }
  | { kind: "skip" }
  | {
      kind: "routed";
      write: { model?: string; thinking?: ThinkingLevel };
      record: {
        reason: RouteReason;
        tier?: Target;
        fallback?: Target;
        effort?: ThinkingLevel;
        locked?: true;
      };
    };

// Launches the router never touches: resumed, forked-as-is, fully locked, or thinking locked with no model to pick.
function leavesUntouched(
  launch: EffectiveLaunch,
  forkedLaunch: ForkedLaunch,
  forkedThinking: boolean,
  noTier: boolean,
): boolean {
  if (launch.resume) return true;
  if (launch.inheritContext && forkedLaunch === "untouched") return true;
  if (launch.modelLocked && launch.thinkingLocked) return true;
  return launch.thinkingLocked && (forkedThinking || noTier);
}

export function launchKind(
  launch: EffectiveLaunch,
  offered: readonly TierName[],
  forkedLaunch: ForkedLaunch,
  slotCount = 0,
): LaunchKind {
  const locked = launch.modelLocked || launch.thinkingLocked;
  const forkedThinking = launch.inheritContext && forkedLaunch === "thinking";
  const noTier = offered.length === 0 && slotCount === 0;
  if (leavesUntouched(launch, forkedLaunch, forkedThinking, noTier)) {
    return { kind: "untouched", locked };
  }
  return { kind: "ask", tierQuestion: !forkedThinking && !noTier, locked };
}

type Record_ = Extract<Route, { kind: "routed" }>["record"];
type ReadAnswers = Extract<WorkerAnswers, { kind: "read" }>;
type Decided = Extract<TierDecision, { kind: "decided" }>;
type Write = { model?: string; thinking?: ThinkingLevel };

// The effort the worker asked for, adjusted by the risk answer, tier and fallback.
function effortFor(
  answers: ReadAnswers,
  extra: { tier?: Target; movedByFallback: boolean },
): ThinkingLevel | undefined {
  const effort = answers.answers["effort"];
  const risky = answers.answers["risky"];
  return workerEffort({
    ...(effort?.type === "choice" ? { effort } : {}),
    ...(risky?.type === "noul" ? { risky: risky.noul } : {}),
    ...extra,
  });
}

function thinkingOnly(input: RouteInput, answers: ReadAnswers, record: Record_): Route {
  const write: Write = {};
  if (!input.launch.thinkingLocked) {
    const level = effortFor(answers, { movedByFallback: false });
    if (level !== undefined) {
      write.thinking = level;
      record.effort = level;
    }
  }
  return { kind: "routed", write, record };
}

type Placed = Exclude<ReturnType<typeof chooseFallback>, { kind: "unchanged" }>;
type Lock = { locked?: true };
type Ctx = { input: RouteInput; answers: ReadAnswers; locked: Lock };

// Writes the model, and the thinking level clamped to what the placed model supports.
function placedRoute(ctx: Ctx, decision: Decided, placed: Placed): Route {
  const { input, answers } = ctx;
  const final = placed.tier;
  const record: Record_ = { reason: decision.reason, tier: final, ...ctx.locked };
  if (placed.kind === "moved") record.fallback = placed.from;
  const write: Write = { model: input.modelOf(final) };
  if (!input.launch.thinkingLocked) {
    const level = effortFor(answers, { tier: final, movedByFallback: placed.kind === "moved" });
    if (level !== undefined) {
      const supported = supportedLevels(input.thinkingOf(final) ?? { reasoning: true });
      const clamped = clampLevel(level, supported);
      write.thinking = clamped;
      record.effort = clamped;
    }
  }
  return { kind: "routed", write, record };
}

function modelRoute(ctx: Ctx, decision: Decided): Route {
  const { input } = ctx;
  const fallback = chooseFallback(decision.tier, input.offered, input.canRun, input.slots);
  if (fallback.kind === "unchanged") {
    const record = { reason: decision.reason, tier: decision.tier, fallback: decision.tier };
    return { kind: "routed", write: {}, record: { ...record, ...ctx.locked } };
  }
  return placedRoute(ctx, decision, fallback);
}

// No tier decision, or a locked model: only the thinking level may change.
function decidedRoute(ctx: Ctx, decision: TierDecision): Route {
  if (decision.kind === "none") {
    return thinkingOnly(ctx.input, ctx.answers, { reason: "untouched", ...ctx.locked });
  }
  if (ctx.input.launch.modelLocked) {
    const record = { reason: decision.reason, tier: decision.tier, ...ctx.locked };
    return thinkingOnly(ctx.input, ctx.answers, record);
  }
  return modelRoute(ctx, decision);
}

export function routeLaunch(input: RouteInput): Route {
  const { answers } = input;
  const kind = launchKind(input.launch, input.offered, input.forkedLaunch, input.slots.length);
  const locked = kind.locked ? ({ locked: true } as const) : {};
  if (kind.kind === "untouched") return { kind: "untouched", ...locked };
  if (answers === undefined || answers.kind === "cancelled") return { kind: "skip" };
  if (answers.kind === "miss") {
    return { kind: "routed", write: {}, record: { reason: "miss", ...locked } };
  }
  const decision: TierDecision = kind.tierQuestion
    ? decideTier(answers, input.offered, input.cuts, input.slots)
    : { kind: "none" };
  return decidedRoute({ input, answers, locked }, decision);
}
