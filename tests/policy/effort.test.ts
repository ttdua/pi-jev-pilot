import { describe, expect, test } from "bun:test";

import type { ChoiceAnswer } from "../../src/policy/answers.ts";
import type { EffortLevel as LedgerEffortLevel } from "../../src/store/ledger-schema.ts";
import {
  canAskEffort,
  clampLevel,
  decideEffort,
  EFFORT_LADDER,
  type EffortLevel,
  supportedLevels,
  type ThinkingLevel,
  workerEffort,
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

function choice(value: string): ChoiceAnswer {
  return { type: "choice", choice: value, probabilities: { [value]: 1 } };
}

describe("Worker effort", () => {
  test("Ceiling", () => {
    expect(workerEffort({ effort: choice("max"), tier: "deep", movedByFallback: false })).toBe(
      "xhigh",
    );
  });

  test("Risk raises effort", () => {
    expect(workerEffort({ effort: choice("low"), risky: 0.8, movedByFallback: false })).toBe(
      "high",
    );
  });

  test("Risk boundary for effort", () => {
    expect(workerEffort({ effort: choice("low"), risky: 0.7, movedByFallback: false })).toBe("low");
  });

  test("Fast cap", () => {
    expect(workerEffort({ effort: choice("high"), tier: "fast", movedByFallback: false })).toBe(
      "medium",
    );
  });

  test("Risk floor then fast cap", () => {
    expect(
      workerEffort({ effort: choice("low"), risky: 0.8, tier: "fast", movedByFallback: false }),
    ).toBe("medium");
  });

  test("No tier decided", () => {
    expect(workerEffort({ effort: choice("high"), movedByFallback: false })).toBe("high");
  });

  test("a choice outside the ladder counts as no answer", () => {
    expect(workerEffort({ effort: choice("bogus"), risky: 0.9, movedByFallback: false })).toBe(
      undefined,
    );
  });

  test("EffortLevel matches the ledger schema EffortLevel", () => {
    // Type-level check: the ledger exports only the type, so assert mutual assignability.
    const toLedger: LedgerEffortLevel[] = EFFORT_LADDER.map((level: EffortLevel) => level);
    const fromLedger: EffortLevel[] = toLedger;
    expect(fromLedger).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });
});

describe("Effort after fallback", () => {
  test("Fallback lifts effort on fast", () => {
    expect(workerEffort({ effort: choice("low"), tier: "fast", movedByFallback: true })).toBe(
      "xhigh",
    );
  });

  test("Fallback without an effort answer", () => {
    expect(workerEffort({ movedByFallback: true })).toBe("xhigh");
  });

  test("No effort answer", () => {
    expect(workerEffort({ movedByFallback: false })).toBe(undefined);
  });
});

describe("Supported thinking levels", () => {
  test("Non-reasoning model", () => {
    expect(supportedLevels({ reasoning: false })).toEqual(["off"]);
  });
  test("Reasoning model without map", () => {
    expect(supportedLevels({ reasoning: true })).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
    ]);
  });
});

describe("Thinking clamp", () => {
  test("Supported level kept", () => {
    expect(clampLevel("high", supportedLevels({ reasoning: true }))).toBe("high");
  });
  test("xhigh clamped down", () => {
    expect(clampLevel("xhigh", supportedLevels({ reasoning: true }))).toBe("high");
  });
  test("xhigh kept when mapped", () => {
    expect(
      clampLevel("xhigh", supportedLevels({ reasoning: true, thinkingLevelMap: { xhigh: "x" } })),
    ).toBe("xhigh");
  });
  test("Unsupported level moves up", () => {
    expect(
      clampLevel("low", supportedLevels({ reasoning: true, thinkingLevelMap: { low: null } })),
    ).toBe("medium");
  });
  test("Non-reasoning model gives off", () => {
    expect(clampLevel("high", supportedLevels({ reasoning: false }))).toBe("off");
  });
});
