// Wording copied verbatim from docs/jev-questions.md. A change here needs a replay.
import { EFFORT_OPTION_ORDER, type EffortLevel } from "../policy/effort.ts";
import type { TierName } from "../policy/launch.ts";
import type { GateKey } from "../policy/main/index.ts";

export type WireQuestion = {
  type: "choice" | "noul";
  instructions: string;
  criteria: Record<string, string>;
};

export const TIER_INSTRUCTION =
  "Which is the least knowledgeable model tier that has the knowledge this task needs?";

/** Wording version; bump with any change to the worker or main tier text. */
export const RUBRIC_VERSION = 3;

/** The one worker tier rubric, in every mode. */
export const WORKER_TIER_CRITERIA: Readonly<Record<TierName, string>> = {
  basic:
    "Common, well-documented knowledge. The syntax, standard library and tools most programmers know or can look up in the official docs. Choose when the task needs nothing beyond that. Length, number of steps, care and risk are effort, not tier.",
  broad:
    "Broad engineering knowledge across stacks and libraries: how common frameworks, databases, build tools and test runners behave, and the usual patterns for them. Choose when the task needs that knowledge, even across several of them. Length, number of steps, care and risk are effort, not tier.",
  deep: "Specialist depth in one domain: the internals, edge cases and conventions of a particular system, runtime or protocol, which a generalist would get wrong without study. Choose when the task needs that depth. Length, number of steps, care and risk are effort, not tier.",
  frontier:
    "Rare, frontier-level expertise. Knowledge that few practitioners hold and that weaker models are likely to get wrong, such as subtle interactions between systems or unusual failure modes. Choose only when the task needs that knowledge. Length, number of steps, care and risk are effort, not tier.",
};

/** The main request's transitional `tier` question (rubric version 2 text, removed by Task 4). */
export const MAIN_TIER_INSTRUCTION =
  "Which is the cheapest tier that can complete this coding task well?";

export const MAIN_TIER_CRITERIA: Readonly<Record<"basic" | "broad" | "deep", string>> = {
  basic:
    "Fast and low cost, for bounded work with nothing to decide. Choose when the task itself says exactly what to do and a mistake is cheap to spot: searching or reading and reporting what is there, running commands and reporting the result, mechanical edits such as a rename, a typo, a config value, applying changes already written out in the brief, or a small change to one file that a named check confirms.",
  broad:
    "The default for ordinary engineering. Choose when some working out is needed inside a clear spec: a feature or fix across a few files with a test, build or type check that shows it works, a bug whose cause is known, writing tests for existing code, a scoped refactor, reviewing a small or medium diff, or summarizing and explaining code.",
  deep: "For careful judgment or long work. Choose when the spec is open or nothing can check the result, the cause of a bug is unknown, the change spans many components or needs design decisions, or it touches security, data migrations, concurrency, production or money. A large cross-cutting review belongs here too.",
};

/** Puts the effort criteria in `EFFORT_OPTION_ORDER` key order, the order Jev sees. */
function orderedEffortCriteria(byLevel: Record<EffortLevel, string>): Record<string, string> {
  return Object.fromEntries(EFFORT_OPTION_ORDER.map((level) => [level, byLevel[level]]));
}

export const WORKER_EFFORT_QUESTION: WireQuestion = {
  type: "choice",
  instructions:
    "How much work and care does a subagent need to put into carrying out this brief? Count the steps, the tracing, the tool calls and the verification. A brief that already names the files, the steps and the tests has done the design: carrying it out is execution. Rate higher only when the brief itself asks for design, tracing an unknown cause, or reasoning that is not already written out. Rare knowledge is a tier matter, not an effort signal. Rate the work, not how important the topic sounds: reviewing a small diff is medium, even for security.",
  criteria: orderedEffortCriteria({
    low: "Little or no work: a lookup, a single command, a rename or find-and-replace (even across many files), a search that lists what it finds, formatting, or a one-line change. Nothing to trace; the output is the check.",
    medium:
      "A few steps: an ordinary, well-specified change to one or a few files with a check to run, or a direct question about code already in view.",
    high: "Several steps with tracing: a change across several files that needs working out, a bug whose cause is described but has to be traced, writing tests, or reviewing a diff with care.",
    xhigh:
      "Long reasoning and verification: design across several components, a bug whose cause is unknown, a refactor with many dependents to verify, or careful reasoning about concurrency, performance or failure modes.",
    max: "Heavy care: a failure that resisted earlier attempts, or work where a subtle mistake is costly and hard to undo, such as a security or data-integrity question that must be verified step by step.",
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

export const MAIN_EFFORT_INSTRUCTION =
  "How much step-by-step reasoning does the work this request asks for need? Rate the amount of work and care, not how important the topic sounds: a question or advice answered in words, even about architecture or security, is low or medium, and reviewing a small diff is medium. Rare knowledge is a tier matter, not an effort signal. A reply to the assistant's own question, proposal, review or approval request, such as approving it, picking an option, answering it or asking to continue, whatever its length and however it is formatted, takes the size of the work it approves or starts, judged from the recent conversation rather than from the reply's own text.";

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
  instructions: MAIN_TIER_INSTRUCTION,
  criteria: {
    ...MAIN_TIER_CRITERIA,
  },
};

/** Between a slot's model name and its `when` text; also in docs/jev-questions.md. */
export const SLOT_CRITERION_INFIX = " (a custom model). ";
