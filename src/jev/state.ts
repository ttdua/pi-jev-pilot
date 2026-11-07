// State sent to Jev for main and worker requests. Pure: plain inputs, no Pi, host or store import.
import { cutCodePoints, cutLastCodePoints } from "../shared/text.ts";
import type { AgentFacts } from "../policy/launch.ts";

export type BranchItem = {
  role: "user" | "assistant" | "toolResult";
  text: string;
  tools: { name: string; failed?: true }[];
  isError?: boolean;
};

export type RequestSignals = {
  text: string;
  prompt_chars: number;
  files_mentioned: number;
  has_code_or_error: boolean;
  is_question: boolean;
};

export type MainState = {
  request: RequestSignals;
  conversation: {
    recent: {
      role: "user" | "assistant";
      text: string;
      tools: { name: string; failed?: true }[];
    }[];
    recent_tools: {
      edits: number;
      commands: number;
      reads: number;
      subagents: number;
      failed: number;
    };
    turn_index: number;
    last_decision?: { effort?: string; strategy?: string };
    context_used_percent?: number;
  };
  workspace: { platforms: string[]; git?: GitCounts; languages?: string[] };
  capabilities?: {
    tools: { name: string; summary: string }[];
    subagents: { name: string; description: string; tools: string[] | null }[];
  };
};

export type GitCounts = { changed_files: number; diff_lines: number };

/** Parses `git diff --shortstat` output. Unparseable output gives undefined. */
export function parseShortstat(out: string): GitCounts | undefined {
  const trimmed = out.trim();
  if (trimmed === "") return { changed_files: 0, diff_lines: 0 };
  const m = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/.exec(
    trimmed,
  );
  if (m === null) return undefined;
  return { changed_files: Number(m[1]), diff_lines: Number(m[2] ?? 0) + Number(m[3] ?? 0) };
}

export const RICH_GROUPS = [
  "last_decision",
  "context_used_percent",
  "git",
  "languages",
  "capabilities",
] as const;

export type RichGroup = (typeof RICH_GROUPS)[number];

export type RichInputs = {
  lastDecision?: { effort?: string; strategy?: string };
  contextPercent?: number | null;
  git?: GitCounts;
  languages?: string[];
  capabilities?: {
    tools: { name: string; description: string }[];
    agents: { name: string; description: string; tools: string[] | null }[];
  };
};

/** Groups shipped in the main state; pass 2 of the replay decides what joins this list. */
export const SHIPPED_MAIN_GROUPS: readonly RichGroup[] = [];

/** Keeps only the inputs whose group is listed. */
export function pickRich(all: RichInputs, groups: readonly RichGroup[]): RichInputs {
  const out: RichInputs = {};
  for (const group of groups) {
    switch (group) {
      case "last_decision":
        if (all.lastDecision !== undefined) out.lastDecision = all.lastDecision;
        break;
      case "context_used_percent":
        if (all.contextPercent !== undefined) out.contextPercent = all.contextPercent;
        break;
      case "git":
        if (all.git !== undefined) out.git = all.git;
        break;
      case "languages":
        if (all.languages !== undefined) out.languages = all.languages;
        break;
      case "capabilities":
        if (all.capabilities !== undefined) out.capabilities = all.capabilities;
        break;
    }
  }
  return out;
}

const TOTAL_BUDGET = 2000;
const MAX_MESSAGES = 4;
const NEWEST_ASSISTANT_CAP = 1100; // 55% of the budget
const MIN_OTHER = 200;
const END_SHARE = 0.72;
const ELISION = " … ";
const TOOL_WINDOW = 10;

const FILE_EXTENSIONS = new Set(
  (
    "ts tsx js jsx mjs cjs json md py go rs java kt rb php c h cpp cs swift sh yml yaml toml sql " +
    "css html vue svelte txt lock"
  ).split(" "),
);

const QUESTION_WORDS = new Set(
  "what why how when where which who can could does do did is are should would will".split(" "),
);

const ERROR_PATTERN =
  /```|Traceback|Exception|\berror\b|\bfailed\b|stack trace|\bat\s+[^\s:]+:\d+/i;

// Tokens are split by hand so a long prompt costs linear time (no regex scan per position).
const TOKEN_SPLIT = /[\s"'`()[\]{}<>,;:|]+/;

function stripTrailingPunct(raw: string): string {
  let end = raw.length;
  while (end > 0) {
    const c = raw.charCodeAt(end - 1);
    if (c !== 46 && c !== 63 && c !== 33) break; // . ? !
    end--;
  }
  return end === raw.length ? raw : raw.slice(0, end);
}

function extensionOf(name: string): string | undefined {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : undefined;
}

