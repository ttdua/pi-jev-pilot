import type { TierName } from "../launch.ts";
import { difficultyScore } from "./score.ts";
import type { WorkerAnswers } from "./answers.ts";

export type DecisionFields = {
  score?: number;
  rubric?: number;
  expertOffered?: boolean;
};

/**
 * The ledger fields that describe how a launch was decided: the rubric and whether
 * `expert` was offered whenever the tier question was asked, and the difficulty score
 * when the answers were read and a usable `tier` answer exists.
 */
export function decisionFields(input: {
  answers: WorkerAnswers | undefined;
  offered: readonly TierName[];
  tierQuestion: boolean;
  rubric: number;
}): DecisionFields {
  const fields: DecisionFields = {};
  if (input.tierQuestion) {
    fields.rubric = input.rubric;
    fields.expertOffered = input.offered.includes("expert");
  }
  if (input.answers?.kind === "read") {
    const score = difficultyScore(input.answers.answers);
    if (score !== undefined) fields.score = score;
  }
  return fields;
}
