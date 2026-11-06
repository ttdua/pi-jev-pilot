// Main-request question set. Wording is copied verbatim from docs/jev-questions.md.
import { EFFORT_LEVELS } from "../policy/effort.ts";
import type { QuestionSpec } from "../policy/answers.ts";

export type WireQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string; criteria: { true: string; false: string } };

export type MainQuestions = {
  wire: Record<string, WireQuestion>;
  specs: Record<string, QuestionSpec>;
};

const EFFORT_INSTRUCTIONS =
  'How much step-by-step reasoning does the work this request asks for need? Rate the work, not how important the topic sounds: a question or advice answered in words, even about architecture or security, is low or medium, and reviewing a small diff is medium. A short reply that approves, continues or picks an option ("go ahead", "fix all and continue", "1") takes the size of the work it approves, from the recent conversation.';

const EFFORT_CRITERIA: Record<(typeof EFFORT_LEVELS)[number], string> = {
  low: "Answered from what is already known, or mechanical work with nothing to work out: a lookup, a single command, a rename or find-and-replace (even across many files), a search that lists what it finds, formatting, a one-line change.",
  medium:
    "An ordinary, well-specified change to one or a few files, or a direct question about code already in view.",
  high: "A change across several files that needs working out, a bug whose cause is described but has to be traced, writing tests, or reviewing a diff with care.",
  xhigh:
    "Design across several components, a bug whose cause is unknown, a refactor with many dependents, or careful reasoning about concurrency, performance or failure modes.",
  max: "Novel architecture, a security or data-integrity question, a failure that resisted earlier attempts, or work where a subtle mistake is costly and hard to undo.",
};

const RISKY: WireQuestion = {
  type: "noul",
  instructions:
    "Carrying out this task would itself change production, move real money, or alter data that cannot be restored. Writing or testing code that deals with such things, without running it against the real system, does not count.",
  criteria: {
    true: "Doing the task runs something against a real system with lasting effect: deploying or releasing, changing production data or configuration, moving money, deleting or overwriting data with no backup, or rewriting shared history (force-push).",
    false:
      "Reading, explaining, planning, or writing and testing code locally, even code that deals with production, payments or data, without running it against the real system.",
  },
};

const CORRECTS: WireQuestion = {
  type: "noul",
  instructions:
    "The user's latest message tells the assistant that its previous answer or work was wrong, broken, incomplete, or not what was asked, and asks for it to be fixed or redone.",
  criteria: {
    true: "The message reports a problem with what the assistant just did or said: it doesn't work, it's wrong, it missed something, it's not what was asked, try again.",
    false:
      "The message approves, continues, asks something new, or gives a new task; or there was no previous answer.",
  },
};

/** Questions for a main request; `effort` and `risky` only when `askEffort`. */
export function mainQuestions(o: { askEffort: boolean }): MainQuestions {
  const wire: Record<string, WireQuestion> = {};
  const specs: Record<string, QuestionSpec> = {};
  if (o.askEffort) {
    wire["effort"] = {
      type: "choice",
      instructions: EFFORT_INSTRUCTIONS,
      criteria: { ...EFFORT_CRITERIA },
    };
    specs["effort"] = { type: "choice", options: EFFORT_LEVELS };
    wire["risky"] = RISKY;
    specs["risky"] = { type: "noul" };
  }
  wire["corrects"] = CORRECTS;
  specs["corrects"] = { type: "noul" };
  return { wire, specs };
}
