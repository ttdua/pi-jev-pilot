import { expect, test } from "bun:test";
import { countedRuns, nearestRank } from "../../../src/policy/tuning/floor-runs.ts";
import { floorWindow } from "../../../src/policy/tuning/floor-rules.ts";
import type { TuningLine } from "../../../src/policy/tuning/record.ts";
import { run, runs } from "./worker-lines.ts";

const LONG = { short: 0.1, medium: 0.2, long: 0.6, very_long: 0.1 };
const worker = (o: Partial<TuningLine>): TuningLine => ({ kind: "worker", at: 1, ...o });
const none = (l: TuningLine) =>
  (["medium", "long", "very_long"] as const).flatMap((b) => countedRuns([l], b));

test("band by cumulative probability", () => {
  const got = countedRuns([worker({ turnsP: LONG, turnsUsed: 37 })], "long");
  expect(got.map((r) => [r.band, r.used])).toEqual([["long", 37]]);
});

test("short runs not counted", () => {
  expect(none(worker({ turnsP: { short: 0.7, medium: 0.3 }, turnsUsed: 5 }))).toEqual([]);
});

test("Jev miss not counted", () => {
  const l = worker({ answered: false, miss: "timeout", turnsUsed: 20 });
  expect(none(l)).toEqual([]);
});

test("aborted run not counted", () => {
  expect(none(worker({ turnsP: LONG, turnsUsed: 3, status: "aborted" }))).toEqual([]);
});

test("no turn use", () => {
  expect(none(worker({ turnsP: LONG }))).toEqual([]);
  expect(none(worker({ turnsP: LONG, turnsUsed: 1.5 }))).toEqual([]);
});

test("not raised still counts", () => {
  expect(countedRuns([worker({ turnsP: LONG, turnsUsed: 90 })], "long")).toHaveLength(1);
});

test("main lines not counted", () => {
  expect(none({ ...worker({ turnsP: LONG, turnsUsed: 9 }), kind: "main" })).toEqual([]);
});

test("other bands do not count", () => {
  const lines = [...runs(150, 1, "long", 50), ...runs(300, 1000, "medium", 50)];
  expect(countedRuns(lines, "long")).toHaveLength(150);
});

test("input order irrelevant", () => {
  const lines = [run(5, "long", 10), run(5, "long", 20), run(5, "long", 30), run(4, "long", 1)];
  const a = countedRuns(lines, "long");
  const b = countedRuns([...lines].reverse(), "long");
  expect(b).toEqual(a);
  expect(a[0]?.used).toBe(1);
});

test("phase and floor are carried", () => {
  const [r] = countedRuns([run(1, "long", 9, { turnPhase: "exhausted", turnFloor: 100 })], "long");
  expect(r).toMatchObject({ phase: "exhausted", floor: 100 });
});

test("old lines without turnsP never form a window", () => {
  const old: TuningLine[] = Array.from({ length: 1274 }, (_, i) => worker({ at: i, turnsUsed: 5 }));
  const lines = [...old, ...runs(199, 5000, "long", 50)];
  expect(floorWindow(countedRuns(lines, "long"), 0)).toBeUndefined();
});

test("nearestRank", () => {
  expect(nearestRank([], 95)).toBeUndefined();
  const sorted = Array.from({ length: 200 }, (_, i) => i);
  expect(nearestRank(sorted, 95)).toBe(189);
});
