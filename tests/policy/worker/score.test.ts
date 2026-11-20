import { describe, expect, test } from "bun:test";
import type { Answer } from "../../../src/policy/answers.ts";
import { difficultyScore } from "../../../src/policy/worker/score.ts";

function choice(pick: string, probabilities: Record<string, number>): Answer {
  return { type: "choice", choice: pick, probabilities };
}

describe("difficultyScore", () => {
  test("Balanced with high effort", () => {
    const answers = {
      tier: choice("broad", { broad: 1 }),
      effort: choice("high", {}),
    };
    expect(difficultyScore(answers)).toBe(1);
  });

  test("Mixed probabilities", () => {
    const answers = {
      tier: choice("broad", { broad: 0.6, deep: 0.4 }),
      effort: choice("high", {}),
    };
    expect(difficultyScore(answers)).toBe(1.4);
  });

  test("Slot keys ignored", () => {
    const answers = {
      tier: choice("broad", { "slot::reviewer": 0.5, broad: 0.5 }),
      effort: choice("high", {}),
    };
    expect(difficultyScore(answers)).toBe(1);
  });

  test("Effort unanswered", () => {
    const tier = choice("deep", { deep: 1 });
    expect(difficultyScore({ tier, effort: choice("low", {}) })).toBe(2);
    expect(difficultyScore({ tier, effort: choice("max", {}) })).toBe(2);
    expect(difficultyScore({ tier })).toBe(2);
  });

  test("Rounded before use", () => {
    const answers = {
      tier: choice("deep", { basic: 0.3333, broad: 0.3333, deep: 0.3334 }),
    };
    expect(difficultyScore(answers)).toBe(1);
  });

  test("Only slot probability", () => {
    const answers = {
      tier: choice("broad", { "slot::reviewer": 1, basic: 0, broad: 0 }),
      effort: choice("high", {}),
    };
    expect(difficultyScore(answers)).toBeUndefined();
  });

  test("Jev failure gives no score", () => {
    expect(difficultyScore({})).toBeUndefined();
  });
});
