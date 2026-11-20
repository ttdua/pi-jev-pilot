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
import { difficultyScore } from "./score.ts";
import type { WorkerAnswers } from "./answers.ts";

export type TierDecision =
  | {
      kind: "decided";
      tier: Target;
      reason: "frontier" | "slot" | "cut";
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

const SLOT_BAR = 0.6;
const CUT_LADDER = ["basic", "broad", "deep"] as const;

// Rule frontier: the score reaches the launch's frontier cut. Wins over slots; never reads effort.
function frontierRule(
  score: number | undefined,
  offered: readonly TierName[],
  cuts: CutPoints,
): TierDecision | undefined {
  if (score === undefined || !offered.includes("frontier") || score < cuts.frontierMin) {
    return undefined;
  }
  return decide("frontier", "frontier");
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
  if (score <= cuts.basicMax) return "basic";
  return score <= cuts.broadMax ? "broad" : "deep";
}

// The wanted tier if offered, else the nearest offered below it, else the nearest above. Never frontier.
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

// Rules in order: frontier, slot, cut. The first match wins.
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
    frontierRule(score, offered, cuts) ??
    slotRule(given, slots) ??
    cutRule(score, offered, cuts) ?? { kind: "none" }
  );
}

const SLOT_FALLBACK: readonly TierName[] = ["broad", "basic"];

function firstRunning(
  candidates: readonly TierName[],
  offered: readonly TierName[],
  canRun: (t: Target) => boolean,
): TierName | undefined {
  return candidates.find((t) => t !== "frontier" && offered.includes(t) && canRun(t));
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
