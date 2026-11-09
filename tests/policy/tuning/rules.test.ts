import { describe, expect, test } from "bun:test";
import {
  TUNING,
  blockActive,
  applyChange,
  evaluatePending,
  fires,
  pushHistory,
  supersede,
  nextValue,
  stepTuning,
  undoTuning,
  resetTuning,
  setTuningOff,
  markSeen,
  unseenEntries,
  type HistoryEntry,
  type TuningRecord,
} from "../../../src/policy/tuning/rules.ts";
import type { DecisionLine } from "../../../src/policy/tuning/window.ts";
import { line, lines } from "./lines.ts";

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

const entryAt = (at: number): HistoryEntry => ({
  at,
  parameter: "timeoutMs",
  from: 1,
  to: 2,
  cause: "rule",
});

const pendingRecord = (
  from: number,
  to: number,
  before: { asked: number; timeouts: number },
  base = 1500,
): TuningRecord => ({
  timeoutMs: { value: to, base },
  pending: { from, to, at: 1000, before },
  history: [{ at: 1000, parameter: "timeoutMs", from, to, cause: "rule" }],
});

/** 40 lines after 1000: `timeouts` timed out, `asked - timeouts` answered, the rest silent. */
const judgedLines = (asked: number, timeouts: number): DecisionLine[] =>
  Array.from({ length: 40 }, (_, i) => {
    if (i < timeouts) return line(1001 + i, { answered: false, miss: "timeout" });
    if (i < asked) return line(1001 + i);
    return line(1001 + i, { answered: false });
  });

describe("applyChange", () => {
  const before = { asked: 40, timeouts: 8 };

  test("first change recorded", () => {
    const r = applyChange({}, { from: 1500, to: 1700, base: 1500, before, now: 1000 });
    expect(r.timeoutMs).toEqual({ value: 1700, base: 1500 });
    expect(r.pending).toEqual({ from: 1500, to: 1700, at: 1000, before });
    expect(r.history?.at(-1)).toEqual({
      at: 1000,
      parameter: "timeoutMs",
      from: 1500,
      to: 1700,
      cause: "rule",
    });
  });

  test("second step", () => {
    const start: TuningRecord = { timeoutMs: { value: 1700, base: 1500 } };
    const r = applyChange(start, { from: 1700, to: 1900, base: 1500, before, now: 2000 });
    expect(r.timeoutMs).toEqual({ value: 1900, base: 1500 });
    expect(r.pending?.from).toBe(1700);
  });

  test("does not mutate its input", () => {
    const start: TuningRecord = { history: [entryAt(1)] };
    applyChange(start, { from: 1, to: 2, base: 1, before, now: 5 });
    expect(start).toEqual({ history: [entryAt(1)] });
  });
});

describe("pushHistory", () => {
  test("oldest dropped", () => {
    const full = Array.from({ length: 50 }, (_, i) => entryAt(i));
    const next = pushHistory(full, entryAt(99));
    expect(next).toHaveLength(50);
    expect(next[0]?.at).toBe(1);
    expect(next.at(-1)?.at).toBe(99);
    expect(full).toHaveLength(50);
  });
});

