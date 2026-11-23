// Tuning rules: record shape, events and constants. Pure; no I/O.

import { after, counts, decisions, p90, type Counts, type DecisionLine } from "./window.ts";
import {
  applyFirstFloor,
  judgeFloors,
  pickUndoTarget,
  resetFloors,
  ruleOrigin,
  supersedeFloors,
  undoFloor,
} from "./floor-step.ts";
import {
  activeBlock,
  applyChange,
  ceilTo,
  clamp,
  timeoutEntry,
  type StepInput,
  type StepResult,
} from "./timeout-change.ts";
import { burstRule, judgeTimeout, keptRecord, lowerRule } from "./timeout-rules.ts";
import {
  latestEntryAt,
  pushHistory,
  TUNING,
  type HistoryEntry,
  type TuningCause,
  type TuningEvent,
  type TuningParameter,
  type TuningRecord,
} from "./record.ts";

export { applyChange, pushHistory, TUNING };
export type { StepInput, StepResult };
export type { Counts, HistoryEntry, TuningCause, TuningEvent, TuningRecord };

/** Whether the timeout share of a full window is above 1/shareDenominator. */
export function fires(window: readonly DecisionLine[]): boolean {
  if (window.length !== TUNING.window) return false;
  const { asked, timeouts } = counts(window);
  return asked >= TUNING.minAsked && timeouts * TUNING.shareDenominator > asked;
}

/** True while fewer than `blockFor` decisions follow the block. */
export function blockActive(block: TuningRecord["block"], ds: readonly DecisionLine[]): boolean {
  if (block === undefined) return false;
  return after(decisions(ds), block.at).length < TUNING.blockFor;
}

/** The raised value, or undefined when it would not be above `current`. */
export function nextValue(
  current: number,
  window: readonly DecisionLine[],
  block: { value: number } | undefined,
): number | undefined {
  const stepped = current + TUNING.step;
  const observed = p90(window);
  const wanted =
    observed === undefined
      ? stepped
      : Math.max(stepped, ceilTo(observed * TUNING.p90Factor, TUNING.roundTo));
  let value = clamp(wanted);
  if (block !== undefined && value >= block.value) value = block.value - TUNING.roundTo;
  return value > current ? value : undefined;
}

/** Judges a pending change once `TUNING.window` decisions follow it; otherwise no event. */
export function evaluatePending(
  record: TuningRecord,
  ds: readonly DecisionLine[],
  now: number,
): StepResult {
  const { pending } = record;
  if (pending === undefined) return { record };
  const judged = after(decisions(ds), pending.at).slice(0, TUNING.window);
  if (judged.length < TUNING.window) return { record };
  const { pending: _cleared, ...rest } = record;
  if (judgeTimeout(pending, judged) === "reverted") {
    return { record: revertedRecord(rest, pending, now), event: revertedEvent(pending) };
  }
  const kept = {
    kind: "kept",
    parameter: "timeoutMs",
    from: pending.from,
    to: pending.to,
  } as const;
  return { record: keptRecord(rest), event: kept };
}

function revertedEvent(p: { from: number; to: number }): TuningEvent {
  return { kind: "reverted", parameter: "timeoutMs", from: p.to, to: p.from };
}

function revertedRecord(
  rest: TuningRecord,
  p: { from: number; to: number },
  now: number,
): TuningRecord {
  const { timeoutMs, ...others } = rest;
  const restored =
    timeoutMs === undefined || p.from === timeoutMs.base
      ? {}
      : { timeoutMs: { ...timeoutMs, value: p.from } };
  return {
    ...others,
    ...restored,
    block: { value: p.to, at: now },
    history: pushHistory(rest.history, timeoutEntry(now, p.to, p.from, "revert")),
  };
}

/** Drops tuning state when the config's untuned value no longer matches the tuned base. */
export function supersede(record: TuningRecord, untuned: number, now: number): StepResult {
  const tuned = record.timeoutMs;
  if (tuned === undefined || tuned.base === untuned) return { record };
  const { timeoutMs: _t, pending: _p, block: _b, ...rest } = record;
  return {
    record: {
      ...rest,
      history: pushHistory(record.history, timeoutEntry(now, tuned.value, untuned, "superseded")),
    },
    event: { kind: "superseded", parameter: "timeoutMs", from: tuned.value, to: untuned },
  };
}

const inRange = (x: number): boolean => x >= TUNING.min && x <= TUNING.max;

/** Drops a `pending` that has no tuned value to belong to. */
function dropOrphanPending(record: TuningRecord): TuningRecord {
  if (record.pending === undefined || record.timeoutMs !== undefined) return record;
  const { pending: _orphan, ...rest } = record;
  return rest;
}

/** The latest 40 decisions once 40 have followed the latest `timeoutMs` entry; else none. */
function cooledWindow(record: TuningRecord, ds: readonly DecisionLine[]): DecisionLine[] {
  const lastAt = latestEntryAt(record.history, "timeoutMs");
  const since = after(ds, lastAt);
  return since.length < TUNING.cooldown ? [] : since.slice(-TUNING.window);
}

