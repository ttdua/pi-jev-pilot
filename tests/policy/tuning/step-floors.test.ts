import { describe, expect, test } from "bun:test";
import {
  resetTuning,
  stepTuning,
  undoTuning,
  type HistoryEntry,
  type TuningRecord,
} from "../../../src/policy/tuning/rules.ts";
import type { TuningLine } from "../../../src/policy/tuning/record.ts";
import type { FloorBand } from "../../../src/shared/turn-floors.ts";
import { line } from "./lines.ts";
import { runs } from "./worker-lines.ts";

const timeoutLine = { answered: false, miss: "timeout" };

/** 200 `band` runs from `from`; those at index `>= timeoutsFrom` are timeouts. */
function bandRuns(band: FloorBand, used: number, from: number, timeoutsFrom = Infinity) {
  return runs(200, from, band, used, (i) => (i >= timeoutsFrom ? timeoutLine : { answered: true }));
}

/** Timeouts at indices 160-169: the latest 5 asked hold none, the window rule still fires. */
const midTimeouts = (l: TuningLine, i: number): TuningLine =>
  i >= 160 && i < 170 ? { ...l, answered: false, miss: "timeout" } : l;

const step = (record: TuningRecord, lines: readonly TuningLine[], untuned = 1500, now = 90000) =>
  stepTuning({ record, untuned, lines, now });

const floorEntry = (
  band: FloorBand,
  at: number,
  from: number,
  to: number,
  cause: HistoryEntry["cause"] = "rule",
): HistoryEntry => ({ at, parameter: `turnFloor.${band}`, from, to, cause });
const timeoutEntry = (at: number, from: number, to: number): HistoryEntry => ({
  at,
  parameter: "timeoutMs",
  from,
  to,
  cause: "rule",
});

/** `long` floor 100 → 75 pending since 1000, judged by the 200 runs after it. */
const longPending: TuningRecord = {
  turnFloors: {
    long: {
      changedAt: 1000,
      tuned: { value: 75, base: 100 },
      pending: { from: 100, to: 75, at: 1000, before: { runs: 200, exhausted: 0 } },
    },
  },
  history: [floorEntry("long", 1000, 100, 75)],
};

describe("step order across parameters", () => {
  test("One applied change per step", () => {
    const out = step({}, bandRuns("long", 40, 1001).map(midTimeouts));
    expect(out.events).toEqual([{ kind: "applied", parameter: "timeoutMs", from: 1500, to: 1700 }]);
    expect(out.record.turnFloors).toBeUndefined();
  });

  test("Burst before the window rule", () => {
    const ls = bandRuns("long", 40, 1001).map(midTimeouts);
    const burst = [1, 2, 3].map((i) => ({ ...line(2000 + i, timeoutLine) }));
    const out = step({}, [...ls, ...burst]);
    expect(out.events).toEqual([{ kind: "applied", parameter: "timeoutMs", from: 1500, to: 1900 }]);
  });

  test("Floor applies when timeout does not", () => {
    const ls = [...bandRuns("medium", 20, 1), ...bandRuns("long", 40, 201)];
    const out = step({}, ls);
    expect(out.events).toEqual([
      { kind: "applied", parameter: "turnFloor.medium", from: 40, to: 30 },
    ]);
    expect(out.record.turnFloors?.long).toBeUndefined();
  });

  test("Revert blocks every apply", () => {
    const burst = [1, 2, 3].map((i) => ({ ...line(5000 + i, timeoutLine) }));
    const out = step(longPending, [...bandRuns("long", 40, 1001).map(exhausted), ...burst]);
    expect(out.events).toEqual([
      { kind: "reverted", parameter: "turnFloor.long", from: 75, to: 100 },
    ]);
  });

  test("Timeout revert blocks a floor change", () => {
    const rec: TuningRecord = {
      timeoutMs: { value: 1700, base: 1500 },
      pending: { from: 1500, to: 1700, at: 1000, before: { asked: 40, timeouts: 2 } },
      history: [timeoutEntry(1000, 1500, 1700)],
    };
    const ls = runs(200, 1001, "long", 40, (i) => (i < 8 ? timeoutLine : { answered: true }));
    const out = step(rec, ls);
    expect(out.events).toEqual([
      { kind: "reverted", parameter: "timeoutMs", from: 1700, to: 1500 },
    ]);
  });

  test("a kept change and a floor apply share the step", () => {
    const out = step(longPending, bandRuns("long", 75, 1001));
    expect(out.events.map((e) => e.kind)).toEqual(["kept", "applied"]);
    expect(out.events.every((e) => e.parameter === "turnFloor.long")).toBe(true);
  });
});

