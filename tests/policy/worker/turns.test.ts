import { describe, expect, test } from "bun:test";

import type { Answer } from "../../../src/policy/answers.ts";
import type { EffectiveLaunch } from "../../../src/policy/launch.ts";
import { turnFloor, turnWrite } from "../../../src/policy/worker/turns.ts";

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

describe("Turn floor", () => {
  test("Long by majority", () => {
    expect(turnFloor(turns({ short: 0.1, medium: 0.2, long: 0.6, very_long: 0.1 }))).toBe(100);
  });
  test("Thin tail does not raise", () => {
    expect(
      turnFloor(turns({ short: 0.6, medium: 0.1, long: 0.1, very_long: 0.2 })),
    ).toBeUndefined();
  });
  test("Cumulative at the bar", () => {
    expect(turnFloor(turns({ short: 0.5, medium: 0.2, long: 0.2, very_long: 0.1 }))).toBe(40);
  });
  test("Choice is not enough", () => {
    const a = turns({ short: 0.35, medium: 0.25, long: 0.4, very_long: 0 }, "long");
    expect(turnFloor(a)).toBe(40);
  });
  test("Very long", () => {
    expect(turnFloor(turns({ long: 0.3, very_long: 0.7 }))).toBe(200);
  });
  test("Probabilities not normalised", () => {
    expect(turnFloor(turns({ short: 0.4, medium: 0.2, long: 0.2 }))).toBeUndefined();
  });
  test("Unanswered", () => {
    expect(turnFloor(undefined)).toBeUndefined();
    expect(turnFloor({ type: "noul", noul: 0.9 })).toBeUndefined();
  });
  test("turnFloor ignores unknown keys", () => {
    expect(turnFloor(turns({ short: 0.2, long: 0.6, huge: 0.9 }))).toBe(100);
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
