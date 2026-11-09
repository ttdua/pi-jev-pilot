// Pure tier decision and fallback. Imports nothing outside src/policy/.

import {
  isSlot,
  slotName,
  slotTarget,
  TIER_LADDER,
  type Target,
  type TierName,
} from "../launch.ts";
import type { Answer } from "../answers.ts";
import type { CutPoints } from "./cutpoints.ts";
import { RISK_FLOOR } from "../effort.ts";
import { difficultyScore } from "./score.ts";
import type { WorkerAnswers } from "./answers.ts";

export type TierDecision =
  | {
      kind: "decided";
      tier: Target;
      reason: "expert" | "risky" | "slot" | "cut";
    }
  | { kind: "none"; reason?: "miss" };

export type FallbackResult =
  | { kind: "keep"; tier: Target }
  | { kind: "moved"; tier: TierName; from: Target }
  | { kind: "unchanged" };

type Decided = Extract<TierDecision, { kind: "decided" }>;

function decide(tier: Target, reason: Decided["reason"]): TierDecision {
  return { kind: "decided", tier, reason };
}

// Highest offered tier below expert, scanning deep down to fast.
function highestBelowExpert(offered: readonly TierName[]): TierName | undefined {
  return (["deep", "balanced", "fast"] as const).find((t) => offered.includes(t));
}

function deepOrHighest(offered: readonly TierName[]): TierName | undefined {
  return offered.includes("deep") ? "deep" : highestBelowExpert(offered);
}

const SLOT_BAR = 0.6;
const CUT_LADDER = ["fast", "balanced", "deep"] as const;

// Rule expert: the score reaches the launch's expert cut and the model asked for high effort.
function expertRule(
  answers: Record<string, Answer>,
  score: number | undefined,
  offered: readonly TierName[],
  cuts: CutPoints,
): TierDecision | undefined {
  if (score === undefined || !offered.includes("expert") || score < cuts.expertMin) {
    return undefined;
  }
  const effort = answers["effort"];
  const high = effort?.type === "choice" && (effort.choice === "xhigh" || effort.choice === "max");
  return high ? decide("expert", "expert") : undefined;
}

// Rule risky: the risk floor lifts the launch to deep, else the highest tier below expert.
function riskRule(
  answers: Record<string, Answer>,
  offered: readonly TierName[],
): TierDecision | undefined {
  const risky = answers["risky"];
  if (risky?.type !== "noul" || risky.noul <= RISK_FLOOR) return undefined;
  const target = deepOrHighest(offered);
  return target === undefined ? undefined : decide(target, "risky");
}

// Rule slot: an offered slot the model is sure of.
function slotRule(
  answers: Record<string, Answer>,
  slots: readonly string[],
): TierDecision | undefined {
  const tier = answers["tier"];
  if (tier?.type !== "choice") return undefined;
  const offeredSlot = slots.map(slotTarget).find((s) => s === tier.choice);
  if (offeredSlot === undefined) return undefined;
  return (tier.probabilities[offeredSlot] ?? 0) >= SLOT_BAR
    ? decide(offeredSlot, "slot")
    : undefined;
}

// The tier a score falls on between the cut points.
function cutTier(score: number, cuts: CutPoints): (typeof CUT_LADDER)[number] {
  if (score <= cuts.fastMax) return "fast";
  return score <= cuts.balancedMax ? "balanced" : "deep";
}

// The wanted tier if offered, else the nearest offered below it, else the nearest above. Never expert.
function nearestOffered(
  wanted: (typeof CUT_LADDER)[number],
  offered: readonly TierName[],
): TierName | undefined {
  const at = CUT_LADDER.indexOf(wanted);
  const below = CUT_LADDER.slice(0, at + 1).reverse();
  const above = CUT_LADDER.slice(at + 1);
  return [...below, ...above].find((t) => offered.includes(t));
}

function cutRule(
  score: number | undefined,
  offered: readonly TierName[],
  cuts: CutPoints,
): TierDecision | undefined {
  if (score === undefined) return undefined;
  const target = nearestOffered(cutTier(score, cuts), offered);
  return target === undefined ? undefined : decide(target, "cut");
}

// Rules in order: expert, risky, slot, cut. The first match wins.
export function decideTier(
  answers: WorkerAnswers,
  offered: readonly TierName[],
  cuts: CutPoints,
  slots: readonly string[] = [],
): TierDecision {
  if (answers.kind === "miss") return { kind: "none", reason: "miss" };
  if (answers.kind === "cancelled") return { kind: "none" };
  if (offered.length === 0 && slots.length === 0) return { kind: "none" };

  const given = answers.answers;
  const score = difficultyScore(given);
  return (
    expertRule(given, score, offered, cuts) ??
    riskRule(given, offered) ??
    slotRule(given, slots) ??
    cutRule(score, offered, cuts) ?? { kind: "none" }
  );
}

const SLOT_FALLBACK: readonly TierName[] = ["balanced", "fast"];

function firstRunning(
  candidates: readonly TierName[],
  offered: readonly TierName[],
  canRun: (t: Target) => boolean,
): TierName | undefined {
  return candidates.find((t) => t !== "expert" && offered.includes(t) && canRun(t));
}

export function chooseFallback(
  target: Target,
  offered: readonly TierName[],
  canRun: (t: Target) => boolean,
  slots: readonly string[] = [],
): FallbackResult {
  if (isSlot(target)) {
    if (slots.includes(slotName(target)) && canRun(target)) {
      return { kind: "keep", tier: target };
    }
    const moved = firstRunning(SLOT_FALLBACK, offered, canRun);
    return moved === undefined
      ? { kind: "unchanged" }
      : { kind: "moved", tier: moved, from: target };
  }
  if (offered.includes(target) && canRun(target)) return { kind: "keep", tier: target };
  const below = TIER_LADDER.slice(0, TIER_LADDER.indexOf(target)).reverse();
  const moved = firstRunning(below, offered, canRun);
  return moved === undefined ? { kind: "unchanged" } : { kind: "moved", tier: moved, from: target };
}
