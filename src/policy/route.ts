// Pure launch route. Imports nothing outside src/policy/.

import {
  clampLevel,
  supportedLevels,
  workerEffort,
  type ModelThinking,
  type ThinkingLevel,
} from "./effort.ts";
import type { EffectiveLaunch, Target, TierName } from "./launch.ts";
import type { CutPoints } from "./cutpoints.ts";
import { chooseFallback, decideTier, type TierDecision } from "./tier.ts";
import type { WorkerAnswers } from "./worker.ts";

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

export function launchKind(
  launch: EffectiveLaunch,
  offered: readonly TierName[],
  forkedLaunch: ForkedLaunch,
  slotCount = 0,
): LaunchKind {
  const locked = launch.modelLocked || launch.thinkingLocked;
  const forkedThinking = launch.inheritContext && forkedLaunch === "thinking";
  const noTier = offered.length === 0 && slotCount === 0;
  if (launch.resume) return { kind: "untouched", locked };
  if (launch.inheritContext && forkedLaunch === "untouched") return { kind: "untouched", locked };
  if (launch.modelLocked && launch.thinkingLocked) return { kind: "untouched", locked };
  if (launch.thinkingLocked && (forkedThinking || noTier)) return { kind: "untouched", locked };
  return { kind: "ask", tierQuestion: !forkedThinking && !noTier, locked };
}

type Record_ = Extract<Route, { kind: "routed" }>["record"];

function thinkingOnly(
  input: RouteInput,
  answers: Extract<WorkerAnswers, { kind: "read" }>,
  record: Record_,
): Route {
  const write: { thinking?: ThinkingLevel } = {};
  if (!input.launch.thinkingLocked) {
    const effort = answers.answers["effort"];
    const risky = answers.answers["risky"];
    const level = workerEffort({
      ...(effort?.type === "choice" ? { effort } : {}),
      ...(risky?.type === "noul" ? { risky: risky.noul } : {}),
      movedByFallback: false,
    });
    if (level !== undefined) {
      write.thinking = level;
      record.effort = level;
    }
  }
  return { kind: "routed", write, record };
}

export function routeLaunch(input: RouteInput): Route {
  const { launch, answers } = input;
  const kind = launchKind(launch, input.offered, input.forkedLaunch, input.slots.length);
  const locked = kind.locked ? ({ locked: true } as const) : {};
  if (kind.kind === "untouched") return { kind: "untouched", ...locked };
  if (answers === undefined || answers.kind === "cancelled") return { kind: "skip" };
  if (answers.kind === "miss") {
    return { kind: "routed", write: {}, record: { reason: "miss", ...locked } };
  }

  const decision: TierDecision = kind.tierQuestion
    ? decideTier(answers, input.offered, input.cuts, input.slots)
    : { kind: "none" };
  if (decision.kind === "none") {
    return thinkingOnly(input, answers, { reason: "untouched", ...locked });
  }
  if (launch.modelLocked) {
    return thinkingOnly(input, answers, {
      reason: decision.reason,
      tier: decision.tier,
      ...locked,
    });
  }

  const fallback = chooseFallback(decision.tier, input.offered, input.canRun, input.slots);
  if (fallback.kind === "unchanged") {
    return {
      kind: "routed",
      write: {},
      record: { reason: decision.reason, tier: decision.tier, fallback: decision.tier, ...locked },
    };
  }
  const final = fallback.tier;
  const record: Record_ = { reason: decision.reason, tier: final, ...locked };
  if (fallback.kind === "moved") record.fallback = fallback.from;
  const write: { model?: string; thinking?: ThinkingLevel } = { model: input.modelOf(final) };
  if (!launch.thinkingLocked) {
    const effort = answers.answers["effort"];
    const risky = answers.answers["risky"];
    const level = workerEffort({
      ...(effort?.type === "choice" ? { effort } : {}),
      ...(risky?.type === "noul" ? { risky: risky.noul } : {}),
      tier: final,
      movedByFallback: fallback.kind === "moved",
    });
    if (level !== undefined) {
      const clamped = clampLevel(
        level,
        supportedLevels(input.thinkingOf(final) ?? { reasoning: true }),
      );
      write.thinking = clamped;
      record.effort = clamped;
    }
  }
  return { kind: "routed", write, record };
}
