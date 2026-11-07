// Wording copied verbatim from docs/jev-questions.md. A change here needs a replay.
import { EFFORT_OPTION_ORDER, type EffortLevel } from "../policy/effort.ts";
import type { TierName } from "../policy/launch.ts";
import type { ModeName } from "../policy/modes.ts";
import type { GateKey } from "../policy/skill.ts";

export type WireQuestion = {
  type: "choice" | "noul";
  instructions: string;
  criteria: Record<string, string>;
};

export const TIER_INSTRUCTION =
  "Which is the cheapest tier that can complete this coding task well?";

const STANDARD_TIER_CRITERIA: Record<TierName, string> = {
  fast: "Fast and low cost, for bounded work with nothing to decide. Choose when the task itself says exactly what to do and a mistake is cheap to spot: searching or reading and reporting what is there, running commands and reporting the result, mechanical edits such as a rename, a typo, a config value, applying changes already written out in the brief, or a small change to one file that a named check confirms.",
  balanced:
    "The default for ordinary engineering. Choose when some working out is needed inside a clear spec: a feature or fix across a few files with a test, build or type check that shows it works, a bug whose cause is known, writing tests for existing code, a scoped refactor, reviewing a small or medium diff, or summarizing and explaining code.",
  deep: "For careful judgment or long work. Choose when the spec is open or nothing can check the result, the cause of a bug is unknown, the change spans many components or needs design decisions, or it touches security, data migrations, concurrency, production or money. A large cross-cutting review belongs here too.",
  expert:
    "Rare. Choose only for exceptionally difficult architectural or advisory reasoning that resolves a specific unresolved technical decision with tightly interacting constraints or conflicting evidence, where the expected result is a reusable diagnosis, decision or plan. Ordinary design, review, implementation, long tasks and security or production labels are not expert work; an agent's title grants no eligibility.",
};

const BUDGET_TIER_CRITERIA: Record<TierName, string> = {
  fast: "Fast and low cost, and capable on well-defined coding. Choose for any task whose brief already names the files, the behavior and a check, so that carrying it out takes no design decision: searching, reading and reporting; running commands; mechanical or repetitive edits; implementing a change that is fully specified step by step; writing tests whose cases are listed.",
  balanced:
    "For ordinary engineering when working out is still needed: the brief states the goal and a check but leaves the approach to the worker, such as a feature to a written spec, a bug whose cause is known but whose fix must be found, tests that must be designed, or a scoped refactor.",
  deep: "Only when cheaper tiers would likely fail: the spec is open or nothing can check the result, the cause of a bug is unknown, or the change needs design decisions across many components, or touches security, data migrations, concurrency, production or money.",
  expert: STANDARD_TIER_CRITERIA.expert,
};

const PREMIUM_TIER_CRITERIA: Record<TierName, string> = {
  fast: "Only for trivial work where nothing can go wrong: reading or searching and reporting what is there, running a command and reporting the result, a typo or a rename.",
  balanced:
    "For small changes that are fully specified with a check: the brief names the files and the exact behavior, and no design decision remains.",
  deep: "The default for real engineering: any feature, fix or refactor that needs working out, touches more than a few files, leaves choices open, or where a subtle bug would be costly.",
  expert:
    "The strongest and most expensive tier, for the hardest work: architecture or design across many components, long multi-step builds, a bug that resisted earlier attempts, or reasoning about concurrency or data integrity where a wrong call is expensive to undo.",
};

/** Tier criteria per mode; `standard` is also used for the main request's `tier` question. */
export const TIER_CRITERIA: Record<ModeName, Record<TierName, string>> = {
  budget: BUDGET_TIER_CRITERIA,
  standard: STANDARD_TIER_CRITERIA,
  premium: PREMIUM_TIER_CRITERIA,
};

/** Puts the effort criteria in `EFFORT_OPTION_ORDER` key order, the order Jev sees. */
function orderedEffortCriteria(byLevel: Record<EffortLevel, string>): Record<string, string> {
  return Object.fromEntries(EFFORT_OPTION_ORDER.map((level) => [level, byLevel[level]]));
}

