import { describe, expect, test } from "bun:test";

import { BUILTIN_FLOORS } from "../../../src/shared/turn-floors.ts";
import type { Answer } from "../../../src/policy/answers.ts";
import type { EffectiveLaunch } from "../../../src/policy/launch.ts";
import { turnBand, turnFloor, turnWrite } from "../../../src/policy/worker/turns.ts";

function turns(probabilities: Record<string, number>, choice = "short"): Answer {
  return { type: "choice", choice, probabilities };
}

function launch(over: Partial<EffectiveLaunch> = {}): EffectiveLaunch {
  return {
    context: "fresh",
    runInBackground: false,
    modelLocked: false,
    thinkingLocked: false,
    maxTurns: 20,
    turnsLocked: false,
    ...over,
  };
}

const floor = (a: Answer | undefined) => turnFloor(a, BUILTIN_FLOORS);

describe("Turn floor", () => {
  test("Long by majority", () => {
    expect(floor(turns({ short: 0.1, medium: 0.2, long: 0.6, very_long: 0.1 }))).toBe(100);
  });
  test("Thin tail does not raise", () => {
    expect(floor(turns({ short: 0.6, medium: 0.1, long: 0.1, very_long: 0.2 }))).toBeUndefined();
  });
  test("Cumulative at the bar", () => {
    expect(floor(turns({ short: 0.5, medium: 0.2, long: 0.2, very_long: 0.1 }))).toBe(40);
  });
  test("Choice is not enough", () => {
    const a = turns({ short: 0.35, medium: 0.25, long: 0.4, very_long: 0 }, "long");
    expect(floor(a)).toBe(40);
  });
  test("Very long", () => {
    expect(floor(turns({ long: 0.3, very_long: 0.7 }))).toBe(200);
  });
  test("Probabilities not normalised", () => {
    expect(floor(turns({ short: 0.4, medium: 0.2, long: 0.2 }))).toBeUndefined();
  });
  test("Unanswered", () => {
    expect(floor(undefined)).toBeUndefined();
    expect(floor({ type: "noul", noul: 0.9 })).toBeUndefined();
  });
  test("turnFloor ignores unknown keys", () => {
    expect(floor(turns({ short: 0.2, long: 0.6, huge: 0.9 }))).toBe(100);
  });
  test("Tuned floors passed in", () => {
    const a = turns({ short: 0.1, medium: 0.2, long: 0.6, very_long: 0.1 });
    expect(turnFloor(a, { medium: 40, long: 80, very_long: 200 })).toBe(80);
    expect(turnBand(a.type === "choice" ? a.probabilities : undefined)).toBe("long");
  });
  test("turnBand without a majority", () => {
    expect(turnBand({ short: 0.7, medium: 0.3 })).toBeUndefined();
    expect(turnBand(undefined)).toBeUndefined();
  });
});

describe("Turn write", () => {
  test("Raised", () => {
    expect(turnWrite(100, launch())).toBe(100);
  });
  test("Limit already above the floor", () => {
    expect(turnWrite(100, launch({ maxTurns: 120 }))).toBeUndefined();
  });
  test("Limit equal to the floor", () => {
    expect(turnWrite(40, launch({ maxTurns: 40 }))).toBeUndefined();
  });
  test("No floor", () => {
    expect(turnWrite(undefined, launch())).toBeUndefined();
  });
  test("turnWrite raises from the minimum", () => {
    expect(turnWrite(40, launch({ maxTurns: 2 }))).toBe(40);
  });
  test("unlimited and locked launches write nothing", () => {
    expect(turnWrite(100, launch({ maxTurns: undefined }))).toBeUndefined();
    expect(turnWrite(100, launch({ turnsLocked: true }))).toBeUndefined();
  });
});
