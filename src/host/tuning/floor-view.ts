// Floor parts of the tune view: the floors line, floor pending and floor block lines.
import { BUILTIN_FLOORS, FLOOR_BANDS } from "../../shared/turn-floors.ts";
import {
  FLOOR,
  blockActiveFloor,
  countedRuns,
  type TuningLine,
  type TuneView,
} from "../../policy/tuning/index.ts";
import type { TuningDocument } from "../../store/tuning-file.ts";
import type { Snapshot } from "../platform/index.ts";

const runsAfter = (runs: readonly { at: number }[], at: number): number =>
  runs.filter((r) => r.at > at).length;

/** Effective floors; `tunedFrom` only while the config is valid and the tuned value applies. */
export function floorsView(snapshot: Snapshot): TuneView["floors"] {
  const resolved = snapshot.settings.turnFloors;
  return FLOOR_BANDS.map((band) => {
    const tuned = snapshot.tuning.record.turnFloors?.[band]?.tuned;
    const applies =
      snapshot.config.valid &&
      tuned !== undefined &&
      tuned.base === BUILTIN_FLOORS[band] &&
      tuned.value === resolved[band];
    return { band, value: resolved[band], ...(applies ? { tunedFrom: tuned.base } : {}) };
  });
}

/** Each band's pending change, from the record, with its counted runs since capped at 200. */
export function floorPendingOf(
  record: TuningDocument,
  lines: readonly TuningLine[],
): TuneView["floorPending"] {
  return FLOOR_BANDS.flatMap((band) => {
    const p = record.turnFloors?.[band]?.pending;
    if (p === undefined) return [];
    const since = Math.min(runsAfter(countedRuns(lines, band), p.at), FLOOR.runs);
    return [{ band, from: p.from, to: p.to, since }];
  });
}

/** Each band's active block, from the record, with the counted runs left until it ends. */
export function floorBlockOf(
  record: TuningDocument,
  lines: readonly TuningLine[],
): TuneView["floorBlocks"] {
  return FLOOR_BANDS.flatMap((band) => {
    const b = record.turnFloors?.[band]?.block;
    const runs = countedRuns(lines, band);
    if (b === undefined || !blockActiveFloor(b, runs)) return [];
    return [{ band, value: b.value, remaining: FLOOR.blockRuns - runsAfter(runs, b.at) }];
  });
}
