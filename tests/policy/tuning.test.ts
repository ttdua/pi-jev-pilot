import { describe, expect, test } from "bun:test";
import {
  TUNING,
  blockActive,
  fires,
  nextValue,
  type HistoryEntry,
  type TuningRecord,
} from "../../src/policy/tuning.ts";
import type { DecisionLine } from "../../src/policy/tuning-window.ts";
import { line, lines } from "./tuning-lines.ts";

describe("tuning contract", () => {
  test("constants are the contract values", () => {
    expect(TUNING).toEqual({
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
    });
  });

  test("HistoryEntry is one history element", () => {
    const entry: HistoryEntry = {
      at: 1,
      parameter: "timeoutMs",
      from: 1500,
      to: 1700,
      cause: "rule",
    };
    const record: TuningRecord = { history: [entry] };
    expect(record.history?.[0]).toBe(entry);
  });
});

// A window of `n` lines: the first `t` are timeouts, then `e` error misses, then `s` schema
// misses, then answered lines, finally `u` unasked lines (neither answered nor missed).
function windowOf(spec: {
  timeouts?: number;
  errors?: number;
  schema?: number;
  answered?: number;
  unasked?: number;
  ms?: number;
}): DecisionLine[] {
  const out: DecisionLine[] = [];
  const push = (n: number, opts: Parameters<typeof line>[1]) => {
    for (let i = 0; i < n; i++) out.push(line(out.length + 1, opts));
  };
  push(spec.timeouts ?? 0, { answered: false, miss: "timeout" });
  push(spec.errors ?? 0, { answered: false, miss: "error" });
  push(spec.schema ?? 0, { answered: false, miss: "schema" });
  push(spec.answered ?? 0, { ms: spec.ms });
  push(spec.unasked ?? 0, { answered: false });
  return out;
}

describe("fires", () => {
  test("Fires on timeouts", () => {
    expect(fires(windowOf({ timeouts: 5, answered: 35 }))).toBe(true);
  });
  test("Exactly 10% does not fire", () => {
    expect(fires(windowOf({ timeouts: 4, answered: 36 }))).toBe(false);
  });
  test("Other misses do not count", () => {
    expect(fires(windowOf({ errors: 10, schema: 3, answered: 27 }))).toBe(false);
  });
  test("Too few asked", () => {
    expect(fires(windowOf({ timeouts: 10, answered: 9, unasked: 21 }))).toBe(false);
  });
  test("Unasked decisions are not counted", () => {
    expect(fires(windowOf({ timeouts: 3, answered: 17, unasked: 20 }))).toBe(true);
  });
  test("a window that is not 40 long does not fire", () => {
    expect(fires(windowOf({ timeouts: 10, answered: 20 }))).toBe(false);
  });
});

describe("nextValue", () => {
  const win = (ms: number) => windowOf({ timeouts: 5, answered: 35, ms });
  test("Step of 200", () => {
    expect(nextValue(1500, win(1000), undefined)).toBe(1700);
  });
  test("p90 wins", () => {
    expect(nextValue(1500, win(1450), undefined)).toBe(1900);
  });
  test("without ms only the step applies", () => {
    expect(nextValue(1500, windowOf({ timeouts: 5, answered: 35 }), undefined)).toBe(1700);
  });
  test("Clamped to the ceiling", () => {
    expect(nextValue(4900, win(1000), undefined)).toBe(5000);
  });
  test("Already at the ceiling", () => {
    expect(nextValue(5000, win(1000), undefined)).toBeUndefined();
  });
  test("Blocked raise lowered", () => {
    expect(nextValue(1500, win(1000), { value: 1700 })).toBe(1600);
  });
  test("Blocked raise dropped", () => {
    expect(nextValue(1600, win(1450), { value: 1700 })).toBeUndefined();
  });
  test("Block at the ceiling", () => {
    expect(nextValue(4800, win(4160), { value: 5000 })).toBe(4900);
  });
  test("Block expired: no block passed", () => {
    expect(nextValue(1500, win(1000), undefined)).toBe(1700);
  });
});

describe("blockActive", () => {
  const block = { value: 1700, at: 1000 };
  test("Block expired at 200 decisions", () => {
    expect(blockActive(block, lines(200, 1001))).toBe(false);
  });
  test("active at 199 decisions", () => {
    expect(blockActive(block, lines(199, 1001))).toBe(true);
  });
  test("decisions at or before the block do not count", () => {
    expect(blockActive(block, [...lines(300, 700), ...lines(50, 1001)])).toBe(true);
  });
  test("no block is never active", () => {
    expect(blockActive(undefined, [])).toBe(false);
  });
});
