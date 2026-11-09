import { describe, expect, test } from "bun:test";
import { decisionFields } from "../../../src/policy/worker/ledger-line.ts";
import type { Answer } from "../../../src/policy/answers.ts";
import type { WorkerAnswers } from "../../../src/policy/worker/answers.ts";

const tier = (pick: string): Answer => ({
  type: "choice",
  choice: pick,
  confidence: 0.9,
  probabilities: { fast: 0, balanced: 0, deep: 0, [pick]: 0.9 },
});
const read = (answers: Record<string, Answer>): WorkerAnswers => ({
  kind: "read",
  answers,
  unanswered: {},
});
const three = ["fast", "balanced", "deep"] as const;
const four = [...three, "expert"] as const;

describe("decisionFields", () => {
  test("asked and scored", () => {
    expect(
      decisionFields({
        answers: read({ tier: tier("balanced") }),
        offered: four,
        tierQuestion: true,
        rubric: 7,
      }),
    ).toEqual({ rubric: 7, expertOffered: true, score: 1.25 });
  });

  test("expert not offered", () => {
    expect(
      decisionFields({
        answers: read({ tier: tier("fast") }),
        offered: three,
        tierQuestion: true,
        rubric: 7,
      }),
    ).toMatchObject({ expertOffered: false });
  });

  test("miss keeps rubric and expertOffered, no score", () => {
    expect(
      decisionFields({
        answers: { kind: "miss", miss: "timeout" },
        offered: four,
        tierQuestion: true,
        rubric: 7,
      }),
    ).toEqual({ rubric: 7, expertOffered: true });
  });

  test("tier not answered, no score", () => {
    expect(
      decisionFields({ answers: read({}), offered: four, tierQuestion: true, rubric: 7 }),
    ).toEqual({
      rubric: 7,
      expertOffered: true,
    });
  });

  test("tier question not asked", () => {
    expect(
      decisionFields({
        answers: undefined,
        offered: four,
        tierQuestion: false,
        rubric: 7,
      }),
    ).toEqual({});
  });

  test("no answers", () => {
    expect(
      decisionFields({
        answers: undefined,
        offered: three,
        tierQuestion: true,
        rubric: 7,
      }),
    ).toEqual({
      rubric: 7,
      expertOffered: false,
    });
  });
});
