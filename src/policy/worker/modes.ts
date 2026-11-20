// Pure mode names and target shares. Imports nothing outside src/policy/.

export const MODE_NAMES = ["budget", "standard", "premium"] as const;
export type ModeName = (typeof MODE_NAMES)[number];

// Target share of launches per tier, in whole percents. Cut points are derived from these.
export interface ModeTarget {
  readonly basic: number;
  readonly broad: number;
  readonly deep: number;
  readonly frontierCap: number;
}

export const MODE_TARGETS: Readonly<Record<ModeName, ModeTarget>> = {
  budget: { basic: 50, broad: 40, deep: 10, frontierCap: 0 },
  standard: { basic: 20, broad: 53, deep: 26, frontierCap: 1 },
  premium: { basic: 0, broad: 50, deep: 47, frontierCap: 3 },
};
