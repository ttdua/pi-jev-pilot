// Pure tier decision and fallback. Imports nothing outside src/policy/.

import { TIER_LADDER, type TierName } from "./launch.ts";
import { expertAdmitted, type ModeName } from "./modes.ts";
import type { WorkerAnswers } from "./worker.ts";

export type TierDecision =
  | {
      kind: "decided";
      tier: TierName;
      reason: "expert-admitted" | "risky" | "expert-denied" | "fast-unsure" | "choice";
    }
  | { kind: "none"; reason?: "miss" };

export type FallbackResult =
  | { kind: "keep"; tier: TierName }
  | { kind: "moved"; tier: TierName; from: TierName }
  | { kind: "unchanged" };

type Decided = Extract<TierDecision, { kind: "decided" }>;

function decide(tier: TierName, reason: Decided["reason"]): TierDecision {
  return { kind: "decided", tier, reason };
}

// Highest offered tier below expert, scanning deep down to fast.
function highestBelowExpert(offered: readonly TierName[]): TierName | undefined {
  return (["deep", "balanced", "fast"] as const).find((t) => offered.includes(t));
}

function deepOrHighest(offered: readonly TierName[]): TierName | undefined {
  return offered.includes("deep") ? "deep" : highestBelowExpert(offered);
}

export function decideTier(
  answers: WorkerAnswers,
  offered: readonly TierName[],
  mode: ModeName,
): TierDecision {
  if (answers.kind === "miss") return { kind: "none", reason: "miss" };
  if (answers.kind === "cancelled") return { kind: "none" };
  if (offered.length === 0) return { kind: "none" };

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
  // Rule 3: expert denied.
  if (choice.choice === "expert") {
    const target = deepOrHighest(offered);
    return target === undefined ? { kind: "none" } : decide(target, "expert-denied");
  }
  const picked = choice.choice as TierName;
  // Rule 4: unsure fast.
  if (picked === "fast" && (choice.probabilities["fast"] ?? 0) < 0.6) {
    const target = (["balanced", "deep"] as const).find((t) => offered.includes(t));
    if (target !== undefined) return decide(target, "fast-unsure");
  }
  // Rule 5: choice.
  return decide(picked, "choice");
}

export function chooseFallback(
  tier: TierName,
  offered: readonly TierName[],
  canRun: (t: TierName) => boolean,
): FallbackResult {
  if (offered.includes(tier) && canRun(tier)) return { kind: "keep", tier };
  const below = TIER_LADDER.slice(0, TIER_LADDER.indexOf(tier)).reverse();
  for (const t of below) {
    if (t === "expert" || !offered.includes(t)) continue;
    if (canRun(t)) return { kind: "moved", tier: t, from: tier };
  }
  return { kind: "unchanged" };
}
