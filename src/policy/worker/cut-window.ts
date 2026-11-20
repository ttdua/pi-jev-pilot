import type { WindowEntry } from "./cutpoints.ts";
import type { EffortLevel } from "../effort.ts";
import { TIER_LADDER, type TierName } from "../launch.ts";

export const WINDOW_MAX = 200;
export const WINDOW_MIN = 100;

/** Structural subset of the ledger worker line (policy/ cannot import store/). */
export interface WindowLine {
  readonly kind: string;
  readonly at: number;
  readonly rubric?: number;
  readonly score?: number;
  readonly frontierOffered?: boolean;
  readonly reason?: string;
  readonly tier?: string;
  readonly fallback?: string;
  /** Kept for old ledger lines; ignored. */
  readonly effortP?: Partial<Record<EffortLevel, number>>;
}

export interface RecentMix {
  readonly n: number;
  readonly shares?: Readonly<Record<TierName, number>>;
}

const WINDOW_REASONS: readonly string[] = ["frontier", "cut"];

function decidedTier(line: WindowLine): TierName | undefined {
  const name = line.fallback ?? line.tier;
  return TIER_LADDER.find((t) => t === name);
}

function toEntry(line: WindowLine): WindowEntry | undefined {
  const decided = decidedTier(line);
  if (decided === undefined || line.score === undefined) return undefined;
  return { score: line.score, decided };
}

export function windowEntries(lines: readonly WindowLine[], rubric: number): WindowEntry[] {
  return lines
    .filter(
      (l) =>
        l.kind === "worker" &&
        l.rubric === rubric &&
        typeof l.score === "number" &&
        l.frontierOffered === true &&
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
      basic: share("basic"),
      broad: share("broad"),
      deep: share("deep"),
      frontier: share("frontier"),
    },
  };
}
