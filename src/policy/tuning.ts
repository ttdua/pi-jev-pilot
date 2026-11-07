// Tuning rules: record shape, events and constants. Pure; no I/O.

import { after, counts, decisions, p90, type DecisionLine } from "./tuning-window.ts";

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
