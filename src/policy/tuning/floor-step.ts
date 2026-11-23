// Band floors inside the multi-parameter step, undo and reset. Imports record.ts and floor modules.

import {
  BUILTIN_FLOORS,
  FLOOR_BANDS,
  FLOOR_PARAMETER,
  type FloorBand,
} from "../../shared/turn-floors.ts";
import {
  applyFloor,
  blockActiveFloor,
  effectiveFloors,
  FLOOR,
  floorSince,
  floorWindow,
  judgeFloor,
  nextFloor,
  orderBounds,
  supersedeFloor,
} from "./floor-rules.ts";
import { countedRuns } from "./floor-runs.ts";
import {
  latestEntryAt,
  pushHistory,
  type TuningEvent,
  type TuningLine,
  type TuningParameter,
  type TuningRecord,
} from "./record.ts";

export type FloorStep = { record: TuningRecord; events: TuningEvent[] };

/** Runs `each` over the bands in order, threading the record and collecting events. */
function overBands(
  record: TuningRecord,
  each: (record: TuningRecord, band: FloorBand) => { record: TuningRecord; event?: TuningEvent },
): FloorStep {
  let current = record;
  const events: TuningEvent[] = [];
  for (const band of FLOOR_BANDS) {
    const out = each(current, band);
    current = out.record;
    if (out.event !== undefined) events.push(out.event);
  }
  return { record: current, events };
}

export const supersedeFloors = (record: TuningRecord, now: number): FloorStep =>
  overBands(record, (r, band) => supersedeFloor(r, band, now));

export const judgeFloors = (
  record: TuningRecord,
  lines: readonly TuningLine[],
  now: number,
): FloorStep => overBands(record, (r, band) => judgeFloor(r, band, countedRuns(lines, band), now));

/** Applies the first band whose rule changes its floor; at most one band per call. */
export function applyFirstFloor(
  record: TuningRecord,
  lines: readonly TuningLine[],
  now: number,
): FloorStep {
  for (const band of FLOOR_BANDS) {
    const out = tryBand(record, band, lines, now);
    if (out !== undefined) return { record: out.record, events: [out.event] };
  }
  return { record, events: [] };
}

function tryBand(
  record: TuningRecord,
  band: FloorBand,
  lines: readonly TuningLine[],
  now: number,
): { record: TuningRecord; event: TuningEvent } | undefined {
  const state = record.turnFloors?.[band];
  if (state?.pending !== undefined) return undefined;
  const runs = countedRuns(lines, band);
  const window = floorWindow(runs, floorSince(record, band));
  if (window === undefined) return undefined;
  const effective = effectiveFloors(record);
  const current = effective[band];
  const block = blockActiveFloor(state?.block, runs) ? state?.block : undefined;
  const bounds = orderBounds(band, effective, record);
  const to = nextFloor({ band, current, window, bounds, ...(block ? { block } : {}) });
  if (to === undefined) return undefined;
  const exhausted = window.filter((r) => r.phase === "exhausted").length;
  const before = { runs: window.length, exhausted };
  return {
    record: applyFloor(record, { band, from: current, to, before, now }),
    event: { kind: "applied", parameter: FLOOR_PARAMETER(band), from: current, to },
  };
}

/** What undo moves: `timeoutMs` to `target`, or a band floor from `from` to `target`. */
export type UndoTarget =
  | { parameter: "timeoutMs"; target: number }
  | { parameter: TuningParameter; band: FloorBand; from: number; target: number };

/**
 * The `from` of the latest `rule` entry of `parameter` that raised or lowered to `value` and was
 * not undone. Each `undo` reverses one earlier `rule` entry with the opposite transition, newest first.
 */
