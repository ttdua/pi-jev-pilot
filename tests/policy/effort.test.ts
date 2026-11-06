import { describe, expect, test } from "bun:test";

import type { ChoiceAnswer } from "../../src/policy/answers.ts";
import type { EffortLevel as LedgerEffortLevel } from "../../src/store/ledger-schema.ts";
import { EFFORT_LADDER, type EffortLevel, workerEffort } from "../../src/policy/effort.ts";

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
