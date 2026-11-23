// Pure turn bands for the worker `turns` question. Imports only policy and shared.

import type { Answer } from "../answers.ts";
import { FLOOR_BANDS, type BandFloors, type FloorBand } from "../../shared/turn-floors.ts";
import { canRaiseTurns, type EffectiveLaunch } from "../launch.ts";

/** Turn bands in the order Jev is asked to choose from. */
export const TURN_BANDS = ["short", "medium", "long", "very_long"] as const;

export type TurnBand = (typeof TURN_BANDS)[number];

const LONGEST_FIRST: readonly FloorBand[] = [...FLOOR_BANDS].reverse();
const BAR = 0.5;
const TOLERANCE = 1e-9;

/**
 * The first band, from the longest down, whose probability plus those of all longer bands reaches
 * the bar. Missing bands count as 0 and nothing is normalised.
 */
export function turnBand(
  probabilities: Readonly<Record<string, number>> | undefined,
): FloorBand | undefined {
  let cumulative = 0;
  for (const band of LONGEST_FIRST) {
    cumulative += probabilities?.[band] ?? 0;
    if (cumulative >= BAR - TOLERANCE) return band;
  }
  return undefined;
}

/** The floor of the band `turnBand` picks, from the given floors. */
export function turnFloor(answer: Answer | undefined, floors: BandFloors): number | undefined {
  if (answer?.type !== "choice") return undefined;
  const band = turnBand(answer.probabilities);
  return band === undefined ? undefined : floors[band];
}

/** The `maxTurns` to write: the floor, only when the launch can raise and the floor is higher. */
export function turnWrite(floor: number | undefined, launch: EffectiveLaunch): number | undefined {
  if (floor === undefined || !canRaiseTurns(launch)) return undefined;
  return launch.maxTurns !== undefined && floor > launch.maxTurns ? floor : undefined;
}
