import type { WindowEntry } from "./cutpoints.ts";
import { EFFORT_LEVELS, type EffortLevel } from "../effort.ts";
import { TIER_LADDER, type TierName } from "../launch.ts";

export const WINDOW_MAX = 200;
export const WINDOW_MIN = 100;

/** Structural subset of the ledger worker line (policy/ cannot import store/). */
export interface WindowLine {
  readonly kind: string;
  readonly at: number;
  readonly rubric?: number;
  readonly score?: number;
  readonly expertOffered?: boolean;
  readonly reason?: string;
  readonly tier?: string;
  readonly fallback?: string;
  readonly effortP?: Partial<Record<EffortLevel, number>>;
}

export interface RecentMix {
  readonly n: number;
  readonly shares?: Readonly<Record<TierName, number>>;
}

const WINDOW_REASONS: readonly string[] = ["expert", "risky", "cut"];

function decidedTier(line: WindowLine): TierName | undefined {
  const name = line.fallback ?? line.tier;
  return TIER_LADDER.find((t) => t === name);
}

// Argmax of the effort distribution; ties go to the higher level, no distribution means `high`.
function modalEffort(effortP: WindowLine["effortP"]): EffortLevel {
  if (!effortP) return "high";
  let best: EffortLevel = "high";
  let bestP = -Infinity;
  for (const level of EFFORT_LEVELS) {
    const p = effortP[level];
    if (p !== undefined && p >= bestP) {
      best = level;
      bestP = p;
    }
  }
  return best;
}

function toEntry(line: WindowLine): WindowEntry | undefined {
  const decided = decidedTier(line);
  if (decided === undefined || line.score === undefined) return undefined;
  return { score: line.score, effort: modalEffort(line.effortP), decided };
}

export function windowEntries(lines: readonly WindowLine[], rubric: number): WindowEntry[] {
  return lines
    .filter(
      (l) =>
        l.kind === "worker" &&
        l.rubric === rubric &&
        typeof l.score === "number" &&
        l.expertOffered === true &&
        l.reason !== undefined &&
        WINDOW_REASONS.includes(l.reason) &&
        decidedTier(l) !== undefined,
    )
    .sort((a, b) => a.at - b.at)
    .slice(-WINDOW_MAX)
    .flatMap((l) => toEntry(l) ?? []);
}

export function recentMix(window: readonly WindowEntry[]): RecentMix {
  const n = window.length;
  if (n === 0) return { n };
  const share = (tier: TierName): number =>
    Math.round((100 * window.filter((e) => e.decided === tier).length) / n);
  return {
    n,
    shares: {
      fast: share("fast"),
      balanced: share("balanced"),
      deep: share("deep"),
      expert: share("expert"),
    },
  };
}
