// Tuning rules: record shape, events and constants. Pure; no I/O.

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
