import { describe, expect, test } from "bun:test";
import {
  after,
  counts,
  decisions,
  latestAsked,
  p90,
  rescued,
  shareAbove,
} from "../../../src/policy/tuning/window.ts";
import { line, lines } from "./lines.ts";

describe("decisions", () => {
  test("Correction lines ignored", () => {
    const ds = decisions([line(1), line(2, { kind: "correction" }), line(3, { kind: "worker" })]);
    expect(ds.map((d) => d.kind)).toEqual(["main", "worker"]);
  });

  test("Line order does not matter", () => {
    const five = [
      line(5, { kind: "worker" }),
      line(5, { session: "a" }),
      line(5, { session: "b", answered: false, miss: "timeout" }),
      line(5, { session: "b", answered: false, miss: "error" }),
      line(5, { session: "b", ms: 10 }),
    ];
    const shuffled = [five[3]!, five[0]!, five[4]!, five[2]!, five[1]!];
    expect(decisions(shuffled)).toEqual(decisions(five));
  });

  test("does not mutate its input", () => {
    const input = [line(2), line(1)];
    decisions(input);
    expect(input.map((d) => d.at)).toEqual([2, 1]);
  });
});

describe("after", () => {
  test("`after` is strict", () => {
    expect(after([line(10), line(11)], 10).map((d) => d.at)).toEqual([11]);
  });
});

describe("counts", () => {
  test("Unasked decisions are not counted", () => {
    const ds = [
      ...lines(17, 0),
      ...lines(3, 20, { answered: false, miss: "timeout" }),
      ...lines(20, 40, { answered: false }),
    ];
    expect(counts(ds)).toEqual({ asked: 20, timeouts: 3 });
  });
});

describe("p90", () => {
  test("Nearest-rank p90", () => {
    const ds = Array.from({ length: 20 }, (_, i) => line(i, { ms: (i + 1) * 100 }));
    expect(p90(ds)).toBe(1800);
  });

  test("Answered lines without ms", () => {
    const ds = [
      ...Array.from({ length: 20 }, (_, i) => line(i, { ms: (i + 1) * 100 })),
      ...lines(10, 100, {}),
      ...lines(10, 200, { answered: false, miss: "timeout" }),
    ];
    expect(p90(ds)).toBe(1800);
    expect(counts(ds)).toEqual({ asked: 40, timeouts: 10 });
  });

  test("Timeouts count in p90", () => {
    const ds = [
      ...Array.from({ length: 34 }, (_, i) => line(i, { ms: 300 + Math.round((i * 1000) / 33) })),
      ...lines(6, 100, { answered: false, miss: "timeout", ms: 1702 }),
    ];
    expect(p90(ds)).toBe(1702);
  });

  test("Other misses not in p90", () => {
    const ds = [
      ...lines(36, 0, { ms: 500 }),
      ...lines(4, 100, { answered: false, miss: "error", ms: 3000 }),
    ];
    expect(p90(ds)).toBe(500);
  });

  test("no values gives undefined", () => {
    expect(p90([line(1)])).toBeUndefined();
  });

  test("p90 rank for every n", () => {
    for (let n = 1; n <= 40; n++) {
      const ds = Array.from({ length: n }, (_, i) => line(i, { ms: (n - i) * 7 }));
      const sorted = Array.from({ length: n }, (_, i) => (i + 1) * 7);
      expect(p90(ds)).toBe(sorted[Math.floor((9 * n + 9) / 10) - 1]!);
    }
  });
});

describe("latestAsked", () => {
  test("Latest asked lines in at order", () => {
    const timeout = { answered: false, miss: "timeout" };
    const ds = [
      line(5, timeout),
      line(4, { answered: false }),
      line(3, timeout),
      line(2, { answered: false }),
      line(1, timeout),
    ];
    expect(latestAsked(ds, 5).map((d) => d.at)).toEqual([1, 3, 5]);
  });

  test("Keeps only the latest n asked", () => {
    const ds = lines(7, 0);
    expect(latestAsked(ds, 5).map((d) => d.at)).toEqual([2, 3, 4, 5, 6]);
  });
});

describe("rescued", () => {
  test("Rescue needs an answer above the floor", () => {
    const ds = [line(1, { ms: 1650 }), line(2, { ms: 1700 })];
    expect(rescued(ds, 1700)).toBe(false);
    expect(rescued([...ds, line(3, { ms: 1701 })], 1700)).toBe(true);
  });

  test("A timeout above the floor does not rescue", () => {
    const ds = [line(1, { answered: false, miss: "timeout", ms: 1900 })];
    expect(rescued(ds, 1700)).toBe(false);
  });
});

describe("shareAbove", () => {
  test("`shareAbove` integers", () => {
    expect(shareAbove({ asked: 40, timeouts: 8 }, { asked: 40, timeouts: 6 })).toBe(true);
    expect(shareAbove({ asked: 40, timeouts: 8 }, { asked: 40, timeouts: 8 })).toBe(false);
  });
});
