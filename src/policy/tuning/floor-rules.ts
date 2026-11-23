// Pure per-band turn floor rules. Imports record.ts, never rules.ts.

import {
  BUILTIN_FLOORS,
  FLOOR_BANDS,
  FLOOR_PARAMETER,
  FLOOR_RANGES,
  type BandFloors,
  type FloorBand,
} from "../../shared/turn-floors.ts";
import { nearestRank, type CountedRun } from "./floor-runs.ts";
import {
  latestEntryAt,
  pushHistory,
  type FloorState,
  type TuningCause,
  type TuningEvent,
  type TuningRecord,
} from "./record.ts";

export const FLOOR = { runs: 200, blockRuns: 400, gap: 10, minMove: 10, unit: 10 } as const;

type Bounds = { lower?: number; upper?: number };
type Result = { record: TuningRecord; event?: TuningEvent };

const ceil10 = (x: number): number => Math.ceil(x / FLOOR.unit) * FLOOR.unit;
const floor10 = (x: number): number => Math.floor(x / FLOOR.unit) * FLOOR.unit;
const after = (runs: readonly CountedRun[], at: number): CountedRun[] =>
  runs.filter((r) => r.at > at);

/** The later of the band's `changedAt` and its latest history entry; 0 when neither exists. */
export function floorSince(record: TuningRecord, band: FloorBand): number {
  const changedAt = record.turnFloors?.[band]?.changedAt ?? 0;
  return Math.max(changedAt, latestEntryAt(record.history, FLOOR_PARAMETER(band)));
}

/** The latest 200 runs after `since`, when there are at least 200. */
export function floorWindow(runs: readonly CountedRun[], since: number): CountedRun[] | undefined {
  const later = after(runs, since);
  return later.length < FLOOR.runs ? undefined : later.slice(-FLOOR.runs);
}

/** Each band's tuned value when its base equals the built-in floor, else the built-in floor. */
export function effectiveFloors(record: TuningRecord): BandFloors {
  const out = { ...BUILTIN_FLOORS };
  for (const band of FLOOR_BANDS) {
    const tuned = record.turnFloors?.[band]?.tuned;
    if (tuned !== undefined && tuned.base === BUILTIN_FLOORS[band]) out[band] = tuned.value;
  }
  return out;
}

/** The neighbours' limits: a lower one counts at its higher end, an upper one at its lower end. */
export function orderBounds(band: FloorBand, effective: BandFloors, record: TuningRecord): Bounds {
  const at = FLOOR_BANDS.indexOf(band);
  const lowerBand = FLOOR_BANDS[at - 1];
  const upperBand = FLOOR_BANDS[at + 1];
  const bounds: Bounds = {};
  if (lowerBand !== undefined) {
    const p = record.turnFloors?.[lowerBand]?.pending;
    bounds.lower = p === undefined ? effective[lowerBand] : Math.max(p.from, p.to);
  }
  if (upperBand !== undefined) {
    const p = record.turnFloors?.[upperBand]?.pending;
    bounds.upper = p === undefined ? effective[upperBand] : Math.min(p.from, p.to);
  }
  return bounds;
}

/** True while fewer than 400 runs follow the block. */
export function blockActiveFloor(
  block: { at: number } | undefined,
  runs: readonly CountedRun[],
): boolean {
  return block !== undefined && after(runs, block.at).length < FLOOR.blockRuns;
}

const clamp = (x: number, min: number, max: number): number => Math.min(max, Math.max(min, x));

function applyBlock(value: number, current: number, block: { value: number } | undefined): number {
  if (block === undefined) return value;
  if (block.value > current && value >= block.value) return block.value - FLOOR.minMove;
  if (block.value < current && value <= block.value) return block.value + FLOOR.minMove;
  return value;
}

