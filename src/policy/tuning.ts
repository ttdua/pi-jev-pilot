// Tuning rules: record shape, events and constants. Pure; no I/O.

import {
  after,
  counts,
  decisions,
  p90,
  shareAbove,
  type Counts,
  type DecisionLine,
} from "./tuning-window.ts";

export type { Counts };

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

export type StepResult = { record: TuningRecord; event?: TuningEvent };

function entry(at: number, from: number, to: number, cause: TuningCause): HistoryEntry {
  return { at, parameter: "timeoutMs", from, to, cause };
}

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

export type StepInput = {
  record: TuningRecord;
  untuned: number;
  lines: readonly DecisionLine[];
  now: number;
};

const inRange = (x: number): boolean => x >= TUNING.min && x <= TUNING.max;

/** Drops a `pending` that has no tuned value to belong to. */
function dropOrphanPending(record: TuningRecord): TuningRecord {
  if (record.pending === undefined || record.timeoutMs !== undefined) return record;
  const { pending: _orphan, ...rest } = record;
  return rest;
}

/** The latest 40 decisions once 40 have followed the latest history entry; else none. */
function cooledWindow(record: TuningRecord, ds: readonly DecisionLine[]): DecisionLine[] {
  const lastAt = Math.max(0, ...(record.history ?? []).map((h) => h.at));
  const since = after(ds, lastAt);
  return since.length < TUNING.cooldown ? [] : since.slice(-TUNING.window);
}

/** Applies the rule when the window fires; the block counts only while active. */
function fireRule(input: StepInput, record: TuningRecord): StepResult {
  const { untuned, lines, now } = input;
  const ds = decisions(lines);
  const window = cooledWindow(record, ds);
  if (!fires(window)) return { record };
  const from = record.timeoutMs?.value ?? untuned;
  const block = blockActive(record.block, lines) ? record.block : undefined;
  const to = nextValue(from, window, block);
  if (to === undefined) return { record };
  const change = { from, to, base: untuned, before: counts(window), now };
  return { record: applyChange(record, change), event: { kind: "applied", from, to } };
}

const present = (events: Array<TuningEvent | undefined>): TuningEvent[] =>
  events.filter((e) => e !== undefined);

/** One tuning step: supersede, judge a pending change, then maybe raise the timeout. */
export function stepTuning(input: StepInput): { record: TuningRecord; events: TuningEvent[] } {
  const { record, untuned, lines, now } = input;
  if (record.off === true || !inRange(untuned)) return { record, events: [] };
  const superseded = supersede(dropOrphanPending(record), untuned, now);
  const judged = evaluatePending(superseded.record, lines, now);
  const head = [superseded.event, judged.event];
  if (judged.event?.kind === "reverted") return { record: judged.record, events: present(head) };
  const fired = fireRule(input, judged.record);
  return { record: fired.record, events: present([...head, fired.event]) };
}

export type UndoResult =
  | { kind: "undone"; record: TuningRecord; from: number; to: number }
  | { kind: "nothing"; record: TuningRecord };

/** The `from` of the latest `rule` entry that raised to `value`, if any. */
function ruleOrigin(history: TuningRecord["history"], value: number): number | undefined {
  return [...(history ?? [])].reverse().find((h) => h.cause === "rule" && h.to === value)?.from;
}

/** Moves the tuned value back one rule step (or drops it) and blocks the undone value. */
export function undoTuning(record: TuningRecord, now: number): UndoResult {
  const tuned = record.timeoutMs;
  if (tuned === undefined) return { kind: "nothing", record };
  const target = ruleOrigin(record.history, tuned.value);
  const { timeoutMs: _t, pending: _p, ...rest } = record;
  const keep = target !== undefined && target !== tuned.base;
  const to = keep ? target : tuned.base;
  return {
    kind: "undone",
    from: tuned.value,
    to,
    record: {
      ...rest,
      ...(keep ? { timeoutMs: { ...tuned, value: target } } : {}),
      block: { value: tuned.value, at: now },
      history: pushHistory(record.history, entry(now, tuned.value, to, "undo")),
    },
  };
}

/** Drops the tuned value, pending change and block; keeps `off`. */
export function resetTuning(record: TuningRecord, untuned: number, now: number): TuningRecord {
  const { timeoutMs, pending: _p, block: _b, ...rest } = record;
  if (timeoutMs === undefined || !inRange(untuned)) return rest;
  return {
    ...rest,
    history: pushHistory(record.history, entry(now, timeoutMs.value, untuned, "reset")),
  };
}

/** Sets or clears the off flag; nothing else changes. */
export function setTuningOff(record: TuningRecord, off: boolean): TuningRecord {
  return { ...record, off };
}
