// Shared timeout-change helpers for the tuning rules. Pure; imports record.ts and window.ts only.

import {
  pushHistory,
  TUNING,
  type HistoryEntry,
  type TuningCause,
  type TuningEvent,
  type TuningLine,
  type TuningRecord,
} from "./record.ts";
import type { Counts } from "./window.ts";

export type StepResult = { record: TuningRecord; event?: TuningEvent };

export type StepInput = {
  record: TuningRecord;
  untuned: number;
  lines: readonly TuningLine[];
  now: number;
};

export const ceilTo = (x: number, unit: number): number => Math.ceil(x / unit) * unit;
export const clamp = (x: number): number => Math.min(TUNING.max, Math.max(TUNING.min, x));

export function timeoutEntry(
  at: number,
  from: number,
  to: number,
  cause: TuningCause,
): HistoryEntry {
  return { at, parameter: "timeoutMs", from, to, cause };
}

export function applyChange(
  record: TuningRecord,
  c: { from: number; to: number; base: number; before: Counts; now: number },
): TuningRecord {
  return {
    ...record,
    timeoutMs: { value: c.to, base: c.base },
    pending: { from: c.from, to: c.to, at: c.now, before: { ...c.before } },
    history: pushHistory(record.history, timeoutEntry(c.now, c.from, c.to, "rule")),
  };
}
