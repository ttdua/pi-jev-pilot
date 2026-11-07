// Pure mode names and target shares. Imports nothing outside src/policy/.

export const MODE_NAMES = ["budget", "standard", "premium"] as const;
export type ModeName = (typeof MODE_NAMES)[number];

// Target share of launches per tier, in whole percents. Cut points are derived from these.
export interface ModeTarget {
  readonly fast: number;
  readonly balanced: number;
  readonly deep: number;
  readonly expertCap: number;
}

export const MODE_TARGETS: Readonly<Record<ModeName, ModeTarget>> = {
  budget: { fast: 50, balanced: 40, deep: 10, expertCap: 0 },
  standard: { fast: 20, balanced: 53, deep: 25, expertCap: 2 },
  premium: { fast: 0, balanced: 50, deep: 45, expertCap: 5 },
};
