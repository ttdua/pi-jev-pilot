// Burst and lowering rules for `timeoutMs`. Pure; never imports rules.ts.

import {
  activeBlock,
  applyChange,
  ceilTo,
  clamp,
  type StepInput,
  type StepResult,
} from "./timeout-change.ts";
import { latestEntryAt, TUNING, type TuningRecord } from "./record.ts";
import {
  after,
  counts,
  decisions,
  latestAsked,
  p90,
  rescued,
  shareAbove,
  type DecisionLine,
} from "./window.ts";

const latest = (ds: readonly DecisionLine[], n: number): DecisionLine[] => ds.slice(-n);

function applied(from: number, to: number): StepResult["event"] {
  return { kind: "applied", parameter: "timeoutMs", from, to } as const;
}

/** Raises by 25% when 3 of the latest 5 asked decisions since the last change timed out. */
export function burstRule(input: StepInput, record: TuningRecord): StepResult {
  const { untuned, lines, now } = input;
  const ds = decisions(lines);
  const since = after(ds, latestEntryAt(record.history, "timeoutMs"));
  const recent = latestAsked(since, TUNING.burstWindow);
  if (recent.filter((d) => d.miss === "timeout").length < TUNING.burstTimeouts) return { record };
  const from = record.timeoutMs?.value ?? untuned;
  const to = clamp(ceilTo(from * TUNING.burstFactor, TUNING.roundTo));
  if (to <= from) return { record };
  const before = counts(latest(ds, TUNING.window));
  const change = { from, to, base: untuned, before, now, clearBlock: true };
  return { record: applyChange(record, change), event: applied(from, to) };
}

/** The lowered value, or undefined when it would not be below `current`. */
export function lowerValue(
  current: number,
  base: number,
  observed: number,
  block: { value: number } | undefined,
): number | undefined {
  const stepped = ceilTo(current * TUNING.lowerStep, TUNING.roundTo);
  const headroom = ceilTo(observed * TUNING.lowerFactor, TUNING.roundTo);
  let value = Math.max(base, headroom, stepped);
  if (block !== undefined && value <= block.value) value = block.value + TUNING.roundTo;
  return value < current ? value : undefined;
}

/** The latest 200 decisions once 200 have followed the latest `timeoutMs` entry; else none. */
function cleanStretch(record: TuningRecord, ds: readonly DecisionLine[]): DecisionLine[] {
  const since = after(ds, latestEntryAt(record.history, "timeoutMs"));
  return since.length < TUNING.lowerAfter ? [] : latest(since, TUNING.lowerAfter);
}

/** Lowers a tuned value after a clean stretch of decisions. */
export function lowerRule(input: StepInput, record: TuningRecord): StepResult {
  const { untuned, lines, now } = input;
  const tuned = record.timeoutMs;
  if (tuned === undefined || tuned.base !== untuned || record.pending !== undefined) {
    return { record };
  }
  const ds = decisions(lines);
  const stretch = cleanStretch(record, ds);
  const { asked, timeouts } = counts(stretch);
  if (stretch.length === 0 || asked < TUNING.lowerMinAsked || timeouts > 0) return { record };
  const observed = p90(stretch);
  if (observed === undefined) return { record };
  const block = activeBlock(record, untuned, ds);
  const to = lowerValue(
    tuned.value,
    tuned.base,
    observed,
    block?.direction === "lower" ? block : undefined,
  );
  if (to === undefined) return { record };
  const change = {
    from: tuned.value,
    to,
    base: untuned,
    before: counts(latest(ds, TUNING.window)),
    now,
  };
  return { record: applyChange(record, change), event: applied(tuned.value, to) };
}

type Pending = NonNullable<TuningRecord["pending"]>;

/** A lowering reverts on any timeout among enough asked; a raise is kept when it rescued an answer. */
export function judgeTimeout(
  pending: Pending,
  judged: readonly DecisionLine[],
): "kept" | "reverted" {
  const result = counts(judged);
  const enough = result.asked >= TUNING.minAsked;
  if (pending.to < pending.from) return enough && result.timeouts > 0 ? "reverted" : "kept";
  if (rescued(judged, pending.from)) return "kept";
  return enough && shareAbove(result, pending.before) ? "reverted" : "kept";
}

/** Drops the tuned value when it equals its base. */
export function keptRecord(record: TuningRecord): TuningRecord {
  const { timeoutMs, ...rest } = record;
  if (timeoutMs === undefined || timeoutMs.value !== timeoutMs.base) return record;
  return rest;
}
