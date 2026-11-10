import { describe, expect, test } from "bun:test";
import type { Answer } from "../../../src/policy/answers.ts";
import { difficultyScore } from "../../../src/policy/worker/score.ts";

function choice(pick: string, probabilities: Record<string, number>): Answer {
  return { type: "choice", choice: pick, probabilities };
}

describe("difficultyScore", () => {
  test("balanced with high effort", () => {
    const answers = {
      tier: choice("balanced", { balanced: 1 }),
      effort: choice("high", {}),
    };
    expect(difficultyScore(answers)).toBe(1.25);
  });

  test("mixed probabilities", () => {
    const answers = {
      tier: choice("balanced", { balanced: 0.6, deep: 0.4 }),
      effort: choice("high", {}),
    };
    expect(difficultyScore(answers)).toBe(1.65);
  });

  test("slot keys ignored", () => {
    const answers = {
      tier: choice("balanced", { "slot::reviewer": 0.5, balanced: 0.5 }),
      effort: choice("high", {}),
    };
    expect(difficultyScore(answers)).toBe(1.25);
  });

  test("effort unanswered counts as high", () => {
    expect(difficultyScore({ tier: choice("deep", { deep: 1 }) })).toBe(2.25);
  });

  test("rounded before use", () => {
    const answers = {
      tier: choice("deep", { balanced: 0.45, deep: 0.55 }),
      effort: choice("high", {}),
    };
    expect(difficultyScore(answers)).toBe(1.8);
  });

  test("only slot probability gives no score", () => {
    const answers = {
      tier: choice("balanced", { "slot::reviewer": 1, fast: 0, balanced: 0 }),
      effort: choice("high", {}),
    };
    expect(difficultyScore(answers)).toBeUndefined();
  });

  test("a miss gives no score", () => {
    expect(difficultyScore({})).toBeUndefined();
  });
});