describe("evaluatePending", () => {
  test("worse is judged a revert", () => {
    const rec = pendingRecord(1500, 1700, { asked: 40, timeouts: 6 });
    const out = evaluatePending(rec, judgedLines(40, 8), 9000);
    expect(out.event).toEqual({ kind: "reverted", from: 1700, to: 1500 });
  });

  test("revert to the untuned value", () => {
    const rec = pendingRecord(1500, 1700, { asked: 40, timeouts: 6 });
    const out = evaluatePending(rec, judgedLines(40, 8), 9000);
    expect(out.record.timeoutMs).toBeUndefined();
    expect(out.record.pending).toBeUndefined();
    expect(out.record.block).toEqual({ value: 1700, at: 9000 });
    expect(out.record.history?.at(-1)).toEqual({
      at: 9000,
      parameter: "timeoutMs",
      from: 1700,
      to: 1500,
      cause: "revert",
    });
  });

  test("revert to an earlier tuned value", () => {
    const rec = pendingRecord(1700, 1900, { asked: 40, timeouts: 6 });
    const out = evaluatePending(rec, judgedLines(40, 8), 9000);
    expect(out.record.timeoutMs).toEqual({ value: 1700, base: 1500 });
  });

  test("equal, kept", () => {
    const rec = pendingRecord(1500, 1700, { asked: 40, timeouts: 8 });
    const out = evaluatePending(rec, judgedLines(40, 8), 9000);
    expect(out.event).toEqual({ kind: "kept", from: 1500, to: 1700 });
    expect(out.record.pending).toBeUndefined();
    expect(out.record.timeoutMs).toEqual({ value: 1700, base: 1500 });
    expect(out.record.history).toEqual(rec.history);
  });

  test("too few asked, kept", () => {
    const rec = pendingRecord(1500, 1700, { asked: 40, timeouts: 6 });
    const out = evaluatePending(rec, judgedLines(10, 10), 9000);
    expect(out.event?.kind).toBe("kept");
  });

  test("not yet judged", () => {
    const rec = pendingRecord(1500, 1700, { asked: 40, timeouts: 6 });
    const out = evaluatePending(rec, judgedLines(40, 8).slice(0, 39), 9000);
    expect(out.event).toBeUndefined();
    expect(out.record).toEqual(rec);
  });

  test("pending survives an empty ledger", () => {
    const rec = pendingRecord(1500, 1700, { asked: 40, timeouts: 6 });
    const empty = evaluatePending(rec, [], 9000);
    expect(empty.event).toBeUndefined();
    expect(empty.record.pending).toEqual(rec.pending);
    const later = evaluatePending(rec, judgedLines(40, 8), 9000);
    expect(later.event?.kind).toBe("reverted");
  });

  test("judges only the first 40 after the change", () => {
    const rec = pendingRecord(1500, 1700, { asked: 40, timeouts: 6 });
    const extra = lines(20, 2000, { answered: false, miss: "timeout" });
    const out = evaluatePending(rec, [...judgedLines(40, 6), ...extra], 9000);
    expect(out.event?.kind).toBe("kept");
  });
});

describe("supersede", () => {
  const rec: TuningRecord = {
    timeoutMs: { value: 1700, base: 1500 },
    pending: { from: 1500, to: 1700, at: 1, before: { asked: 1, timeouts: 0 } },
    block: { value: 1900, at: 2 },
  };

  test("operator edits config", () => {
    const out = supersede(rec, 2000, 7000);
    expect(out.record.timeoutMs).toBeUndefined();
    expect(out.record.pending).toBeUndefined();
    expect(out.record.block).toBeUndefined();
    expect(out.record.history?.at(-1)).toEqual({
      at: 7000,
      parameter: "timeoutMs",
      from: 1700,
      to: 2000,
      cause: "superseded",
    });
    expect(out.event).toEqual({ kind: "superseded", from: 1700, to: 2000 });
  });

  test("matching base untouched", () => {
    const out = supersede(rec, 1500, 7000);
    expect(out.event).toBeUndefined();
    expect(out.record).toEqual(rec);
  });

  test("no tuned value, no event", () => {
    expect(supersede({}, 2000, 7000).event).toBeUndefined();
  });
});

describe("non-mutation", () => {
  test("evaluatePending leaves its inputs alone", () => {
    const rec = pendingRecord(1500, 1700, { asked: 40, timeouts: 6 });
    const ds = judgedLines(40, 8);
    const [recCopy, dsCopy] = [structuredClone(rec), structuredClone(ds)];
    evaluatePending(rec, ds, 9000);
    expect(rec).toEqual(recCopy);
    expect(ds).toEqual(dsCopy);
  });

  test("supersede leaves its input alone", () => {
    const rec = pendingRecord(1500, 1700, { asked: 40, timeouts: 6 });
    const copy = structuredClone(rec);
    supersede(rec, 2000, 7000);
    expect(rec).toEqual(copy);
  });
});

