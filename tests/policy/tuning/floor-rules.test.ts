import { describe, expect, test } from "bun:test";
import { countedRuns } from "../../../src/policy/tuning/floor-runs.ts";
import {
  applyFloor,
  blockActiveFloor,
  effectiveFloors,
  FLOOR,
  floorSince,
  floorWindow,
  judgeFloor,
  nextFloor,
  orderBounds,
  supersedeFloor,
} from "../../../src/policy/tuning/floor-rules.ts";
import type { TuningRecord } from "../../../src/policy/tuning/record.ts";
import { FLOOR_BANDS, type FloorBand } from "../../../src/shared/turn-floors.ts";
import { FLOOR_RUNS_MAX } from "../../../src/store/tuning-file.ts";
import { runs } from "./worker-lines.ts";

/** 200 runs whose nearest-rank p95 is `p95` and of which `exhausted` ended exhausted. */
function window(band: FloorBand, p95: number, exhausted = 0, from = 1) {
  const lines = runs(
    200,
    from,
    band,
    (i) => (i < 190 ? p95 : p95 + 50),
    (i) => (i < exhausted ? { turnPhase: "exhausted" } : {}),
  );
  return countedRuns(lines, band);
}

type Row = {
  name: string;
  band: FloorBand;
  current: number;
  p95: number;
  exhausted?: number;
  bounds?: { lower?: number; upper?: number };
  block?: { value: number };
  want: number | undefined;
};

const rows: Row[] = [
  { name: "lowered within step", band: "long", current: 100, p95: 60, want: 80 },
  { name: "decrease bounded", band: "long", current: 100, p95: 30, want: 80 },
  { name: "increase bounded", band: "long", current: 100, p95: 150, want: 120 },
  { name: "exhausted forces raise", band: "long", current: 100, p95: 70, exhausted: 11, want: 120 },
  { name: "exactly 5% exhausted", band: "long", current: 100, p95: 70, exhausted: 10, want: 90 },
  { name: "hard minimum", band: "medium", current: 20, p95: 5, want: undefined },
  { name: "hard maximum", band: "very_long", current: 400, p95: 390, want: undefined },
  { name: "ordered", band: "long", current: 100, p95: 40, bounds: { lower: 80 }, want: 90 },
  { name: "minimum move of 10", band: "medium", current: 30, p95: 10, want: 20 },
  { name: "unchanged value", band: "long", current: 100, p95: 80, want: undefined },
  {
    name: "pending neighbour in order",
    band: "very_long",
    current: 200,
    p95: 70,
    bounds: { lower: 100 },
    want: 150,
  },
  {
    name: "pending neighbour bounds decrease",
    band: "very_long",
    current: 130,
    p95: 70,
    bounds: { lower: 100 },
    want: 110,
  },
  { name: "blocked decrease", band: "long", current: 100, p95: 64, block: { value: 80 }, want: 90 },
  {
    name: "blocked raise dropped",
    band: "long",
    current: 110,
    p95: 104,
    block: { value: 120 },
    want: undefined,
  },
  { name: "block expired", band: "long", current: 100, p95: 64, want: 80 },
];

describe("nextFloor", () => {
  test.each(rows)("$name", (r) => {
    const got = nextFloor({
      band: r.band,
      current: r.current,
      window: window(r.band, r.p95, r.exhausted),
      bounds: r.bounds ?? {},
      ...(r.block === undefined ? {} : { block: r.block }),
    });
    expect(got).toBe(r.want);
  });
});

describe("bounds and effective floors", () => {
  test("effective floors use tuned values with the built-in base only", () => {
    const record: TuningRecord = {
      turnFloors: {
        medium: { changedAt: 1, tuned: { value: 30, base: 40 } },
        long: { changedAt: 1, tuned: { value: 120, base: 90 } },
      },
    };
    expect(effectiveFloors(record)).toEqual({ medium: 30, long: 100, very_long: 200 });
  });

  test("pending neighbours count as the safer end", () => {
    const record: TuningRecord = {
      turnFloors: {
        long: {
          changedAt: 1,
          tuned: { value: 80, base: 100 },
          pending: { from: 100, to: 80, at: 1, before: { runs: 200, exhausted: 0 } },
        },
      },
    };
    const eff = effectiveFloors(record);
    expect(orderBounds("very_long", eff, record)).toEqual({ lower: 100 });
    expect(orderBounds("medium", eff, record)).toEqual({ upper: 80 });
    expect(orderBounds("long", eff, record)).toEqual({ lower: 40, upper: 200 });
  });
});

describe("floor window", () => {
  const now = 1000;

  test("floorSince is the later of changedAt and the latest entry", () => {
    const record: TuningRecord = {
      turnFloors: { long: { changedAt: 500 } },
      history: [{ at: 700, parameter: "turnFloor.long", from: 1, to: 2, cause: "rule" }],
    };
    expect(floorSince(record, "long")).toBe(700);
    expect(floorSince(record, "medium")).toBe(0);
  });

  test("too few runs", () => {
    expect(floorWindow(window("long", 190).slice(1), 0)).toBeUndefined();
  });

  test("cooldown survives a trimmed history", () => {
    const record: TuningRecord = { turnFloors: { very_long: { changedAt: now } } };
    const all = countedRuns(
      [...runs(100, 1, "very_long", 50), ...runs(150, now + 1, "very_long", 50)],
      "very_long",
    );
    expect(floorWindow(all, floorSince(record, "very_long"))).toBeUndefined();
  });

  test("the latest 200 after since", () => {
    const all = countedRuns(runs(250, 1, "long", 50), "long");
    const got = floorWindow(all, 50);
    expect(got).toHaveLength(200);
    expect(got?.[0]?.at).toBe(51);
  });
});