export const WORKER_EFFORT_QUESTION: WireQuestion = {
  type: "choice",
  instructions:
    "How much step-by-step reasoning does a subagent need to carry out this brief? A brief that already names the files, the steps and the tests has done the design: carrying it out is execution. Rate higher only when the brief itself asks for design, an unknown cause, or reasoning that is not already written out. Rate the work, not how important the topic sounds: reviewing a small diff is medium, even for security.",
  criteria: orderedEffortCriteria({
    low: "Answered from what is already known, or mechanical work with nothing to work out: a lookup, a single command, a rename or find-and-replace (even across many files), a search that lists what it finds, formatting, a one-line change.",
    medium:
      "An ordinary, well-specified change to one or a few files, or a direct question about code already in view.",
    high: "A change across several files that needs working out, a bug whose cause is described but has to be traced, writing tests, or reviewing a diff with care.",
    xhigh:
      "Design across several components, a bug whose cause is unknown, a refactor with many dependents, or careful reasoning about concurrency, performance or failure modes.",
    max: "Novel architecture, a security or data-integrity question, a failure that resisted earlier attempts, or work where a subtle mistake is costly and hard to undo.",
  }),
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

const STANDARD_EXPERT_NEEDED: WireQuestion = {
  type: "noul",
  instructions:
    "Does this task require exceptional architectural or advisory reasoning beyond the normal deep tier to resolve a specific unresolved technical decision involving tightly interacting constraints or conflicting evidence? Judge the work actually requested and the supplied evidence, not the agent's title, task length, or topic importance.",
  criteria: {
    true: "A concrete, consequential technical decision remains genuinely unresolved despite adequate constraints and evidence, and an ordinary deep-tier approach would materially fail to settle it: strongly coupled trade-offs, conflicting cross-subsystem evidence, or a blocker that resisted distinct, evidence-based investigations. A reusable decision, diagnosis or plan is the requested outcome.",
    false:
      "Routine architecture explanation or design using known patterns; ordinary review; implementing a settled plan; collecting evidence; formatting or saving Markdown; a long task; a security or production label; missing requirements; or lack of evidence. Being difficult, high effort or high risk is not enough.",
  },
};

const PREMIUM_EXPERT_NEEDED: WireQuestion = {
  type: "noul",
  instructions:
    "This task needs the strongest available reasoning rather than competent execution of a settled plan: architecture or design across many components, long multi-step work with tightly coupled parts, a bug that resisted earlier attempts, or concurrency or data-integrity reasoning where a wrong call is expensive to undo.",
  criteria: {
    true: "The worker must make hard, consequential decisions that are not already settled in the brief.",
    false:
      "The brief already settles the approach, or the work is ordinary engineering, review, a small change or a lookup.",
  },
};

/** `budget` and `standard` share one question. */
export const EXPERT_NEEDED_QUESTIONS: Record<ModeName, WireQuestion> = {
  budget: STANDARD_EXPERT_NEEDED,
  standard: STANDARD_EXPERT_NEEDED,
  premium: PREMIUM_EXPERT_NEEDED,
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

export type BareNoulQuestion = { type: "noul"; instructions: string };

export const WHICH_INSTRUCTION =
  "Which of these skills, if any, is the right one to load to help with the user's latest request? Match the kind of work the request asks for (such as debugging a failure, planning, reviewing, designing, writing a document), not only a product or technology it names. A skill for one product or platform (Vercel, Supabase, AWS, Firebase, Stripe…) fits only when the request, the conversation or the project (`workspace.platforms` in the state: what its files show it uses) shows that product is the one in use here; otherwise choose a general skill or none.";

export const NONE_CRITERION =
  "None of these skills fits: the request is ordinary work that no listed skill is specifically about.";

export const GATE_QUESTIONS: Record<GateKey, BareNoulQuestion> = {
  "gate::acts_on_user_system": {
    type: "noul",
    instructions:
      "Is the assistant being asked to act on the user's files, accounts, devices, or online services, rather than only to explain or advise?",
  },
  "gate::would_follow_documented_procedure": {
    type: "noul",
    instructions:
      "Would a careful expert answering this consult a specific documented procedure or set of commands, rather than answering from general understanding?",
  },
  "gate::prose_suffices": {
    type: "noul",
    instructions:
      "Could a knowledgeable generalist fully satisfy this request in prose, with no tools, no documentation, and no access to the user's files or accounts?",
  },
};

export const STRATEGY_QUESTION: WireQuestion = {
  type: "choice",
  instructions:
    "How should a coding assistant carry out the latest request, given the recent conversation? Prefer the simplest way that does it well.",
  criteria: {
    direct:
      "The main conversation does it itself: a question, a lookup, a command, or a change to one or a few files. One job with one clear finish line. The right answer for most requests, including most follow-ups.",
    delegate:
      "One subagent on a cheaper model does a broad but mechanical part first (searching or reading across many files, a codebase sweep, bulk renames) and the main conversation acts on its short report.",
    parallel:
      "Fan out, then join: several independent pieces with no shared files or state (separate modules, services or investigations), each done by its own subagent at the same time, then combined in one place.",
    graph:
      "Work one conversation would lose track of: parts that depend on each other in waves, or distinct specialties that hand off (build, then an independent review, then fixes), with results fanning in to be checked. Only for large builds; most work, even big work, is direct or parallel.",
  },
};

export const MAIN_TIER_QUESTION: WireQuestion = {
  type: "choice",
  instructions: TIER_INSTRUCTION,
  criteria: {
    fast: STANDARD_TIER_CRITERIA.fast,
    balanced: STANDARD_TIER_CRITERIA.balanced,
    deep: STANDARD_TIER_CRITERIA.deep,
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

/** Between a slot's model name and its `when` text; also in docs/jev-questions.md. */
export const SLOT_CRITERION_INFIX = " (a custom model). ";