const exhausted = (l: TuningLine): TuningLine => ({ ...l, turnPhase: "exhausted" });

describe("step with floors", () => {
  test("Floor change does not hold back the timeout", () => {
    const rec: TuningRecord = {
      turnFloors: { long: { changedAt: 5000 } },
      history: [timeoutEntry(1000, 1, 2), floorEntry("long", 5000, 100, 90)],
    };
    const ls = Array.from({ length: 40 }, (_, i) =>
      line(i < 30 ? 1001 + i : 5001 + i, i < 10 ? timeoutLine : {}),
    );
    const out = step(rec, ls);
    expect(out.events).toEqual([{ kind: "applied", parameter: "timeoutMs", from: 1500, to: 1700 }]);
  });

  test("Floors kept on a config edit", () => {
    const rec: TuningRecord = {
      timeoutMs: { value: 1700, base: 1500 },
      turnFloors: { long: { changedAt: 1, tuned: { value: 120, base: 100 } } },
    };
    const out = step(rec, [], 2000);
    expect(out.events).toEqual([
      { kind: "superseded", parameter: "timeoutMs", from: 1700, to: 2000 },
    ]);
    expect(out.record.turnFloors?.long?.tuned).toEqual({ value: 120, base: 100 });
  });

  test("Off holds floors", () => {
    const rec: TuningRecord = { ...longPending, off: true };
    const ls = bandRuns("long", 75, 1001);
    expect(step(rec, ls)).toEqual({ record: rec, events: [] });
    const on = step({ ...longPending }, ls);
    expect(on.events[0]?.kind).toBe("kept");
    const worse = step({ ...longPending }, ls.map(exhausted));
    expect(worse.events[0]?.kind).toBe("reverted");
  });

  test("a superseded floor is reported with its parameter", () => {
    const rec: TuningRecord = {
      turnFloors: { long: { changedAt: 1, tuned: { value: 120, base: 90 } } },
    };
    const out = step(rec, [], 1500, 7000);
    expect(out.events).toEqual([
      { kind: "superseded", parameter: "turnFloor.long", from: 120, to: 100 },
    ]);
    expect(out.record.turnFloors?.long).toEqual({ changedAt: 7000 });
  });

  test("Shared across parameters", () => {
    const history = Array.from({ length: 50 }, (_, i) => timeoutEntry(i + 1, 1, 2));
    const out = step({ history }, bandRuns("long", 40, 1001));
    expect(out.record.history).toHaveLength(50);
    expect(out.record.history?.at(-1)?.parameter).toBe("turnFloor.long");
    expect(out.record.history?.[0]?.at).toBe(2);
  });
});