function mentionedFile(raw: string): string | undefined {
  const token = stripTrailingPunct(raw);
  if (token === "") return undefined;
  const slash = token.lastIndexOf("/");
  if (slash >= 0) {
    const name = token.slice(slash + 1);
    return name !== "" && extensionOf(name) !== undefined && /^[\w.@~-]+$/.test(name)
      ? token
      : undefined;
  }
  const ext = extensionOf(token);
  return ext !== undefined && FILE_EXTENSIONS.has(ext) ? token : undefined;
}

export function requestSignals(prompt: string): RequestSignals {
  const trimmed = prompt.trim();
  const files = new Set<string>();
  for (const raw of trimmed.split(TOKEN_SPLIT)) {
    const file = mentionedFile(raw);
    if (file !== undefined) files.add(file);
  }
  const firstWord = /^[A-Za-z]+/.exec(trimmed)?.[0]?.toLowerCase();
  return {
    text: prompt,
    prompt_chars: trimmed.length,
    files_mentioned: files.size,
    has_code_or_error: ERROR_PATTERN.test(trimmed),
    is_question:
      trimmed.endsWith("?") || (firstWord !== undefined && QUESTION_WORDS.has(firstWord)),
  };
}

/** Keeps the start and the end of `text` within `cap`, the marker included. */
function elide(text: string, cap: number): string {
  if (text.length <= cap) return text;
  if (cap <= ELISION.length) return text.slice(text.length - cap);
  const room = cap - ELISION.length;
  const end = Math.round(room * END_SHARE);
  return text.slice(0, room - end) + ELISION + (end > 0 ? text.slice(text.length - end) : "");
}

type Recent = MainState["conversation"]["recent"];

export function recentMessages(items: BranchItem[]): Recent {
  const messages = items.filter((i) => i.role !== "toolResult");
  // The newest assistant message only counts when it is among the last MAX_MESSAGES.
  let assistantAt = -1;
  for (let i = messages.length - 1; i >= Math.max(0, messages.length - MAX_MESSAGES); i--) {
    if (messages[i]!.role === "assistant") {
      assistantAt = i;
      break;
    }
  }
  const reserved =
    assistantAt >= 0 ? Math.min(messages[assistantAt]!.text.length, NEWEST_ASSISTANT_CAP) : 0;
  const out: Recent = [];
  let remaining = TOTAL_BUDGET;
  for (let i = messages.length - 1; i >= 0 && out.length < MAX_MESSAGES; i--) {
    const m = messages[i]!;
    let text: string;
    if (i === assistantAt) {
      text = elide(m.text, NEWEST_ASSISTANT_CAP);
    } else {
      const available = remaining - (i > assistantAt ? reserved : 0);
      if (available < Math.min(m.text.length, MIN_OTHER)) {
        if (i > assistantAt) continue; // newer than the assistant: skip, keep its share
        break; // older: the oldest are dropped first
      }
      text = elide(m.text, available);
    }
    remaining -= text.length;
    out.push({
      role: m.role as "user" | "assistant",
      text,
      tools: m.tools.map((t) =>
        t.failed ? { name: t.name, failed: true as const } : { name: t.name },
      ),
    });
  }
  return out.reverse();
}

const EDIT_TOOLS = new Set(["edit", "write"]);
const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);

export function recentTools(items: BranchItem[]): MainState["conversation"]["recent_tools"] {
  const counts = { edits: 0, commands: 0, reads: 0, subagents: 0, failed: 0 };
  for (const item of items.slice(-TOOL_WINDOW)) {
    if (item.role === "toolResult") {
      if (item.isError === true) counts.failed++;
      continue;
    }
    if (item.role !== "assistant") continue;
    for (const { name } of item.tools) {
      if (EDIT_TOOLS.has(name)) counts.edits++;
      else if (name === "bash") counts.commands++;
      else if (READ_TOOLS.has(name) || name.startsWith("web_")) counts.reads++;
      else if (name === "subagent") counts.subagents++;
    }
  }
  return counts;
}

export function turnIndex(items: BranchItem[]): number {
  return items.filter((i) => i.role === "user").length;
}

const MAX_CAPABILITY_TOOLS = 40;
const MAX_CAPABILITY_AGENTS = 30;
const CAPABILITY_TEXT_MAX = 200;

const byName = (a: { name: string }, b: { name: string }): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/** Keeps the keys the turn decided; undefined when neither is present. */
function shapeLastDecision(
  decision: NonNullable<RichInputs["lastDecision"]>,
): MainState["conversation"]["last_decision"] {
  const out: { effort?: string; strategy?: string } = {};
  if (decision.effort !== undefined) out.effort = decision.effort;
  if (decision.strategy !== undefined) out.strategy = decision.strategy;
  return out.effort === undefined && out.strategy === undefined ? undefined : out;
}

