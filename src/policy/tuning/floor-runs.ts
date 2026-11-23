// Counted worker runs per turn band. Pure: inputs are never mutated.

import { turnBand } from "../worker/index.ts";
import type { FloorBand } from "../../shared/turn-floors.ts";
import { stableKey } from "./order.ts";
import type { TuningLine } from "./record.ts";

export type CountedRun = {
  at: number;
  band: FloorBand;
  used: number;
  phase?: "within" | "warned" | "exhausted";
  floor?: number;
  key: string;
};

const PHASES = ["within", "warned", "exhausted"] as const;

function toRun(line: TuningLine, band: FloorBand): CountedRun {
  const { turnPhase, turnFloor } = line;
  const phase = PHASES.find((p) => p === turnPhase);
  return {
    at: line.at,
    band,
    used: line.turnsUsed as number,
    ...(phase === undefined ? {} : { phase }),
    ...(typeof turnFloor === "number" ? { floor: turnFloor } : {}),
    key: stableKey(line),
  };
}

function counted(line: TuningLine): boolean {
  return (
    line.kind === "worker" &&
    line.turnsP !== undefined &&
    Number.isInteger(line.turnsUsed) &&
    line.status !== "aborted"
  );
}

const byAtThenKey = (a: CountedRun, b: CountedRun): number =>
  a.at !== b.at ? (a.at < b.at ? -1 : 1) : a.key < b.key ? -1 : a.key > b.key ? 1 : 0;

/** Counted runs of `band`, ordered by `at`, then `key`. */
export function countedRuns(lines: readonly TuningLine[], band: FloorBand): CountedRun[] {
  return lines
    .filter((l) => counted(l) && turnBand(l.turnsP) === band)
    .map((l) => toRun(l, band))
    .sort(byAtThenKey);
}

/** Value at nearest rank `ceil(pct × n / 100)` of an ascending list. */
export function nearestRank(sorted: readonly number[], pct: number): number | undefined {
  if (sorted.length === 0) return undefined;
  return sorted[Math.ceil((pct * sorted.length) / 100) - 1];
}