describe("undo across parameters", () => {
  const tunedTimeout = { value: 1700, base: 1500 };

  test("Latest change undone first", () => {
    const rec: TuningRecord = {
      timeoutMs: tunedTimeout,
      turnFloors: { long: { changedAt: 2000, tuned: { value: 80, base: 100 } } },
      history: [timeoutEntry(1000, 1500, 1700), floorEntry("long", 2000, 100, 80)],
    };
    const out = undoTuning(rec, 3000);
    expect(out).toMatchObject({ kind: "undone", parameter: "turnFloor.long", from: 80, to: 100 });
    expect(out.record.timeoutMs).toEqual(tunedTimeout);
    expect(out.record.turnFloors?.long).toEqual({
      changedAt: 3000,
      block: { value: 80, at: 3000 },
    });
    expect(out.record.history?.at(-1)).toEqual(floorEntry("long", 3000, 80, 100, "undo"));
  });

  const veryLongAt100 = (pending: boolean): TuningRecord => ({
    turnFloors: {
      very_long: {
        changedAt: 1000,
        tuned: { value: pending ? 120 : 100, base: 200 },
        ...(pending
          ? { pending: { from: 100, to: 120, at: 1000, before: { runs: 200, exhausted: 0 } } }
          : {}),
      },
      long: { changedAt: 2000, tuned: { value: 80, base: 100 } },
    },
    history: [floorEntry("long", 2000, 100, 80)],
  });

  test("Floor undo kept in order", () => {
    const out = undoTuning(veryLongAt100(false), 3000);
    expect(out).toMatchObject({ kind: "undone", parameter: "turnFloor.long", from: 80, to: 90 });
    expect(out.record.turnFloors?.long?.tuned).toEqual({ value: 90, base: 100 });
    expect(out.record.history?.at(-1)).toEqual(floorEntry("long", 3000, 80, 90, "undo"));
  });

  test("Floor undo against a pending neighbour", () => {
    const out = undoTuning(veryLongAt100(true), 3000);
    expect(out).toMatchObject({ parameter: "turnFloor.long", from: 80, to: 90 });
  });

  test("Floor undo blocked by the order", () => {
    const rec: TuningRecord = {
      timeoutMs: tunedTimeout,
      turnFloors: {
        medium: { changedAt: 1000, tuned: { value: 50, base: 40 } },
        long: { changedAt: 2000, tuned: { value: 60, base: 100 } },
      },
      history: [timeoutEntry(1500, 1500, 1700), floorEntry("long", 2000, 50, 60)],
    };
    const out = undoTuning(rec, 3000);
    expect(out).toMatchObject({ kind: "undone", parameter: "timeoutMs", from: 1700, to: 1500 });
    expect(out.record.turnFloors?.long?.tuned).toEqual({ value: 60, base: 100 });
  });

  test("a timeout tuned against another untuned value is not undone", () => {
    const rec: TuningRecord = { timeoutMs: tunedTimeout, history: [timeoutEntry(1, 1500, 1700)] };
    expect(undoTuning(rec, 3000, 2000)).toEqual({ kind: "nothing", record: rec });
  });

  test("a floor whose base is not the built-in floor is not undone", () => {
    const rec: TuningRecord = {
      turnFloors: { long: { changedAt: 2000, tuned: { value: 80, base: 90 } } },
    };
    expect(undoTuning(rec, 3000)).toEqual({ kind: "nothing", record: rec });
  });

  test("ties go to timeoutMs first", () => {
    const rec: TuningRecord = {
      timeoutMs: tunedTimeout,
      turnFloors: { medium: { changedAt: 1000, tuned: { value: 30, base: 40 } } },
      history: [timeoutEntry(1000, 1500, 1700)],
    };
    expect(undoTuning(rec, 3000)).toMatchObject({ parameter: "timeoutMs" });
  });
});

describe("reset across parameters", () => {
  test("Reset floors too", () => {
    const rec: TuningRecord = {
      off: true,
      timeoutMs: { value: 1700, base: 1500 },
      block: { value: 1900, at: 5 },
      turnFloors: {
        long: {
          changedAt: 9,
          tuned: { value: 120, base: 100 },
          block: { value: 140, at: 9 },
          pending: { from: 100, to: 120, at: 9, before: { runs: 200, exhausted: 0 } },
        },
      },
    };
    expect(resetTuning(rec, 1500, 5000)).toEqual({
      off: true,
      history: [
        { at: 5000, parameter: "timeoutMs", from: 1700, to: 1500, cause: "reset" },
        floorEntry("long", 5000, 120, 100, "reset"),
      ],
    });
  });

  test("floor state without a tuned value is dropped without an entry", () => {
    const rec: TuningRecord = { turnFloors: { long: { changedAt: 9 } } };
    expect(resetTuning(rec, 1500, 5000)).toEqual({});
  });
});

describe("step from an out-of-order record", () => {
  test("moves from the built-in floors that routing uses", () => {
    const rec: TuningRecord = {
      turnFloors: {
        medium: { changedAt: 1, tuned: { value: 80, base: 40 } },
        long: { changedAt: 1, tuned: { value: 50, base: 100 } },
      },
    };
    const out = step(rec, bandRuns("medium", 20, 2));
    expect(out.events).toEqual([
      { kind: "applied", parameter: "turnFloor.medium", from: 40, to: 30 },
    ]);
  });
});
