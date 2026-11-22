// Pure turn bands for the worker `turns` question. Imports nothing outside src/policy/.

import type { Answer } from "../answers.ts";
import { canRaiseTurns, type EffectiveLaunch } from "../launch.ts";

/** Turn bands in the order Jev is asked to choose from. */
export const TURN_BANDS = ["short", "medium", "long", "very_long"] as const;

export type TurnBand = (typeof TURN_BANDS)[number];

/** The smallest turn limit each band asks for; `short` raises nothing. */
export const BAND_FLOOR: Readonly<Partial<Record<TurnBand, number>>> = {
  medium: 40,
  long: 100,
  very_long: 200,
};

const LONGEST_FIRST: readonly TurnBand[] = ["very_long", "long", "medium"];
const BAR = 0.5;
const TOLERANCE = 1e-9;

/**
 * The floor of the first band, from the longest down, whose probability plus those of all longer
 * bands reaches the bar. Missing bands count as 0 and nothing is normalised.
 */
export function turnFloor(answer: Answer | undefined): number | undefined {
  if (answer?.type !== "choice") return undefined;
  let cumulative = 0;
  for (const band of LONGEST_FIRST) {
    cumulative += answer.probabilities[band] ?? 0;
    if (cumulative >= BAR - TOLERANCE) return BAND_FLOOR[band];
  }
  return undefined;
}

/** The `maxTurns` to write: the floor, only when the launch can raise and the floor is higher. */
export function turnWrite(floor: number | undefined, launch: EffectiveLaunch): number | undefined {
  if (floor === undefined || !canRaiseTurns(launch)) return undefined;
  return launch.maxTurns !== undefined && floor > launch.maxTurns ? floor : undefined;
}