export function ruleOrigin(
  history: TuningRecord["history"],
  parameter: TuningParameter,
  value: number,
): number | undefined {
  const undos: Array<{ from: number; to: number }> = [];
  for (const h of [...(history ?? [])].reverse()) {
    if (h.parameter !== parameter) continue;
    if (h.cause === "undo") undos.push({ from: h.from, to: h.to });
    if (h.cause !== "rule") continue;
    const undone = undos.findIndex((u) => u.from === h.to && u.to === h.from);
    if (undone >= 0) undos.splice(undone, 1);
    else if (h.to === value) return h.from;
  }
  return undefined;
}

type Candidate = UndoTarget & { since: number };

function timeoutCandidate(record: TuningRecord, untuned: number | undefined): Candidate[] {
  const tuned = record.timeoutMs;
  if (tuned === undefined || (untuned !== undefined && tuned.base !== untuned)) return [];
  const origin = ruleOrigin(record.history, "timeoutMs", tuned.value);
  const target = origin !== undefined && origin !== tuned.base ? origin : tuned.base;
  return [{ parameter: "timeoutMs", target, since: latestEntryAt(record.history, "timeoutMs") }];
}

function floorCandidate(record: TuningRecord, band: FloorBand): Candidate[] {
  const tuned = record.turnFloors?.[band]?.tuned;
  if (tuned === undefined || tuned.base !== BUILTIN_FLOORS[band]) return [];
  const parameter = FLOOR_PARAMETER(band);
  const origin = ruleOrigin(record.history, parameter, tuned.value) ?? tuned.base;
  const { lower, upper } = orderBounds(band, effectiveFloors(record), record);
  const ordered = Math.min(
    upper === undefined ? Infinity : upper - FLOOR.gap,
    Math.max(lower === undefined ? -Infinity : lower + FLOOR.gap, origin),
  );
  if (ordered === tuned.value) return [];
  return [{ parameter, band, from: tuned.value, target: ordered, since: floorSince(record, band) }];
}

/**
 * The parameter to undo and its target: the most recently changed one whose tuned value applies
 * (`untuned` omitted: `timeoutMs` applies when tuned), skipping a band the order leaves in place.
 */
export function pickUndoTarget(
  record: TuningRecord,
  untuned: number | undefined,
): UndoTarget | undefined {
  const candidates = [
    ...timeoutCandidate(record, untuned),
    ...FLOOR_BANDS.flatMap((band) => floorCandidate(record, band)),
  ];
  // Array.prototype.sort is stable, so ties keep the fixed parameter order.
  const [best] = candidates.sort((a, b) => b.since - a.since);
  if (best === undefined) return undefined;
  const { since: _since, ...target } = best;
  return target;
}

/** Moves the band's floor to `target`, blocks the undone value and adds an `undo` entry. */
export function undoFloor(
  record: TuningRecord,
  band: FloorBand,
  target: { from: number; to: number },
  now: number,
): TuningRecord {
  const { from: current, to } = target;
  const builtin = BUILTIN_FLOORS[band];
  const state = {
    changedAt: now,
    ...(to === builtin ? {} : { tuned: { value: to, base: builtin } }),
    block: { value: current, at: now },
  };
  const entry = {
    at: now,
    parameter: FLOOR_PARAMETER(band),
    from: current,
    to,
    cause: "undo",
  } as const;
  return {
    ...record,
    turnFloors: { ...record.turnFloors, [band]: state },
    history: pushHistory(record.history, entry),
  };
}

/** Drops every band's floor state; a `reset` entry per tuned floor, in band order. */
export function resetFloors(record: TuningRecord, now: number): TuningRecord {
  const { turnFloors, ...rest } = record;
  let history = rest.history;
  for (const band of FLOOR_BANDS) {
    const tuned = turnFloors?.[band]?.tuned;
    if (tuned === undefined) continue;
    const entry = {
      at: now,
      parameter: FLOOR_PARAMETER(band),
      from: tuned.value,
      to: BUILTIN_FLOORS[band],
      cause: "reset",
    } as const;
    history = pushHistory(history, entry);
  }
  return history === undefined ? rest : { ...rest, history };
}