describe("stepTuning", () => {
  const timeout = (at: number): DecisionLine => line(at, { answered: false, miss: "timeout" });
  /** 40 lines after `from`: `timeouts` timed out, the rest answered. */
  const mixed = (from: number, timeouts: number): DecisionLine[] =>
    Array.from({ length: 40 }, (_, i) => (i < timeouts ? timeout(from + i) : line(from + i)));
  const step = (record: TuningRecord, ls: readonly DecisionLine[], untuned = 1500, now = 5000) =>
    stepTuning({ record, untuned, lines: ls, now });
  const history1000 = [entryAt(1000)];

  test("nothing to do", () => {
    expect(step({}, [])).toEqual({ record: {}, events: [] });
  });

  test("inputs unchanged", () => {
    const rec = pendingRecord(1500, 1700, { asked: 40, timeouts: 8 });
    const ls = mixed(1001, 6);
    const [recCopy, lsCopy] = [structuredClone(rec), structuredClone(ls)];
    step(rec, ls);
    expect(rec).toEqual(recCopy);
    expect(ls).toEqual(lsCopy);
  });

  test("fires on a first full window", () => {
    const out = step({}, mixed(1001, 8));
    expect(out.events).toEqual([{ kind: "applied", from: 1500, to: 1700 }]);
    expect(out.record.timeoutMs).toEqual({ value: 1700, base: 1500 });
    expect(out.record.pending?.before).toEqual({ asked: 40, timeouts: 8 });
  });

  test("inside the cooldown", () => {
    const rec = { history: history1000 };
    expect(step(rec, mixed(1001, 8).slice(0, 39)).events).toEqual([]);
  });

  test("cooldown passed", () => {
    const rec = { history: history1000 };
    expect(step(rec, mixed(1001, 8)).events).toEqual([{ kind: "applied", from: 1500, to: 1700 }]);
  });

  test("decisions before the change do not count", () => {
    const rec = { history: history1000 };
    const old = Array.from({ length: 100 }, (_, i) => timeout(500 + i));
    expect(step(rec, [...old, ...mixed(1001, 8).slice(0, 39)]).events).toEqual([]);
  });

  test("kept, then the rule fires", () => {
    const rec = pendingRecord(1500, 1700, { asked: 40, timeouts: 8 });
    const out = step(rec, mixed(1001, 6));
    expect(out.events).toEqual([
      { kind: "kept", from: 1500, to: 1700 },
      { kind: "applied", from: 1700, to: 1900 },
    ]);
  });

  test("no fire right after a revert", () => {
    const rec = pendingRecord(1500, 1700, { asked: 40, timeouts: 2 });
    const out = step(rec, mixed(1001, 8));
    expect(out.events).toEqual([{ kind: "reverted", from: 1700, to: 1500 }]);
    expect(out.record.timeoutMs).toBeUndefined();
  });

  test("no change right after superseding", () => {
    const rec: TuningRecord = { timeoutMs: { value: 1700, base: 1500 }, history: history1000 };
    const out = step(rec, mixed(1001, 8), 2000);
    expect(out.events).toEqual([{ kind: "superseded", from: 1700, to: 2000 }]);
    expect(out.record.timeoutMs).toBeUndefined();
  });

  test("off stops everything", () => {
    const rec: TuningRecord = { off: true, timeoutMs: { value: 1700, base: 1500 } };
    expect(step(rec, mixed(1001, 8), 2000)).toEqual({ record: rec, events: [] });
  });

  test("correction lines ignored", () => {
    const corrections = Array.from({ length: 40 }, (_, i) =>
      line(1001 + i, { kind: "correction", answered: false, miss: "timeout" }),
    );
    const rec = { history: history1000 };
    const out = step(rec, [...corrections, ...mixed(1100, 8).slice(0, 39)]);
    expect(out.events).toEqual([]);
  });

  test("line order does not matter", () => {
    const shared = Array.from({ length: 40 }, (_, i) =>
      i % 4 === 0 ? timeout(1001 + Math.floor(i / 8)) : line(1001 + Math.floor(i / 8), { ms: i }),
    );
    const a = step({}, shared);
    const b = step({}, [...shared].reverse());
    expect(a.events.length).toBe(1);
    expect(b).toEqual(a);
  });

  test("inconsistent record does not throw", () => {
    const rec: TuningRecord = {
      pending: { from: 1500, to: 1700, at: 1000, before: { asked: 40, timeouts: 8 } },
    };
    const out = step(rec, []);
    expect(out.events).toEqual([]);
    expect(out.record.pending).toBeUndefined();
  });

  test("untuned value out of range is not tuned", () => {
    const plain: TuningRecord = { history: history1000 };
    expect(step(plain, mixed(1001, 8), 9000)).toEqual({ record: plain, events: [] });
    const tuned: TuningRecord = { timeoutMs: { value: 1700, base: 1500 }, history: history1000 };
    expect(step(tuned, mixed(1001, 8), 9000)).toEqual({ record: tuned, events: [] });
  });

  test("idempotent on same inputs", () => {
    const ls = mixed(1001, 8);
    const first = step({}, ls);
    expect(first.events).toHaveLength(1);
    expect(step(first.record, ls)).toEqual({ record: first.record, events: [] });
  });

  test("active block caps the raise", () => {
    const rec: TuningRecord = { history: history1000, block: { value: 1700, at: 1000 } };
    const out = step(rec, mixed(1001, 8));
    expect(out.events).toEqual([{ kind: "applied", from: 1500, to: 1600 }]);
  });

  test("expired block is ignored", () => {
    const rec: TuningRecord = { history: history1000, block: { value: 1700, at: 1000 } };
    const ls = [...mixed(1001, 8), ...lines(200, 2000)];
    const recent = [...mixed(2200, 8)];
    const out = step(rec, [...ls, ...recent]);
    expect(out.events).toEqual([{ kind: "applied", from: 1500, to: 1700 }]);
  });

  test("idempotent after a revert", () => {
    const rec = pendingRecord(1500, 1700, { asked: 40, timeouts: 2 });
    const ls = mixed(1001, 8);
    const first = step(rec, ls);
    expect(first.events).toEqual([{ kind: "reverted", from: 1700, to: 1500 }]);
    expect(step(first.record, ls)).toEqual({ record: first.record, events: [] });
  });
});