describe("floor records", () => {
  const before = { runs: 200, exhausted: 3 };

  test("first floor change recorded", () => {
    const out = applyFloor({}, { band: "long", from: 100, to: 80, before, now: 1000 });
    expect(out.turnFloors?.long).toEqual({
      changedAt: 1000,
      tuned: { value: 80, base: 100 },
      pending: { from: 100, to: 80, at: 1000, before },
    });
    expect(out.history).toEqual([
      { at: 1000, parameter: "turnFloor.long", from: 100, to: 80, cause: "rule" },
    ]);
  });

  const pendingRecord = (ex: number): TuningRecord =>
    applyFloor(
      {},
      { band: "long", from: 100, to: 80, before: { runs: 200, exhausted: ex }, now: 1000 },
    );

  test("more exhausted, reverted at 9000 with a block", () => {
    const rec = pendingRecord(2);
    const out = judgeFloor(rec, "long", window("long", 60, 6, 2000), 9000);
    expect(out.event).toEqual({
      kind: "reverted",
      parameter: "turnFloor.long",
      from: 80,
      to: 100,
    });
    expect(out.record.turnFloors?.long).toEqual({
      changedAt: 9000,
      block: { value: 80, at: 9000 },
    });
    expect(out.record.history?.at(-1)).toEqual({
      at: 9000,
      parameter: "turnFloor.long",
      from: 80,
      to: 100,
      cause: "revert",
    });
  });

  test("equal, kept", () => {
    const out = judgeFloor(pendingRecord(4), "long", window("long", 60, 4, 2000), 9000);
    expect(out.event).toEqual({ kind: "kept", parameter: "turnFloor.long", from: 100, to: 80 });
    expect(out.record.turnFloors?.long?.pending).toBeUndefined();
    expect(out.record.turnFloors?.long?.tuned).toEqual({ value: 80, base: 100 });
    expect(out.record.history).toHaveLength(1);
  });

  test("not yet judged", () => {
    const rec = pendingRecord(4);
    const out = judgeFloor(rec, "long", window("long", 60, 0, 2000).slice(1), 9000);
    expect(out).toEqual({ record: rec });
  });

  test("block after a real revert", () => {
    const reverted = judgeFloor(pendingRecord(2), "long", window("long", 60, 6, 2000), 9000).record;
    const later = countedRuns(runs(250, 9001, "long", 50), "long");
    const win = floorWindow(later, floorSince(reverted, "long"));
    const block = reverted.turnFloors?.long?.block;
    expect(blockActiveFloor(block, later)).toBe(true);
    const got = nextFloor({
      band: "long",
      current: 100,
      window: win ?? [],
      bounds: {},
      ...(block === undefined ? {} : { block }),
    });
    expect(got).toBe(90);
  });

  test("block expired after 400 runs", () => {
    const later = countedRuns(runs(400, 9001, "long", 50), "long");
    expect(blockActiveFloor({ at: 9000 }, later)).toBe(false);
    expect(blockActiveFloor(undefined, later)).toBe(false);
  });

  test("new built-in floor supersedes", () => {
    const rec: TuningRecord = {
      turnFloors: { long: { changedAt: 1, tuned: { value: 120, base: 90 } } },
    };
    const out = supersedeFloor(rec, "long", 5000);
    expect(out.record.turnFloors?.long).toEqual({ changedAt: 5000 });
    expect(out.event).toEqual({
      kind: "superseded",
      parameter: "turnFloor.long",
      from: 120,
      to: 100,
    });
    expect(out.record.history?.at(-1)?.cause).toBe("superseded");
    expect(supersedeFloor(out.record, "long", 6000)).toEqual({ record: out.record });
  });

  test("every band has a parameter", () => {
    expect(FLOOR_BANDS).toHaveLength(3);
  });
});

describe("effectiveFloors rules match the settings resolver", () => {
  const tuned = (value: number, base: number) => ({ changedAt: 1, tuned: { value, base } });

  test("an out-of-order record gives the built-in floors", () => {
    const record: TuningRecord = {
      turnFloors: { medium: tuned(80, 40), long: tuned(50, 100) },
    };
    expect(effectiveFloors(record)).toEqual({ medium: 40, long: 100, very_long: 200 });
  });

  test("an out-of-range or non-integer value is built-in for its band", () => {
    const record: TuningRecord = {
      turnFloors: { medium: tuned(10, 40), long: tuned(75.5, 100), very_long: tuned(150, 200) },
    };
    expect(effectiveFloors(record)).toEqual({ medium: 40, long: 100, very_long: 150 });
  });
});

test("the store's stored-runs bound equals the policy window", () => {
  expect(FLOOR_RUNS_MAX).toBe(FLOOR.runs);
});
