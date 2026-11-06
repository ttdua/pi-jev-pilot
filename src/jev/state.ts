// Minimal main state sent to Jev. Pure: plain inputs, no Pi, host or store import.

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
  };
  workspace: { platforms: string[] };
};

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
const TRAILING_PUNCT = /[.?!]+$/;

function extensionOf(name: string): string | undefined {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : undefined;
}

function mentionedFile(raw: string): string | undefined {
  const token = raw.replace(TRAILING_PUNCT, "");
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
  let assistantPending = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "assistant") {
      assistantPending = i;
      break;
    }
  }
  const out: Recent = [];
  let remaining = TOTAL_BUDGET;
  for (let i = messages.length - 1; i >= 0 && out.length < MAX_MESSAGES; i--) {
    const m = messages[i]!;
    const isNewestAssistant = i === assistantPending;
    let text: string;
    if (isNewestAssistant) {
      text = elide(m.text, NEWEST_ASSISTANT_CAP);
    } else {
      // Keep room for the newest assistant message if it is still ahead of us.
      const reserved =
        assistantPending >= 0 && i > assistantPending
          ? Math.min(messages[assistantPending]!.text.length, NEWEST_ASSISTANT_CAP)
          : 0;
      const available = remaining - reserved;
      if (available < Math.min(m.text.length, MIN_OTHER)) break;
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

export function mainState(i: {
  prompt: string;
  items: BranchItem[];
  platforms: string[];
}): MainState {
  return {
    request: requestSignals(i.prompt),
    conversation: {
      recent: recentMessages(i.items),
      recent_tools: recentTools(i.items),
      turn_index: turnIndex(i.items),
    },
    workspace: { platforms: i.platforms },
  };
}
