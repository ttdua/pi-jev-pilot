// Tuning record shape, events and constants. Pure; imports only shared/ and window.ts.

import type { FloorBand } from "../../shared/turn-floors.ts";
import type { DecisionLine } from "./window.ts";

export type TuningCause = "rule" | "revert" | "undo" | "reset" | "superseded";

export type TuningParameter = "timeoutMs" | `turnFloor.${FloorBand}`;

/** A ledger line read structurally; extra fields are ignored. */
export type TuningLine = DecisionLine & {
  status?: string;
  turnsP?: Readonly<Record<string, number>>;
  turnsUsed?: number;
  turnPhase?: string;
  turnFloor?: number;
};

/** Same shape as the store's `FloorState`, declared here to keep policy/ self-contained. */
export type FloorState = {
  changedAt: number;
  tuned?: { value: number; base: number };
  pending?: {
    from: number;
    to: number;
    at: number;
    before: { runs: number; exhausted: number };
  };
  block?: { value: number; at: number };
};

/** Same shape as the store's `TuningDocument`, declared here to keep policy/ self-contained. */
export type TuningRecord = {
  off?: boolean;
  seenAt?: number;
  timeoutMs?: { value: number; base: number };
  pending?: {
    from: number;
    to: number;
    at: number;
    before: { asked: number; timeouts: number };
  };
  block?: { value: number; at: number };
  turnFloors?: Partial<Record<FloorBand, FloorState>>;
  history?: Array<{
    at: number;
    parameter: TuningParameter;
    from: number;
    to: number;
    cause: TuningCause;
  }>;
};

export type HistoryEntry = NonNullable<TuningRecord["history"]>[number];

export type TuningEvent = {
  kind: "superseded" | "kept" | "reverted" | "applied";
  /** Absent on `timeoutMs` events until the step sets it for every event. */
  parameter?: TuningParameter;
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

/** Appends `entry`, keeping the latest `TUNING.history` entries. */
export function pushHistory(history: TuningRecord["history"], entry: HistoryEntry): HistoryEntry[] {
  return [...(history ?? []), entry].slice(-TUNING.history);
}

/** The latest history entry time for `parameter`; 0 when none. */
export function latestEntryAt(
  history: TuningRecord["history"],
  parameter: TuningParameter,
): number {
  return Math.max(0, ...(history ?? []).filter((h) => h.parameter === parameter).map((h) => h.at));
}
