import { describe, expect, test } from "bun:test";
import {
  stepTuning,
  undoTuning,
  type HistoryEntry,
  type TuningRecord,
} from "../../../src/policy/tuning/rules.ts";
import { activeBlock } from "../../../src/policy/tuning/timeout-change.ts";
import type { DecisionLine } from "../../../src/policy/tuning/window.ts";
import { line, lines } from "./lines.ts";

const rule = (at: number, from: number, to: number): HistoryEntry => ({
  at,
  parameter: "timeoutMs",
  from,
  to,
  cause: "rule",
});
const timeout = (at: number, opts: Partial<DecisionLine> = {}): DecisionLine =>
  line(at, { answered: false, miss: "timeout", ...opts });
const timeouts = (n: number, from: number): DecisionLine[] =>
  Array.from({ length: n }, (_, i) => timeout(from + i));
const answered = (n: number, from: number, ms?: number): DecisionLine[] =>
  lines(n, from, ms === undefined ? {} : { ms });
const asApplied = (from: number, to: number) =>
  ({ kind: "applied", parameter: "timeoutMs", from, to }) as const;

const tuned = (value: number, at = 1000, base = 1500): TuningRecord => ({
  timeoutMs: { value, base },
  history: [rule(at, base, value)],
});
const step = (record: TuningRecord, ls: readonly DecisionLine[], untuned = 1500, now = 90000) =>
  stepTuning({ record, untuned, lines: ls, now });

describe("burst rule", () => {
  test("Three timeouts in a row", () => {
    expect(step(tuned(1700), timeouts(3, 1001)).events).toEqual([asApplied(1700, 2200)]);
  });

  test("Three of the latest five", () => {
    const ls = [timeout(1001), line(1002), timeout(1003), line(1004), timeout(1005)];
    expect(step(tuned(1700), ls).events).toEqual([asApplied(1700, 2200)]);
  });

  test("Two of five do not fire", () => {
    const ls = [timeout(1001), line(1002), timeout(1003), line(1004), line(1005)];
    expect(step(tuned(1700), ls).events).toEqual([]);
  });

  test("Older timeouts do not count", () => {
    const ls = [...timeouts(3, 500), ...timeouts(2, 1001)];
    expect(step(tuned(1700), ls).events).toEqual([]);
  });

  test("Unasked decisions skipped", () => {
    const ls = [timeout(1001), line(1002, { answered: false }), timeout(1003)];
    const more = [line(1004, { answered: false }), timeout(1005)];
    expect(step(tuned(1700), [...ls, ...more]).events).toEqual([asApplied(1700, 2200)]);
  });

  test("Block ignored and Burst clears the block", () => {
    const record: TuningRecord = { ...tuned(1700), block: { value: 1900, at: 1000 } };
    const out = step(record, [...answered(19, 1001), ...timeouts(3, 1020)]);
    expect(out.events).toEqual([asApplied(1700, 2200)]);
    expect(out.record.block).toBeUndefined();
    expect(out.record.history?.at(-1)).toEqual(rule(90000, 1700, 2200));
  });

  test("Steps under sustained timeouts", () => {
    let record = tuned(1700);
    const values: number[] = [];
    for (let i = 1; i <= 5; i++) {
      const now = i * 1000 + 1000;
      const out = step(record, timeouts(3, now - 900), 1500, now);
      const event = out.events[0];
      if (event !== undefined) values.push(event.to);
      record = out.record;
      // Appending 3 timeouts per round: earlier rounds stay in the ledger too.
    }
    expect(values).toEqual([2200, 2800, 3500, 4400, 5000]);
  });

  test("Burst at the ceiling", () => {
    const record = tuned(5000);
    expect(step(record, timeouts(3, 1001))).toEqual({ record, events: [] });
  });

  test("Burst over a pending change", () => {
    const record: TuningRecord = {
      ...tuned(1700),
      pending: { from: 1500, to: 1700, at: 1000, before: { asked: 40, timeouts: 6 } },
    };
    const out = step(record, [...answered(7, 1001), ...timeouts(3, 1008)]);
    expect(out.events).toEqual([asApplied(1700, 2200)]);
    expect(out.record.pending).toMatchObject({ from: 1700, to: 2200 });
  });

  test("Burst before counts", () => {
    const ls = [
      ...lines(2, 1001, { answered: false }),
      ...answered(26, 1003),
      ...timeouts(12, 1029),
    ];
    const out = step(tuned(1700), ls);
    expect(out.events).toEqual([asApplied(1700, 2200)]);
    expect(out.record.pending?.before).toEqual({ asked: 38, timeouts: 12 });
  });

  test("The same lines stepped again give no events", () => {
    const ls = [...answered(7, 1001), ...timeouts(3, 1008)];
    const first = step(tuned(1700), ls);
    expect(step(first.record, ls).events).toEqual([]);
  });

  test("Undo right after a burst over a pending change", () => {
    const record: TuningRecord = {
      timeoutMs: { value: 1700, base: 1500 },
      pending: { from: 1500, to: 1700, at: 1000, before: { asked: 40, timeouts: 6 } },
      history: [rule(1000, 1500, 1700)],
    };
    const burst = step(record, [...answered(7, 1001), ...timeouts(3, 1008)]);
    const undone = undoTuning(burst.record, 91000);
    expect(undone).toMatchObject({ kind: "undone", from: 2200, to: 1700 });
    expect(undone.record.block).toEqual({ value: 2200, at: 91000 });
  });

  test("Worker lines count", () => {
    const ls = Array.from({ length: 3 }, (_, i) =>
      timeout(1001 + i, { kind: "worker", session: "w" }),
    );
    expect(step(tuned(1700), ls).events).toEqual([asApplied(1700, 2200)]);
  });

  test("Inputs unchanged for a burst step", () => {
    const record = tuned(1700);
    const ls = timeouts(3, 1001);
    const [recordCopy, lsCopy] = [structuredClone(record), structuredClone(ls)];
    step(record, ls);
    expect(record).toEqual(recordCopy);
    expect(ls).toEqual(lsCopy);
  });
});

