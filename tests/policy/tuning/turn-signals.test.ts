import { expect, test } from "bun:test";
import { BUILTIN_FLOORS } from "../../../src/shared/turn-floors.ts";
import { turnSignals } from "../../../src/policy/tuning/turn-signals.ts";
import { runs } from "./worker-lines.ts";

const long = (t: ReturnType<typeof turnSignals>) => t.find((s) => s.band === "long");
// 50 old runs, then 200 with p95 60 (180 × 30, 20 × 60) of which 4 exhausted.
const full = () => [
  ...runs(50, 1, "long", 99),
  ...runs(
    200,
    100,
    "long",
    (i) => (i < 180 ? 30 : 60),
    (i) => (i >= 196 ? { turnPhase: "exhausted" } : {}),
  ),
];

test("Signal with a full window", () => {
  expect(long(turnSignals(full(), BUILTIN_FLOORS))).toMatchObject({
    runs: 200,
    p95: 60,
    exhausted: 4,
    suggested: 80,
  });
});

test("Too few runs suggest nothing", () => {
  const s = long(turnSignals(runs(120, 1, "long", 50), BUILTIN_FLOORS));
  expect(s?.runs).toBe(120);
  expect(s?.p95).toBe(50);
  expect(s).not.toHaveProperty("suggested");
});

test("No runs", () => {
  const got = turnSignals(runs(5, 1, "long", 50), BUILTIN_FLOORS);
  expect(got.find((s) => s.band === "very_long")).toEqual({ band: "very_long", runs: 0 });
});

test("Used over floor", () => {
  const lines = [
    ...runs(1, 1, "long", 50, { turnFloor: 100 }),
    ...runs(1, 2, "long", 100, { turnFloor: 100 }),
    ...runs(1, 3, "long", 10),
  ];
  expect(long(turnSignals(lines, BUILTIN_FLOORS))?.usedOverFloor).toBe(0.75);
});

test("Turn signal order irrelevant", () => {
  const lines = full();
  const a = turnSignals(lines, BUILTIN_FLOORS);
  const b = turnSignals([...lines].reverse(), BUILTIN_FLOORS);
  expect(b).toEqual(a);
  expect(a.map((s) => s.band)).toEqual(["medium", "long", "very_long"]);
});

test("Turn signal input unchanged", () => {
  const lines = full();
  const copy = structuredClone(lines);
  turnSignals(lines, BUILTIN_FLOORS);
  expect(lines).toEqual(copy);
});
