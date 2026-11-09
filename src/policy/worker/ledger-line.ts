import { RUBRIC_VERSION } from "../jev/rubrics.ts";
import type { TierName } from "../policy/launch.ts";
import { difficultyScore } from "../policy/score.ts";
import type { WorkerAnswers } from "../policy/worker.ts";

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
}): DecisionFields {
  const fields: DecisionFields = {};
  if (input.tierQuestion) {
    fields.rubric = RUBRIC_VERSION;
    fields.expertOffered = input.offered.includes("expert");
  }
  if (input.answers?.kind === "read") {
    const score = difficultyScore(input.answers.answers);
    if (score !== undefined) fields.score = score;
  }
  return fields;
}
