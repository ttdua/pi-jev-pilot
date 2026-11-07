// Pure tier decision and fallback. Imports nothing outside src/policy/.

import { isSlot, slotTarget, TIER_LADDER, type Target, type TierName } from "./launch.ts";
import { expertAdmitted, type ModeName } from "./modes.ts";
import type { Answer } from "./answers.ts";
import type { WorkerAnswers } from "./worker.ts";

export type TierDecision =
  | {
      kind: "decided";
      tier: Target;
      reason: "expert-admitted" | "risky" | "expert-denied" | "fast-unsure" | "choice" | "slot";
    }
  | { kind: "none"; reason?: "miss" };

export type FallbackResult =
  | { kind: "keep"; tier: Target }
  | { kind: "moved"; tier: Target; from: Target }
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

type ChoiceAnswer = Extract<Answer, { type: "choice" }>;

const SLOT_BAR = 0.6;

// A slot choice below the bar becomes the offered tier of highest probability.
// Ties keep the lower tier, because the ladder is scanned upward.
function substituteTier(choice: ChoiceAnswer, offered: readonly TierName[]): TierName | undefined {
  let best: TierName | undefined;
  let bestP = -1;
  for (const t of TIER_LADDER) {
    if (!offered.includes(t)) continue;
    const p = choice.probabilities[t] ?? 0;
    if (p > bestP) {
      best = t;
      bestP = p;
    }
  }
  return best;
}

function slotDecision(choice: ChoiceAnswer, slots: readonly string[]): TierDecision | undefined {
  const offeredSlot = slots.map(slotTarget).find((s) => s === choice.choice);
  if (offeredSlot === undefined) return undefined;
  return (choice.probabilities[offeredSlot] ?? 0) >= SLOT_BAR
    ? decide(offeredSlot, "slot")
    : undefined;
}

// Rules 3 to 5, on a choice that is a tier.
function decideFromTierChoice(
  picked: string,
  choice: ChoiceAnswer,
  offered: readonly TierName[],
): TierDecision {
  // Rule 3: expert denied.
  if (picked === "expert") {
    const target = deepOrHighest(offered);
    return target === undefined ? { kind: "none" } : decide(target, "expert-denied");
  }
  // Rule 4: unsure fast.
  if (picked === "fast" && (choice.probabilities["fast"] ?? 0) < 0.6) {
    const target = (["balanced", "deep"] as const).find((t) => offered.includes(t));
    if (target !== undefined) return decide(target, "fast-unsure");
  }
  // Rule 5: choice.
  return decide(picked as TierName, "choice");
}

export function decideTier(
  answers: WorkerAnswers,
  offered: readonly TierName[],
  mode: ModeName,
  slots: readonly string[] = [],
): TierDecision {
  if (answers.kind === "miss") return { kind: "none", reason: "miss" };
  if (answers.kind === "cancelled") return { kind: "none" };
  if (offered.length === 0 && slots.length === 0) return { kind: "none" };

  const tier = answers.answers["tier"];
  const choice = tier?.type === "choice" ? tier : undefined;
  const risky = answers.answers["risky"];
  const riskyValue = risky?.type === "noul" ? risky.noul : undefined;

  // Rule 1: expert admitted by the mode's gate.
  if (offered.includes("expert") && expertAdmitted(mode, answers.answers)) {
    return decide("expert", "expert-admitted");
  }
  // Rule 2: risk floor.
  if (riskyValue !== undefined && riskyValue > 0.7) {
    const target = deepOrHighest(offered);
    if (target !== undefined) return decide(target, "risky");
  }
  if (choice === undefined) return { kind: "none" };
  // Rule slot: an offered slot the model is sure of.
  const bySlot = slotDecision(choice, slots);
  if (bySlot !== undefined) return bySlot;
  if (!choice.choice.startsWith("slot::")) {
    return decideFromTierChoice(choice.choice, choice, offered);
  }
  const substitute = substituteTier(choice, offered);
  return substitute === undefined
    ? { kind: "none" }
    : decideFromTierChoice(substitute, choice, offered);
}

export function chooseFallback(
  tier: Target,
  offered: readonly TierName[],
  canRun: (t: Target) => boolean,
): FallbackResult {
  // The slot ladder arrives with the slot fallback.
  if (isSlot(tier)) return { kind: "unchanged" };
  if (offered.includes(tier) && canRun(tier)) return { kind: "keep", tier };
  const below = TIER_LADDER.slice(0, TIER_LADDER.indexOf(tier)).reverse();
  for (const t of below) {
    if (t === "expert" || !offered.includes(t)) continue;
    if (canRun(t)) return { kind: "moved", tier: t, from: tier };
  }
  return { kind: "unchanged" };
}
