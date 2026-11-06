import { describe, expect, test } from "bun:test";

import {
  canAskEffort,
  clampLevel,
  decideEffort,
  supportedLevels,
  type ThinkingLevel,
} from "../../src/policy/effort.ts";

const OFF_HIGH: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];
const WITH_XHIGH: ThinkingLevel[] = ["off", "low", "medium", "high", "xhigh"];

describe("supportedLevels", () => {
  test("reasoning model without a map", () => {
    expect(supportedLevels({ reasoning: true })).toEqual(OFF_HIGH);
  });
  test("map enables xhigh and disables minimal", () => {
    expect(
      supportedLevels({ reasoning: true, thinkingLevelMap: { xhigh: "x", minimal: null } }),
    ).toEqual(WITH_XHIGH);
  });
  test("not a reasoning model", () => {
    expect(supportedLevels({ reasoning: false })).toEqual(["off"]);
  });
});

// Cases pinned from Pi 1.5.0 clampThinkingLevel (pi-ai models.js).
describe("clampLevel", () => {
  test("supported level is itself", () => {
    expect(clampLevel("medium", OFF_HIGH)).toBe("medium");
  });
  test("nearest below when nothing above", () => {
    expect(clampLevel("xhigh", OFF_HIGH)).toBe("high");
  });
  test("nearest above first", () => {
    expect(clampLevel("low", ["off", "medium", "high"])).toBe("medium");
  });
  test("max with only off", () => {
    expect(clampLevel("max", ["off"])).toBe("off");
  });
  test("minimal with off and low", () => {
    expect(clampLevel("minimal", ["off", "low"])).toBe("low");
  });
  test("empty supported gives off", () => {
    expect(clampLevel("high", [])).toBe("off");
  });
});

describe("decideEffort", () => {
  test("choice applies as is", () => {
    expect(decideEffort({ choice: "medium", risky: 0.2, supported: OFF_HIGH })).toEqual({
      requested: "medium",
      target: "medium",
    });
  });
  test("risk floor", () => {
    expect(decideEffort({ choice: "low", risky: 0.71, supported: OFF_HIGH }).requested).toBe(
      "high",
    );
  });
  test("risk floor boundary", () => {
    expect(decideEffort({ choice: "low", risky: 0.7, supported: OFF_HIGH }).requested).toBe("low");
  });
  test("risk floor does not lower", () => {
    expect(decideEffort({ choice: "xhigh", risky: 0.9, supported: WITH_XHIGH })).toEqual({
      requested: "xhigh",
      target: "xhigh",
    });
  });
  test("ceiling", () => {
    expect(decideEffort({ choice: "max", supported: WITH_XHIGH }).requested).toBe("xhigh");
  });
  test("clamp down", () => {
    expect(decideEffort({ choice: "xhigh", supported: OFF_HIGH }).target).toBe("high");
  });
  test("clamp up", () => {
    const supported = supportedLevels({ reasoning: true, thinkingLevelMap: { low: null } });
    expect(decideEffort({ choice: "low", supported }).target).toBe("medium");
  });
  test("risky unanswered", () => {
    expect(decideEffort({ choice: "low", risky: undefined, supported: OFF_HIGH }).requested).toBe(
      "low",
    );
  });
  test("confidence has no input", () => {
    // @ts-expect-error confidence is not part of the input
    const r = decideEffort({ choice: "high", confidence: 0.1, supported: OFF_HIGH });
    expect(r.requested).toBe("high");
  });
});

describe("canAskEffort", () => {
  test("needs two levels from low upward", () => {
    expect(canAskEffort(["off"])).toBe(false);
    expect(canAskEffort(["off", "low"])).toBe(false);
    expect(canAskEffort(["off", "low", "medium"])).toBe(true);
  });
});