/** Integer percent clamped to 0..100; undefined when missing or not finite. */
function shapeContextPercent(percent: number | null | undefined): number | undefined {
  if (typeof percent !== "number" || !Number.isFinite(percent)) return undefined;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

/** Text up to the first `.`, `!` or `?` followed by whitespace or the end, cut to 200 code points. */
function firstSentence(text: string): string {
  const m = /^[\s\S]*?[.!?](?=\s|$)/.exec(text);
  return cutCodePoints(m === null ? text : m[0], CAPABILITY_TEXT_MAX);
}

function shapeCapabilities(
  capabilities: NonNullable<RichInputs["capabilities"]>,
): NonNullable<MainState["capabilities"]> {
  return {
    tools: [...capabilities.tools]
      .sort(byName)
      .slice(0, MAX_CAPABILITY_TOOLS)
      .map((t) => ({ name: t.name, summary: firstSentence(t.description) })),
    subagents: [...capabilities.agents]
      .sort(byName)
      .slice(0, MAX_CAPABILITY_AGENTS)
      .map((a) => ({
        name: a.name,
        description: cutCodePoints(a.description, CAPABILITY_TEXT_MAX),
        tools: a.tools,
      })),
  };
}

/** Adds each rich input under its key, shaped, only when it has a value. */
function addRich(state: MainState, rich: RichInputs): void {
  if (rich.lastDecision !== undefined) {
    const decision = shapeLastDecision(rich.lastDecision);
    if (decision !== undefined) state.conversation.last_decision = decision;
  }
  const percent = shapeContextPercent(rich.contextPercent);
  if (percent !== undefined) state.conversation.context_used_percent = percent;
  if (rich.git !== undefined) state.workspace.git = rich.git;
  if (rich.languages !== undefined) state.workspace.languages = rich.languages;
  if (rich.capabilities !== undefined) state.capabilities = shapeCapabilities(rich.capabilities);
}

export function mainState(i: {
  prompt: string;
  items: BranchItem[];
  platforms: string[];
  rich?: RichInputs;
}): MainState {
  const state: MainState = {
    request: requestSignals(i.prompt),
    conversation: {
      recent: recentMessages(i.items),
      recent_tools: recentTools(i.items),
      turn_index: turnIndex(i.items),
    },
    workspace: { platforms: i.platforms },
  };
  if (i.rich !== undefined) addRich(state, i.rich);
  return state;
}

// Worker state.
export type WorkerStateInput = {
  brief: string;
  description?: string;
  agent: AgentFacts;
  runInBackground: boolean;
  parentRequest?: string;
};

export type WorkerState = {
  task: { brief: string; description: string };
  agent: {
    name: string;
    source: AgentFacts["source"];
    description: string;
    instructions_excerpt: string;
    declared_tools: string[] | null;
    max_turns: number | null;
    run_in_background: boolean;
  };
  parent_request?: string;
};

const BRIEF_MAX = 4000;
const PARENT_REQUEST_MAX = 500;

/** Builds the worker state sent to Jev. Model and thinking are never part of it. */
export function buildWorkerState(input: WorkerStateInput): WorkerState {
  const { agent } = input;
  const state: WorkerState = {
    task: {
      brief: cutCodePoints(input.brief, BRIEF_MAX),
      description: input.description ?? "",
    },
    agent: {
      name: agent.name,
      source: agent.source,
      description: agent.description,
      instructions_excerpt: agent.instructionsExcerpt,
      declared_tools: agent.declaredTools,
      max_turns: agent.maxTurns,
      run_in_background: input.runInBackground,
    },
  };
  if (typeof input.parentRequest === "string") {
    state.parent_request = cutCodePoints(input.parentRequest, PARENT_REQUEST_MAX);
  }
  return state;
}

// Tool assessment state.
export type ToolStateInput = {
  brief: string;
  description: string;
  agent: AgentFacts;
  tools: {
    name: string;
    description: string;
    source: string;
    parameters: Record<string, string>;
  }[];
};

export type ToolState = {
  task: { brief: string; description: string };
  agent: { name: string; source: AgentFacts["source"]; description: string };
  tools: Record<
    string,
    { description: string; source: string; parameters: Record<string, string> }
  >;
};

const TOOL_DESCRIPTION_MAX = 500;

/** Own enumerable property even for names such as `__proto__`. */
function setOwn<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/** Builds the tool assessment state sent to Jev. Keeps the end of the brief: forks put the task last. */
export function buildToolState(input: ToolStateInput): ToolState {
  const tools: ToolState["tools"] = {};
  for (const tool of input.tools) {
    const parameters: Record<string, string> = {};
    for (const [name, text] of Object.entries(tool.parameters)) {
      setOwn(parameters, name, cutCodePoints(text, TOOL_DESCRIPTION_MAX));
    }
    setOwn(tools, tool.name, {
      description: cutCodePoints(tool.description, TOOL_DESCRIPTION_MAX),
      source: tool.source,
      parameters,
    });
  }
  return {
    task: { brief: cutLastCodePoints(input.brief, BRIEF_MAX), description: input.description },
    agent: {
      name: input.agent.name,
      source: input.agent.source,
      description: input.agent.description,
    },
    tools,
  };
}