/** Applies the rule when the window fires; the block counts only while active. */
function fireRule(input: StepInput, record: TuningRecord): StepResult {
  const { untuned, lines, now } = input;
  if (record.pending !== undefined) return { record };
  const ds = decisions(lines);
  const window = cooledWindow(record, ds);
  if (!fires(window)) return { record };
  const from = record.timeoutMs?.value ?? untuned;
  const active = activeBlock(record, untuned, ds);
  const to = nextValue(from, window, active?.direction === "raise" ? active : undefined);
  if (to === undefined) return { record };
  const change = { from, to, base: untuned, before: counts(window), now };
  const event = { kind: "applied", parameter: "timeoutMs", from, to } as const;
  return { record: applyChange(record, change), event };
}

const present = (events: Array<TuningEvent | undefined>): TuningEvent[] =>
  events.filter((e) => e !== undefined);

/** One tuning step: supersede, judge pending changes, then at most one applied change. */
export function stepTuning(input: StepInput): { record: TuningRecord; events: TuningEvent[] } {
  const { record, untuned, lines, now } = input;
  if (record.off === true || !inRange(untuned)) return { record, events: [] };
  const superseded = supersede(dropOrphanPending(record), untuned, now);
  const supersededFloors = supersedeFloors(superseded.record, now);
  const judged = evaluatePending(supersededFloors.record, lines, now);
  const judgedFloors = judgeFloors(judged.record, lines, now);
  const head = [
    ...present([superseded.event]),
    ...supersededFloors.events,
    ...present([judged.event]),
    ...judgedFloors.events,
  ];
  if (head.some((e) => e.kind === "reverted")) return { record: judgedFloors.record, events: head };
  const fired = firstApplied(input, judgedFloors.record, [burstRule, fireRule, lowerRule]);
  if (fired.event !== undefined) {
    return { record: fired.record, events: [...head, fired.event] };
  }
  const floor = applyFirstFloor(fired.record, lines, now);
  return { record: floor.record, events: [...head, ...floor.events] };
}

type Rule = (input: StepInput, record: TuningRecord) => StepResult;

/** The first rule that applies a change; the record unchanged when none does. */
function firstApplied(input: StepInput, record: TuningRecord, rules: readonly Rule[]): StepResult {
  for (const rule of rules) {
    const out = rule(input, record);
    if (out.event !== undefined) return out;
  }
  return { record };
}

export type UndoResult =
  | {
      kind: "undone";
      record: TuningRecord;
      parameter: TuningParameter;
      from: number;
      to: number;
    }
  | { kind: "nothing"; record: TuningRecord };

/** Moves the tuned timeout back to `to` (dropping it at its base) and blocks the undone value. */
function undoTimeout(record: TuningRecord, now: number): UndoResult {
  const tuned = record.timeoutMs as NonNullable<TuningRecord["timeoutMs"]>;
  const origin = ruleOrigin(record.history, "timeoutMs", tuned.value);
  const keep = origin !== undefined && origin !== tuned.base;
  const to = keep ? origin : tuned.base;
  const { timeoutMs: _t, pending: _p, ...rest } = record;
  return {
    kind: "undone",
    parameter: "timeoutMs",
    from: tuned.value,
    to,
    record: {
      ...rest,
      ...(keep ? { timeoutMs: { ...tuned, value: origin } } : {}),
      block: { value: tuned.value, at: now },
      history: pushHistory(record.history, timeoutEntry(now, tuned.value, to, "undo")),
    },
  };
}

/**
 * Undoes the most recently changed parameter that applies. With `untuned` omitted, a tuned
 * `timeoutMs` counts as applying.
 */
export function undoTuning(record: TuningRecord, now: number, untuned?: number): UndoResult {
  const pick = pickUndoTarget(record, untuned);
  if (pick === undefined) return { kind: "nothing", record };
  if (!("band" in pick)) return undoTimeout(record, now);
  const { band, from, target: to } = pick;
  const undone = undoFloor(record, band, { from, to }, now);
  return { kind: "undone", parameter: pick.parameter, from, to, record: undone };
}

/** Drops every parameter's tuned value, pending change and block; keeps `off`. */
export function resetTuning(record: TuningRecord, untuned: number, now: number): TuningRecord {
  const { timeoutMs, pending: _p, block: _b, ...rest } = record;
  const entryFor = (t: { value: number }): HistoryEntry =>
    timeoutEntry(now, t.value, untuned, "reset");
  const timeoutReset =
    timeoutMs === undefined || !inRange(untuned)
      ? rest
      : { ...rest, history: pushHistory(rest.history, entryFor(timeoutMs)) };
  // Floor entries follow the timeout entry, in band order.
  return resetFloors(timeoutReset, now);
}

/** Sets or clears the off flag; nothing else changes. */
export function setTuningOff(record: TuningRecord, off: boolean): TuningRecord {
  return { ...record, off };
}

/** Raises the seen marker to `at`; never lowers it. */
export function markSeen(record: TuningRecord, at: number): TuningRecord {
  return { ...record, seenAt: Math.max(record.seenAt ?? at, at) };
}

/** History entries newer than the seen marker (all when absent), in history order. */
export function unseenEntries(record: TuningRecord): HistoryEntry[] {
  const seenAt = record.seenAt ?? -1;
  return (record.history ?? []).filter((h) => h.at > seenAt);
}
