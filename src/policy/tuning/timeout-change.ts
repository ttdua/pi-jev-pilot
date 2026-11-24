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
import { after, decisions, type Counts, type DecisionLine } from "./window.ts";

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
  c: { from: number; to: number; base: number; before: Counts; now: number; clearBlock?: boolean },
): TuningRecord {
  const { block: _block, ...unblocked } = record;
  return {
    ...(c.clearBlock === true ? unblocked : record),
    timeoutMs: { value: c.to, base: c.base },
    pending: { from: c.from, to: c.to, at: c.now, before: { ...c.before } },
    history: pushHistory(record.history, timeoutEntry(c.now, c.from, c.to, "rule")),
  };
}

export type BlockDirection = "raise" | "lower";

/** The value a block is compared with: the tuned `timeoutMs`, else the untuned one. */
export function blockReference(record: TuningRecord, untuned: number): number {
  return record.timeoutMs?.value ?? untuned;
}

/** `raise` above the reference, `lower` below it, nothing when equal. */
export function blockDirection(
  block: { value: number },
  reference: number,
): BlockDirection | undefined {
  if (block.value === reference) return undefined;
  return block.value > reference ? "raise" : "lower";
}

const LIFETIME = { raise: TUNING.blockFor, lower: TUNING.lowerBlockFor } as const;

/** The block with its direction and decisions left, or undefined once spent or directionless. */
export function activeBlock(
  record: TuningRecord,
  untuned: number,
  ds: readonly DecisionLine[],
): { value: number; direction: BlockDirection; remaining: number } | undefined {
  const { block } = record;
  if (block === undefined) return undefined;
  const direction = blockDirection(block, blockReference(record, untuned));
  if (direction === undefined) return undefined;
  const remaining = LIFETIME[direction] - after(decisions(ds), block.at).length;
  return remaining > 0 ? { value: block.value, direction, remaining } : undefined;
}
