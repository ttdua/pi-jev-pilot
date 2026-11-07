// Tuning rules: record shape, events and constants. Pure; no I/O.

import { after, counts, decisions, p90, shareAbove, type DecisionLine } from "./tuning-window.ts";

export type TuningCause = "rule" | "revert" | "undo" | "reset" | "superseded";

/** Same shape as the store's `TuningDocument`, declared here to keep policy/ self-contained. */
export type TuningRecord = {
  off?: boolean;
  timeoutMs?: { value: number; base: number };
  pending?: {
    from: number;
    to: number;
    at: number;
    before: { asked: number; timeouts: number };
  };
  block?: { value: number; at: number };
  history?: Array<{
    at: number;
    parameter: "timeoutMs";
    from: number;
    to: number;
    cause: TuningCause;
  }>;
};

export type HistoryEntry = NonNullable<TuningRecord["history"]>[number];

export type TuningEvent = {
  kind: "superseded" | "kept" | "reverted" | "applied";
  from: number;
  to: number;
};

export const TUNING = {
  window: 40,
  minAsked: 20,
  shareDenominator: 10,
  cooldown: 40,
  blockFor: 200,
  step: 200,
  p90Factor: 1.25,
  roundTo: 100,
  min: 300,
  max: 5000,
  history: 50,
} as const;

const ceilTo = (x: number, unit: number): number => Math.ceil(x / unit) * unit;
const clamp = (x: number): number => Math.min(TUNING.max, Math.max(TUNING.min, x));

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

export type Counts = { asked: number; timeouts: number };
export type StepResult = { record: TuningRecord; event?: TuningEvent };

/** Appends `entry`, keeping the latest `TUNING.history` entries. */
export function pushHistory(history: TuningRecord["history"], entry: HistoryEntry): HistoryEntry[] {
  return [...(history ?? []), entry].slice(-TUNING.history);
}

export function applyChange(
  record: TuningRecord,
  c: { from: number; to: number; base: number; before: Counts; now: number },
): TuningRecord {
  return {
    ...record,
    timeoutMs: { value: c.to, base: c.base },
    pending: { from: c.from, to: c.to, at: c.now, before: { ...c.before } },
    history: pushHistory(record.history, entry(c.now, c.from, c.to, "rule")),
  };
}

function entry(at: number, from: number, to: number, cause: TuningCause): HistoryEntry {
  return { at, parameter: "timeoutMs", from, to, cause };
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
  const result = counts(judged);
  const worse = result.asked >= TUNING.minAsked && shareAbove(result, pending.before);
  const { pending: _cleared, ...rest } = record;
  if (!worse) return { record: rest, event: { kind: "kept", from: pending.from, to: pending.to } };
  return { record: revertedRecord(rest, pending, now), event: revertedEvent(pending) };
}

function revertedEvent(p: { from: number; to: number }): TuningEvent {
  return { kind: "reverted", from: p.to, to: p.from };
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
    history: pushHistory(rest.history, entry(now, p.to, p.from, "revert")),
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
      history: pushHistory(record.history, entry(now, tuned.value, untuned, "superseded")),
    },
    event: { kind: "superseded", from: tuned.value, to: untuned },
  };
}
