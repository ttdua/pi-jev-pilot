// Pure cut points from a window of scores and a mode target. Imports nothing outside src/policy/.

import type { EffortLevel } from "./effort.ts";
import type { TierName } from "./launch.ts";
import type { ModeTarget } from "./modes.ts";

export interface CutPoints {
  readonly fastMax: number;
  readonly balancedMax: number;
  readonly expertMin: number;
}

export interface WindowEntry {
  readonly score: number;
  readonly effort: EffortLevel;
  readonly decided: TierName;
}

// Score at the 1-based position for `percent` of n, in whole-percent integer math.
function quantileAt(sorted: readonly number[], percent: number): number {
  const n = sorted.length;
  const pos = Math.min(Math.max(Math.floor((percent * n + 50) / 100), 1), n);
  return sorted[pos - 1] ?? Infinity;
}

// Lowest score above `balancedMax` among high-effort entries whose count at or above it fits the cap.
function expertCut(entries: readonly WindowEntry[], balancedMax: number, cap: number): number {
  const limit = Math.floor((cap * entries.length) / 100);
  if (limit <= 0) return Infinity;
  const scores = entries
    .filter((e) => (e.effort === "xhigh" || e.effort === "max") && e.score > balancedMax)
    .map((e) => e.score)
    .sort((a, b) => a - b);
  const fits = scores.find((s, i) => scores[i - 1] !== s && scores.length - i <= limit);
  return fits ?? Infinity;
}

export function cutPoints(entries: readonly WindowEntry[], target: ModeTarget): CutPoints {
  if (entries.length === 0)
    return { fastMax: Infinity, balancedMax: Infinity, expertMin: Infinity };
  const sorted = entries.map((e) => e.score).sort((a, b) => a - b);
  const fastMax = target.fast === 0 ? -Infinity : quantileAt(sorted, target.fast);
  const balancedMax = quantileAt(sorted, target.fast + target.balanced);
  return {
    fastMax,
    balancedMax,
    expertMin: expertCut(entries, balancedMax, target.expertCap),
  };
}