describe("lowering", () => {
  const clean = (n: number, ms: number, from = 1001) => answered(n, from, ms);

  test("Lowered after a clean stretch", () => {
    const out = step(tuned(3000), clean(200, 1270));
    expect(out.events).toEqual([asApplied(3000, 2400)]);
    expect(out.record.pending).toMatchObject({ from: 3000, to: 2400, before: { asked: 40 } });
  });

  test("p90 limits the step", () => {
    expect(step(tuned(3000), clean(200, 1900)).events).toEqual([asApplied(3000, 2900)]);
  });

  test("Not below the base", () => {
    expect(step(tuned(1700), clean(200, 500)).events).toEqual([asApplied(1700, 1500)]);
  });

  test("A timeout stops lowering", () => {
    const ls = [...clean(50, 1270), timeout(1051), ...clean(149, 1270, 1052)];
    expect(step(tuned(3000), ls).events).toEqual([]);
  });

  test("Too soon", () => {
    expect(step(tuned(3000), clean(199, 1270)).events).toEqual([]);
  });

  test("Too few asked", () => {
    const ls = [...lines(101, 1001, { answered: false }), ...clean(99, 1270, 1102)];
    expect(step(tuned(3000), ls).events).toEqual([]);
  });

  test("Untuned value never lowered", () => {
    expect(step({ history: [rule(1000, 1, 2)] }, clean(200, 1270)).events).toEqual([]);
  });

  test("Inputs unchanged for a lowering step", () => {
    const record = tuned(3000);
    const ls = clean(200, 1270);
    const [recordCopy, lsCopy] = [structuredClone(record), structuredClone(ls)];
    expect(step(record, ls).events).toHaveLength(1);
    expect(record).toEqual(recordCopy);
    expect(ls).toEqual(lsCopy);
  });
});

describe("blocks and direction", () => {
  const clean = (n: number, ms: number, from = 1001) => answered(n, from, ms);
  const reverted = (value: number, base = 1500): TuningRecord => ({
    timeoutMs: { value, base },
    block: { value: 2400, at: 1000 },
    history: [
      rule(500, base, value),
      { at: 1000, parameter: "timeoutMs", from: 2400, to: value, cause: "revert" },
    ],
  });

  test("Blocked lowering raised", () => {
    expect(step(reverted(3000), clean(250, 1270)).events).toEqual([asApplied(3000, 2500)]);
  });

  test("Blocked lowering dropped", () => {
    expect(step(reverted(2500), clean(250, 500)).events).toEqual([]);
  });

  test("Raise block does not hold back a lowering", () => {
    const record: TuningRecord = { ...tuned(3000), block: { value: 3500, at: 1050 } };
    expect(step(record, clean(200, 1270)).events).toEqual([asApplied(3000, 2400)]);
  });

  test("Lowering block expired", () => {
    const record: TuningRecord = { ...tuned(3000), block: { value: 2400, at: 1000 } };
    expect(step(record, clean(400, 1270)).events).toEqual([asApplied(3000, 2400)]);
  });

  test("Block equal to the reference holds back nothing", () => {
    const record: TuningRecord = { block: { value: 1700, at: 1000 }, history: [rule(1000, 1, 2)] };
    const ls = [...timeouts(10, 1001), ...answered(30, 1011)];
    const out = step(record, ls, 1700);
    expect(out.events).toEqual([asApplied(1700, 1900)]);
  });

  test("activeBlock for a lowering block lasts 400 decisions", () => {
    const record: TuningRecord = { ...tuned(3000), block: { value: 2400, at: 1000 } };
    expect(activeBlock(record, 1500, lines(399, 1001))).toEqual({
      value: 2400,
      direction: "lower",
      remaining: 1,
    });
    expect(activeBlock(record, 1500, lines(400, 1001))).toBeUndefined();
  });

  test("activeBlock for a raise block lasts 200 decisions", () => {
    const record: TuningRecord = { block: { value: 1700, at: 1000 } };
    expect(activeBlock(record, 1500, lines(199, 1001))).toEqual({
      value: 1700,
      direction: "raise",
      remaining: 1,
    });
    expect(activeBlock(record, 1500, lines(200, 1001))).toBeUndefined();
  });
});