/** The next floor for a full window, or undefined when it would equal `current`. */
export function nextFloor(input: {
  band: FloorBand;
  current: number;
  window: readonly CountedRun[];
  bounds: Bounds;
  block?: { value: number };
}): number | undefined {
  const { band, current, window, bounds, block } = input;
  const p95 = nearestRank(
    window.map((r) => r.used).sort((a, b) => a - b),
    95,
  );
  if (p95 === undefined) return undefined;
  const up = Math.max(current + FLOOR.minMove, floor10((current * 5) / 4));
  const down = Math.min(current - FLOOR.minMove, ceil10((current * 3) / 4));
  const exhausted = window.filter((r) => r.phase === "exhausted").length;
  let value = exhausted * 20 > window.length ? up : ceil10((p95 * 5) / 4);
  value = clamp(value, down, up);
  value = clamp(value, FLOOR_RANGES[band].min, FLOOR_RANGES[band].max);
  value = clamp(
    value,
    (bounds.lower ?? -Infinity) + FLOOR.gap,
    (bounds.upper ?? Infinity) - FLOOR.gap,
  );
  value = applyBlock(value, current, block);
  return value === current ? undefined : value;
}

function withState(record: TuningRecord, band: FloorBand, state: FloorState): TuningRecord {
  return { ...record, turnFloors: { ...record.turnFloors, [band]: state } };
}

function withHistory(
  record: TuningRecord,
  band: FloorBand,
  e: { at: number; from: number; to: number; cause: TuningCause },
): TuningRecord {
  const entry = { ...e, parameter: FLOOR_PARAMETER(band) };
  return { ...record, history: pushHistory(record.history, entry) };
}

/** Sets the band's tuned floor to `to` with a pending change and a `rule` history entry. */
export function applyFloor(
  record: TuningRecord,
  c: {
    band: FloorBand;
    from: number;
    to: number;
    before: { runs: number; exhausted: number };
    now: number;
  },
): TuningRecord {
  const { band, from, to, before, now } = c;
  const state: FloorState = {
    changedAt: now,
    tuned: { value: to, base: BUILTIN_FLOORS[band] },
    pending: { from, to, at: now, before: { ...before } },
    ...(record.turnFloors?.[band]?.block === undefined
      ? {}
      : { block: record.turnFloors[band].block }),
  };
  return withHistory(withState(record, band, state), band, { at: now, from, to, cause: "rule" });
}

/** Reverts the band's pending change: restores `from`, blocks `to`, clears pending. */
export function revertFloor(record: TuningRecord, band: FloorBand, now: number): Result {
  const state = record.turnFloors?.[band];
  const pending = state?.pending;
  if (state === undefined || pending === undefined) return { record };
  const restored =
    pending.from === BUILTIN_FLOORS[band]
      ? {}
      : { tuned: { value: pending.from, base: BUILTIN_FLOORS[band] } };
  const next: FloorState = { changedAt: now, ...restored, block: { value: pending.to, at: now } };
  const entry = { at: now, from: pending.to, to: pending.from, cause: "revert" } as const;
  return {
    record: withHistory(withState(record, band, next), band, entry),
    event: {
      kind: "reverted",
      parameter: FLOOR_PARAMETER(band),
      from: pending.to,
      to: pending.from,
    },
  };
}

/** Judges a pending change once 200 runs follow it; otherwise no event. */
export function judgeFloor(
  record: TuningRecord,
  band: FloorBand,
  runs: readonly CountedRun[],
  now: number,
): Result {
  const state = record.turnFloors?.[band];
  const pending = state?.pending;
  if (state === undefined || pending === undefined) return { record };
  const judged = after(runs, pending.at).slice(0, FLOOR.runs);
  if (judged.length < FLOOR.runs) return { record };
  const exhausted = judged.filter((r) => r.phase === "exhausted").length;
  if (exhausted * pending.before.runs > pending.before.exhausted * FLOOR.runs) {
    return revertFloor(record, band, now);
  }
  const { pending: _cleared, ...rest } = state;
  return {
    record: withState(record, band, rest),
    event: { kind: "kept", parameter: FLOOR_PARAMETER(band), from: pending.from, to: pending.to },
  };
}

/** Drops a tuned floor whose base differs from the built-in floor. */
export function supersedeFloor(record: TuningRecord, band: FloorBand, now: number): Result {
  const tuned = record.turnFloors?.[band]?.tuned;
  const builtin = BUILTIN_FLOORS[band];
  if (tuned === undefined || tuned.base === builtin) return { record };
  const entry = { at: now, from: tuned.value, to: builtin, cause: "superseded" } as const;
  return {
    record: withHistory(withState(record, band, { changedAt: now }), band, entry),
    event: { kind: "superseded", parameter: FLOOR_PARAMETER(band), from: tuned.value, to: builtin },
  };
}
