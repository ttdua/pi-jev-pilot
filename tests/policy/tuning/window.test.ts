import { describe, expect, test } from "bun:test";
import { after, counts, decisions, p90, shareAbove } from "../../../src/policy/tuning/window.ts";
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
    expect(counts(ds).asked).toBe(40);
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

describe("shareAbove", () => {
  test("`shareAbove` integers", () => {
    expect(shareAbove({ asked: 40, timeouts: 8 }, { asked: 40, timeouts: 6 })).toBe(true);
    expect(shareAbove({ asked: 40, timeouts: 8 }, { asked: 40, timeouts: 8 })).toBe(false);
  });
});
