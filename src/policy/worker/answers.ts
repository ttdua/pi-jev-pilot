// Pure reading of worker outcomes. Imports nothing outside src/policy/.

import {
  readAnswers,
  type Answer,
  type MissKind,
  type QuestionSpec,
  type UnansweredReason,
} from "../answers.ts";

export type WorkerOutcome =
  | { kind: "ok"; body: unknown }
  | { kind: "miss"; miss: MissKind }
  | { kind: "cancelled" };

export type WorkerAnswers =
  | {
      kind: "read";
      answers: Record<string, Answer>;
      unanswered: Record<string, UnansweredReason>;
    }
  | { kind: "miss"; miss: MissKind }
  | { kind: "cancelled" };

export function readWorkerOutcome(
  outcome: WorkerOutcome,
  specs: Record<string, QuestionSpec>,
): WorkerAnswers {
  switch (outcome.kind) {
    case "cancelled":
      return { kind: "cancelled" };
    case "miss":
      return { kind: "miss", miss: outcome.miss };
    case "ok":
      return readAnswers(specs, outcome.body);
  }
}
