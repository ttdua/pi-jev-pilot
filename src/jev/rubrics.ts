// Wording copied verbatim from docs/jev-questions.md. A change here needs a replay.
import type { TierName } from "../policy/launch.ts";

export type WireQuestion = {
  type: "choice" | "noul";
  instructions: string;
  criteria: Record<string, string>;
};

export const TIER_INSTRUCTION =
  "Which is the cheapest tier that can complete this coding task well?";

export const STANDARD_TIER_CRITERIA: Record<TierName, string> = {
  fast: "Fast and low cost, for bounded work with nothing to decide. Choose when the task itself says exactly what to do and a mistake is cheap to spot: searching or reading and reporting what is there, running commands and reporting the result, mechanical edits such as a rename, a typo, a config value, applying changes already written out in the brief, or a small change to one file that a named check confirms.",
  balanced:
    "The default for ordinary engineering. Choose when some working out is needed inside a clear spec: a feature or fix across a few files with a test, build or type check that shows it works, a bug whose cause is known, writing tests for existing code, a scoped refactor, reviewing a small or medium diff, or summarizing and explaining code.",
  deep: "For careful judgment or long work. Choose when the spec is open or nothing can check the result, the cause of a bug is unknown, the change spans many components or needs design decisions, or it touches security, data migrations, concurrency, production or money. A large cross-cutting review belongs here too.",
  expert:
    "Rare. Choose only for exceptionally difficult architectural or advisory reasoning that resolves a specific unresolved technical decision with tightly interacting constraints or conflicting evidence, where the expected result is a reusable diagnosis, decision or plan. Ordinary design, review, implementation, long tasks and security or production labels are not expert work; an agent's title grants no eligibility.",
};

export const WORKER_EFFORT_QUESTION: WireQuestion = {
  type: "choice",
  instructions:
    "How much step-by-step reasoning does a subagent need to carry out this brief? A brief that already names the files, the steps and the tests has done the design: carrying it out is execution. Rate higher only when the brief itself asks for design, an unknown cause, or reasoning that is not already written out. Rate the work, not how important the topic sounds: reviewing a small diff is medium, even for security.",
  criteria: {
    low: "Answered from what is already known, or mechanical work with nothing to work out: a lookup, a single command, a rename or find-and-replace (even across many files), a search that lists what it finds, formatting, a one-line change.",
    medium:
      "An ordinary, well-specified change to one or a few files, or a direct question about code already in view.",
    high: "A change across several files that needs working out, a bug whose cause is described but has to be traced, writing tests, or reviewing a diff with care.",
    xhigh:
      "Design across several components, a bug whose cause is unknown, a refactor with many dependents, or careful reasoning about concurrency, performance or failure modes.",
    max: "Novel architecture, a security or data-integrity question, a failure that resisted earlier attempts, or work where a subtle mistake is costly and hard to undo.",
  },
};

export const RISKY_QUESTION: WireQuestion = {
  type: "noul",
  instructions:
    "Carrying out this task would itself change production, move real money, or alter data that cannot be restored. Writing or testing code that deals with such things, without running it against the real system, does not count.",
  criteria: {
    true: "Doing the task runs something against a real system with lasting effect: deploying or releasing, changing production data or configuration, moving money, deleting or overwriting data with no backup, or rewriting shared history (force-push).",
    false:
      "Reading, explaining, planning, or writing and testing code locally, even code that deals with production, payments or data, without running it against the real system.",
  },
};

export const EXPERT_NEEDED_QUESTION: WireQuestion = {
  type: "noul",
  instructions:
    "Does this task require exceptional architectural or advisory reasoning beyond the normal deep tier to resolve a specific unresolved technical decision involving tightly interacting constraints or conflicting evidence? Judge the work actually requested and the supplied evidence, not the agent's title, task length, or topic importance.",
  criteria: {
    true: "A concrete, consequential technical decision remains genuinely unresolved despite adequate constraints and evidence, and an ordinary deep-tier approach would materially fail to settle it: strongly coupled trade-offs, conflicting cross-subsystem evidence, or a blocker that resisted distinct, evidence-based investigations. A reusable decision, diagnosis or plan is the requested outcome.",
    false:
      "Routine architecture explanation or design using known patterns; ordinary review; implementing a settled plan; collecting evidence; formatting or saving Markdown; a long task; a security or production label; missing requirements; or lack of evidence. Being difficult, high effort or high risk is not enough.",
  },
};

export const MAIN_EFFORT_INSTRUCTION =
  'How much step-by-step reasoning does the work this request asks for need? Rate the work, not how important the topic sounds: a question or advice answered in words, even about architecture or security, is low or medium, and reviewing a small diff is medium. A short reply that approves, continues or picks an option ("go ahead", "fix all and continue", "1") takes the size of the work it approves, from the recent conversation.';

export const CORRECTS_QUESTION: WireQuestion = {
  type: "noul",
  instructions:
    "The user's latest message tells the assistant that its previous answer or work was wrong, broken, incomplete, or not what was asked, and asks for it to be fixed or redone.",
  criteria: {
    true: "The message reports a problem with what the assistant just did or said: it doesn't work, it's wrong, it missed something, it's not what was asked, try again.",
    false:
      "The message approves, continues, asks something new, or gives a new task; or there was no previous answer.",
  },
};

export function TOOL_QUESTION(name: string): WireQuestion {
  return {
    type: "noul",
    instructions: `Is \`tools.${name}\` in the state dangerous or clearly inappropriate for the agent in \`agent\` doing the work in \`task\`?`,
    criteria: {
      true: "The task does not need this tool and giving it could cause unwanted changes or side effects.",
      false: "The task could reasonably use this tool, or it is harmless for this task.",
    },
  };
}
