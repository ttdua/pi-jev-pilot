// Observed per-band turn signals for the tune report. Pure: inputs are never mutated.

import { FLOOR_BANDS, type BandFloors, type FloorBand } from "../../shared/turn-floors.ts";
import { countedRuns, nearestRank, type CountedRun } from "./floor-runs.ts";
import { FLOOR, nextFloor, orderBounds } from "./floor-rules.ts";
import type { TuningLine } from "./record.ts";

export type TurnSignal = {
  band: FloorBand;
  runs: number;
  p90?: number;
  p95?: number;
  exhausted?: number;
  warned?: number;
  usedOverFloor?: number;
  suggested?: number;
};

const P90 = 90;
const P95 = 95;

function usedOverFloor(window: readonly CountedRun[]): number | undefined {
  const ratios = window.flatMap((r) =>
    r.floor === undefined || r.floor === 0 ? [] : [r.used / r.floor],
  );
  return ratios.length === 0 ? undefined : ratios.reduce((a, b) => a + b, 0) / ratios.length;
}

function suggestion(band: FloorBand, window: readonly CountedRun[], floors: BandFloors): number {
  const bounds = orderBounds(band, floors, {});
  return nextFloor({ band, current: floors[band], window, bounds }) ?? floors[band];
}

function signalOf(band: FloorBand, all: readonly CountedRun[], floors: BandFloors): TurnSignal {
  const window = all.slice(-FLOOR.runs);
  if (window.length === 0) return { band, runs: 0 };
  const used = window.map((r) => r.used).sort((a, b) => a - b);
  const ratio = usedOverFloor(window);
  return {
    band,
    runs: window.length,
    p90: nearestRank(used, P90),
    p95: nearestRank(used, P95),
    exhausted: window.filter((r) => r.phase === "exhausted").length,
    warned: window.filter((r) => r.phase === "warned").length,
    ...(ratio === undefined ? {} : { usedOverFloor: ratio }),
    ...(window.length === FLOOR.runs ? { suggested: suggestion(band, window, floors) } : {}),
  };
}

/** One signal per band, in `FLOOR_BANDS` order, over each band's latest 200 counted runs. */
export function turnSignals(lines: readonly TuningLine[], floors: BandFloors): TurnSignal[] {
  return FLOOR_BANDS.map((band) => signalOf(band, countedRuns(lines, band), floors));
}