const rule = (at: number, from: number, to: number): HistoryEntry => ({
  at,
  parameter: "timeoutMs",
  from,
  to,
  cause: "rule",
});

describe("undoTuning", () => {
  test("Undo a change", () => {
    const rec: TuningRecord = {
      timeoutMs: { value: 1700, base: 1500 },
      pending: { from: 1500, to: 1700, at: 10, before: { asked: 20, timeouts: 3 } },
      history: [rule(10, 1500, 1700)],
    };
    const out = undoTuning(rec, 5000);
    expect(out).toEqual({
      kind: "undone",
      from: 1700,
      to: 1500,
      record: {
        block: { value: 1700, at: 5000 },
        history: [
          rule(10, 1500, 1700),
          { at: 5000, parameter: "timeoutMs", from: 1700, to: 1500, cause: "undo" },
        ],
      },
    });
  });

  test("Undo after a revert", () => {
    const rec: TuningRecord = {
      timeoutMs: { value: 1700, base: 1500 },
      history: [
        rule(10, 1500, 1700),
        rule(60, 1700, 1900),
        { at: 120, parameter: "timeoutMs", from: 1900, to: 1700, cause: "revert" },
      ],
    };
    const out = undoTuning(rec, 5000);
    expect(out.kind).toBe("undone");
    expect(out.record.timeoutMs).toBeUndefined();
    expect(out.record.block).toEqual({ value: 1700, at: 5000 });
    expect(out.record.history?.at(-1)).toEqual({
      at: 5000,
      parameter: "timeoutMs",
      from: 1700,
      to: 1500,
      cause: "undo",
    });
  });

  test("Second undo", () => {
    const rec: TuningRecord = {
      timeoutMs: { value: 1900, base: 1500 },
      history: [rule(10, 1500, 1700), rule(60, 1700, 1900)],
    };
    const first = undoTuning(rec, 5000);
    expect(first.record.timeoutMs).toEqual({ value: 1700, base: 1500 });
    expect(first.record.block).toEqual({ value: 1900, at: 5000 });
    const second = undoTuning(first.record, 6000);
    expect(second.record.timeoutMs).toBeUndefined();
    expect(second.record.block).toEqual({ value: 1700, at: 6000 });
    expect(second.record.history?.slice(-2).map((h) => h.cause)).toEqual(["undo", "undo"]);
  });

  test("Nothing to undo", () => {
    const rec: TuningRecord = { off: true, history: [rule(10, 1500, 1700)] };
    expect(undoTuning(rec, 5000)).toEqual({ kind: "nothing", record: rec });
  });

  test("no matching rule entry drops the value", () => {
    const rec: TuningRecord = { timeoutMs: { value: 1700, base: 1500 } };
    const out = undoTuning(rec, 5000);
    expect(out.record.timeoutMs).toBeUndefined();
    expect(out.record.history).toEqual([
      { at: 5000, parameter: "timeoutMs", from: 1700, to: 1500, cause: "undo" },
    ]);
  });

  test("history stays bounded", () => {
    const history = Array.from({ length: 50 }, (_, i) => rule(i, 1500, 1700));
    const out = undoTuning({ timeoutMs: { value: 1700, base: 1500 }, history }, 5000);
    expect(out.record.history).toHaveLength(50);
    expect(out.record.history?.[0]?.at).toBe(1);
  });

  test("leaves its input alone", () => {
    const rec: TuningRecord = {
      timeoutMs: { value: 1700, base: 1500 },
      history: [rule(10, 1500, 1700)],
    };
    const copy = structuredClone(rec);
    undoTuning(rec, 5000);
    expect(rec).toEqual(copy);
  });
});

describe("resetTuning", () => {
  test("Reset after changes", () => {
    const rec: TuningRecord = {
      off: true,
      timeoutMs: { value: 1900, base: 1500 },
      pending: { from: 1700, to: 1900, at: 60, before: { asked: 20, timeouts: 3 } },
      block: { value: 2100, at: 70 },
      history: [rule(10, 1500, 1700)],
    };
    expect(resetTuning(rec, 1500, 5000)).toEqual({
      off: true,
      history: [
        rule(10, 1500, 1700),
        { at: 5000, parameter: "timeoutMs", from: 1900, to: 1500, cause: "reset" },
      ],
    });
  });

  test("nothing tuned adds no entry", () => {
    const rec: TuningRecord = { block: { value: 1700, at: 70 }, history: [rule(10, 1500, 1700)] };
    expect(resetTuning(rec, 1500, 5000)).toEqual({ history: [rule(10, 1500, 1700)] });
  });

  test("reset with untuned out of range", () => {
    const rec: TuningRecord = {
      timeoutMs: { value: 1900, base: 1500 },
      block: { value: 2100, at: 70 },
    };
    expect(resetTuning(rec, 9000, 5000)).toEqual({});
  });
});

describe("setTuningOff", () => {
  test("Turning off keeps the tuned value", () => {
    const rec: TuningRecord = {
      timeoutMs: { value: 1700, base: 1500 },
      history: [rule(10, 1500, 1700)],
    };
    expect(setTuningOff(rec, true)).toEqual({ ...rec, off: true });
    expect(setTuningOff({ ...rec, off: true }, false)).toEqual({ ...rec, off: false });
  });
});

describe("seen helpers", () => {
  test("markSeen sets the marker when absent", () => {
    expect(markSeen({}, 5).seenAt).toBe(5);
  });
  test("markSeen never lowers the marker", () => {
    expect(markSeen({ seenAt: 9 }, 5).seenAt).toBe(9);
  });
  test("markSeen keeps other fields and does not mutate", () => {
    const rec: TuningRecord = {
      off: true,
      timeoutMs: { value: 1700, base: 1500 },
      history: [rule(10, 1500, 1700)],
    };
    const copy = structuredClone(rec);
    expect(markSeen(rec, 5)).toEqual({ ...copy, seenAt: 5 });
    expect(rec).toEqual(copy);
  });
  test("unseenEntries returns all without a marker", () => {
    const history = [rule(1000, 1500, 1700), rule(2000, 1700, 1900)];
    expect(unseenEntries({ history })).toEqual(history);
    expect(unseenEntries({})).toEqual([]);
  });
  test("unseenEntries returns entries after the marker", () => {
    const a = rule(1000, 1500, 1700);
    const b = rule(2000, 1700, 1900);
    const c = rule(3000, 1900, 2100);
    expect(unseenEntries({ seenAt: 1000, history: [a, b, c] })).toEqual([b, c]);
  });
  test("transitions keep seenAt", () => {
    const rec: TuningRecord = {
      seenAt: 7,
      timeoutMs: { value: 1700, base: 1500 },
      history: [rule(10, 1500, 1700)],
    };
    const undone = undoTuning(rec, 100);
    expect(undone.record.seenAt).toBe(7);
    expect(resetTuning(rec, 1500, 100).seenAt).toBe(7);
    expect(setTuningOff(rec, true).seenAt).toBe(7);
    expect(stepTuning({ record: rec, untuned: 1500, lines: [], now: 100 }).record.seenAt).toBe(7);
  });
});
