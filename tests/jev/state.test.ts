import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { readAgent } from "../../src/host/agents.ts";
import {
  buildToolState,
  buildWorkerState,
  mainState,
  parseShortstat,
  pickRich,
  SHIPPED_MAIN_GROUPS,
  type RichInputs,
  recentMessages,
  recentTools,
  requestSignals,
  turnIndex,
  type BranchItem,
} from "../../src/jev/state.ts";
import type { AgentFacts } from "../../src/policy/launch.ts";
import { tempDir } from "../helpers.ts";

const user = (text: string): BranchItem => ({ role: "user", text, tools: [] });
const asst = (text: string, tools: BranchItem["tools"] = []): BranchItem => ({
  role: "assistant",
  text,
  tools,
});
const result = (isError?: boolean): BranchItem =>
  isError === undefined
    ? { role: "toolResult", text: "", tools: [] }
    : { role: "toolResult", text: "", tools: [], isError };

describe("requestSignals", () => {
  test("why does src/a.ts fail", () => {
    expect(requestSignals("  why does src/a.ts fail?  ")).toEqual({
      text: "  why does src/a.ts fail?  ",
      prompt_chars: 23,
      files_mentioned: 1,
      has_code_or_error: false,
      is_question: true,
    });
  });
  test("failed with TypeError is an error", () => {
    expect(requestSignals("the build failed with TypeError").has_code_or_error).toBe(true);
  });
  test("same file twice counts once", () => {
    expect(requestSignals("see README.md and README.md").files_mentioned).toBe(1);
  });
  test("plain instruction", () => {
    const s = requestSignals("rename foo to bar");
    expect([s.files_mentioned, s.has_code_or_error, s.is_question]).toEqual([0, false, false]);
  });
  test("at file:line is an error", () => {
    expect(requestSignals("at src/x.ts:12").has_code_or_error).toBe(true);
  });
  test("other error patterns", () => {
    for (const p of ["```x```", "Traceback (most", "NullException", "an Error here", "stack trace"])
      expect(requestSignals(p).has_code_or_error).toBe(true);
    expect(requestSignals("terrorist").has_code_or_error).toBe(false);
  });
  test("question forms", () => {
    expect(requestSignals("Should we?").is_question).toBe(true);
    expect(requestSignals("fix it?").is_question).toBe(true);
    expect(requestSignals("how to fix it").is_question).toBe(true);
    expect(requestSignals("whatever happens").is_question).toBe(false);
  });
  test("100000-character prompts finish under 50 ms", () => {
    for (const p of [
      "a".repeat(100_000),
      "a/".repeat(50_000),
      "at ".repeat(33_333),
      "x.ts ".repeat(20_000),
      ".".repeat(100_000) + "a",
      "?".repeat(100_000) + "x",
      "!".repeat(100_000),
      "at" + " ".repeat(100_000) + "z",
      "at " + "a".repeat(100_000),
      "a.".repeat(50_000),
    ]) {
      const t = performance.now();
      requestSignals(p);
      expect(performance.now() - t).toBeLessThan(50);
    }
  });
});

describe("recentMessages", () => {
  test("newest assistant keeps its share when later users are long", () => {
    const out = recentMessages([
      asst("A".repeat(2500) + "Z".repeat(2500)),
      user("u".repeat(900)),
      user("v".repeat(900)),
    ]);
    const a = out.find((m) => m.role === "assistant")!;
    expect(a).toBeDefined();
    expect(a.text.length).toBeLessThanOrEqual(1100);
    expect(a.text.startsWith("A")).toBe(true);
    expect(a.text.endsWith("Z")).toBe(true);
    expect(out.reduce((n, m) => n + m.text.length, 0)).toBeLessThanOrEqual(2000);
    expect(out.length).toBeLessThanOrEqual(4);
  });
  test("newest item a user message with a long assistant before it", () => {
    const out = recentMessages([user("q"), asst("A".repeat(3000)), user("w".repeat(3000))]);
    expect(out.map((m) => m.role)).toEqual(["assistant", "user"]);
    expect(out.reduce((n, m) => n + m.text.length, 0)).toBeLessThanOrEqual(2000);
    expect(out[0]!.text.length).toBeLessThanOrEqual(1100);
  });
  test("short history", () => {
    expect(recentMessages([user("hi"), asst("hello")])).toEqual([
      { role: "user", text: "hi", tools: [] },
      { role: "assistant", text: "hello", tools: [] },
    ]);
  });
  test("long newest assistant keeps both ends", () => {
    const text = "START" + "x".repeat(4991) + "END?";
    const out = recentMessages([user("q"), asst(text)]);
    const m = out[1]!.text;
    expect(m.length).toBeLessThanOrEqual(1100);
    expect(m).toContain("START");
    expect(m).toContain("END?");
    expect(m).toContain(" … ");
  });
  test("six 900-character messages", () => {
    const items = [1, 2, 3, 4, 5, 6].map((i) => (i % 2 ? user : asst)(String(i).repeat(900)));
    const out = recentMessages(items);
    expect(out.length).toBeLessThanOrEqual(4);
    expect(out.reduce((n, m) => n + m.text.length, 0)).toBeLessThanOrEqual(2000);
    expect(out[out.length - 1]!.text.startsWith("6")).toBe(true);
    for (const m of out) expect(m.text.length >= 200 || m.text.length === 900).toBe(true);
  });
  test("tool arguments never appear, failures flagged", () => {
    const items: BranchItem[] = [
      user("run it"),
      asst("ok", [{ name: "bash", failed: true }]),
      result(true),
    ];
    const out = recentMessages(items);
    expect(out[1]!.tools).toEqual([{ name: "bash", failed: true }]);
    expect(JSON.stringify(mainState({ prompt: "x", items, platforms: [] }))).not.toContain(
      "JEV-MARKER-ARG",
    );
  });
  test("toolResult items are never messages", () => {
    const out = recentMessages([user("a"), result(false), asst("b")]);
    expect(out.map((m) => m.role)).toEqual(["user", "assistant"]);
  });
  test("empty items", () => {
    expect(recentMessages([])).toEqual([]);
  });
});

describe("recentTools / turnIndex / mainState", () => {
  test("recentTools counts", () => {
    const items = [
      user("go"),
      asst("", [{ name: "edit" }, { name: "bash" }]),
      result(false),
      asst("", [{ name: "bash" }, { name: "read" }]),
      result(true),
    ];
    expect(recentTools(items)).toEqual({
      edits: 1,
      commands: 2,
      reads: 1,
      subagents: 0,
      failed: 1,
    });
  });
  test("web tools, write and subagent", () => {
    const t = recentTools([
      asst("", [{ name: "web_search" }, { name: "write" }, { name: "subagent" }]),
    ]);
    expect(t).toEqual({
      edits: 1,
      commands: 0,
      reads: 1,
      subagents: 1,
      failed: 0,
    });
  });
  test("only the last 10 items count", () => {
    const items = [asst("", [{ name: "bash" }]), ...Array.from({ length: 10 }, () => user("x"))];
    expect(recentTools(items).commands).toBe(0);
    expect(turnIndex(items)).toBe(10);
  });
  test("empty items", () => {
    expect(turnIndex([])).toBe(0);
    expect(
      mainState({ prompt: "hi", items: [], platforms: ["none found"] }).conversation.recent,
    ).toEqual([]);
  });
  test("mainState keys", () => {
    const s = mainState({
      prompt: "hi",
      items: [user("a")],
      platforms: ["Docker"],
    });
    expect(Object.keys(s)).toEqual(["request", "conversation", "workspace"]);
    expect(Object.keys(s.conversation)).toEqual(["recent", "recent_tools", "turn_index"]);
    expect(Object.keys(s.workspace)).toEqual(["platforms"]);
    expect(Object.keys(s.conversation.recent_tools)).toEqual([
      "edits",
      "commands",
      "reads",
      "subagents",
      "failed",
    ]);
    expect(s.workspace.platforms).toEqual(["Docker"]);
  });
});

const FACTS: AgentFacts = {
  name: "worker",
  source: "project",
  description: "does work",
  instructionsExcerpt: "be careful",
  declaredTools: ["read", "edit"],
  maxTurns: null,
  sets: { model: false, thinking: false },
};

function build(over: Partial<Parameters<typeof buildWorkerState>[0]> = {}) {
  return buildWorkerState({ brief: "do it", agent: FACTS, runInBackground: false, ...over });
}

describe("Worker state shape", () => {
  test("Parent request off by default", () => {
    const state = build();
    expect(Object.keys(state).sort()).toEqual(["agent", "task"]);
    expect("parent_request" in state).toBe(false);
  });
  test("Parent request on", () => {
    const state = build({ parentRequest: "x".repeat(800) });
    expect(Object.keys(state).sort()).toEqual(["agent", "parent_request", "task"]);
    expect(Array.from(state.parent_request ?? "")).toHaveLength(500);
  });
  test("Agent block", () => {
    const state = build({ runInBackground: true });
    expect(Object.keys(state.agent)).toEqual([
      "name",
      "source",
      "description",
      "instructions_excerpt",
      "declared_tools",
      "max_turns",
      "run_in_background",
    ]);
    expect(state.agent.run_in_background).toBe(true);
    expect(state.task.description).toBe("");
  });
  test("No model in state", () => {
    const cwd = tempDir("state-cwd-");
    const agentDir = tempDir("state-global-");
    mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
    writeFileSync(
      join(cwd, ".pi", "agents", "worker.md"),
      "---\ndescription: d\nmodel: anthropic/claude-opus\nthinking: high\n---\nbody",
    );
    const agent = readAgent("worker", { cwd, agentDir });
    expect(agent.sets).toEqual({ model: true, thinking: true });
    const json = JSON.stringify(build({ agent }));
    expect(json).not.toContain("claude-opus");
    expect(json).not.toContain('"model"');
    expect(json).not.toContain('"thinking"');
  });
});

describe("Worker state text limits", () => {
  test("Brief cut at 4000 characters", () => {
    expect(build({ brief: "a".repeat(6000) }).task.brief).toBe("a".repeat(4000));
  });
  test("Brief at the limit", () => {
    const exact = "b".repeat(4000);
    expect(build({ brief: exact }).task.brief).toBe(exact);
    const cut = build({ brief: "a".repeat(3999) + "😀😀" }).task.brief;
    expect(Array.from(cut)).toHaveLength(4000);
    expect(cut.endsWith("😀")).toBe(true);
    expect(cut).toBe("a".repeat(3999) + "😀");
  });
  test("Parent request on", () => {
    expect(build({ parentRequest: "p".repeat(800) }).parent_request).toBe("p".repeat(500));
  });
});

function buildTools(over: Partial<Parameters<typeof buildToolState>[0]> = {}) {
  return buildToolState({ brief: "do it", description: "d", agent: FACTS, tools: [], ...over });
}

describe("Tool state", () => {
  test("Long brief keeps the last 4000 code points", () => {
    const state = buildTools({ brief: "a".repeat(1000) + "b".repeat(4000) });
    expect(state.task.brief).toBe("b".repeat(4000));
  });
  test("Forked worker keeps the child task", () => {
    const state = buildTools({ brief: "PARENT-CONTEXT…" + "CHILD-TASK" });
    expect(state.task.brief.endsWith("CHILD-TASK")).toBe(true);
  });
  test("Tool metadata", () => {
    const state = buildTools({
      tools: [
        {
          name: "bash",
          description: "D",
          source: "builtin",
          parameters: { command: "Shell command to execute" },
        },
      ],
    });
    expect(state.tools.bash).toEqual({
      description: "D",
      source: "builtin",
      parameters: { command: "Shell command to execute" },
    });
  });
  test("Long tool description", () => {
    const long = "x".repeat(899) + "😀";
    const state = buildTools({
      tools: [{ name: "t", description: long, source: "s", parameters: { p: long } }],
    });
    expect(state.tools.t!.description).toBe("x".repeat(500));
    expect(state.tools.t!.parameters.p).toBe("x".repeat(500));
  });
  test("agent is name, source and description only", () => {
    expect(buildTools().agent).toEqual({
      name: "worker",
      source: "project",
      description: "does work",
    });
  });
  test("a tool named __proto__ is an own entry", () => {
    const state = buildTools({
      tools: [{ name: "__proto__", description: "D", source: "s", parameters: {} }],
    });
    expect(Object.keys(state.tools)).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(state.tools)).toBe(Object.prototype);
  });
});

describe("mainState rich groups", () => {
  const base = { prompt: "hi", items: [user("a")], platforms: ["Docker"] };
  const all: RichInputs = {
    lastDecision: { effort: "low", strategy: "direct" },
    git: { changed_files: 2, diff_lines: 10 },
    capabilities: {
      tools: [{ name: "read", description: "Read files" }],
      agents: [{ name: "scout", description: "Recon", tools: ["read"] }],
    },
  };
  test("one group alone: last_decision", () => {
    const s = mainState({ ...base, rich: { lastDecision: { effort: "high" } } });
    expect(s).toEqual({
      ...mainState(base),
      conversation: { ...mainState(base).conversation, last_decision: { effort: "high" } },
    });
  });
  test("one group alone: git", () => {
    const plain = mainState(base);
    const s = mainState({ ...base, rich: { git: { changed_files: 2, diff_lines: 10 } } });
    expect(s).toEqual({
      ...plain,
      workspace: { platforms: ["Docker"], git: { changed_files: 2, diff_lines: 10 } },
    });
  });
  test("every group", () => {
    const s = mainState({ ...base, rich: all });
    expect(s.conversation.last_decision).toEqual({ effort: "low", strategy: "direct" });
    expect(s.workspace.git).toEqual({ changed_files: 2, diff_lines: 10 });
    expect(s.capabilities).toEqual({
      tools: [{ name: "read", summary: "Read files" }],
      subagents: [{ name: "scout", description: "Recon", tools: ["read"] }],
    });
  });
  test("absent rich keeps the output identical", () => {
    expect(JSON.stringify(mainState({ ...base, rich: {} }))).toBe(JSON.stringify(mainState(base)));
  });
  test("pickRich keeps only listed groups", () => {
    expect(pickRich(all, ["git"])).toEqual({ git: { changed_files: 2, diff_lines: 10 } });
    expect(pickRich(all, [])).toEqual({});
  });
  test("shipped list holds last_decision and capabilities", () => {
    expect(SHIPPED_MAIN_GROUPS).toEqual(["last_decision", "capabilities"]);
  });
});

describe("mainState rich shaping", () => {
  const base = { prompt: "hi", items: [user("a")], platforms: [] as string[] };
  const shaped = (rich: RichInputs) => mainState({ ...base, rich });
  const descr = (n: number) => "x".repeat(n);

  test("last decision kept", () => {
    expect(
      shaped({ lastDecision: { effort: "high", strategy: "direct" } }).conversation,
    ).toMatchObject({
      last_decision: { effort: "high", strategy: "direct" },
    });
  });
  test("last decision key omitted", () => {
    const s = shaped({ lastDecision: { effort: "high" } });
    expect(s.conversation.last_decision).toEqual({ effort: "high" });
    expect(Object.keys(s.conversation.last_decision!)).toEqual(["effort"]);
  });
  test("last decision empty omitted", () => {
    expect("last_decision" in shaped({ lastDecision: {} }).conversation).toBe(false);
  });
  test("first sentence", () => {
    const s = shaped({
      capabilities: {
        tools: [
          { name: "read", description: "Read a file. Supports images." },
          { name: "web", description: "Fetch v1.2 now! Then stop" },
          { name: "none", description: descr(250) },
        ],
        agents: [],
      },
    });
    expect(s.capabilities!.tools.map((t) => t.summary)).toEqual([
      descr(200),
      "Read a file.",
      "Fetch v1.2 now!",
    ]);
  });
  test("tool cap 40 by name", () => {
    const tools = Array.from({ length: 45 }, (_, i) => ({
      name: `t${String(44 - i).padStart(2, "0")}`,
      description: "d",
    }));
    const out = shaped({ capabilities: { tools, agents: [] } }).capabilities!.tools;
    expect(out).toHaveLength(40);
    expect(out[0]!.name).toBe("t00");
    expect(out[39]!.name).toBe("t39");
  });
  test("agent cap 30 by name, description 200 code points", () => {
    const agents = Array.from({ length: 35 }, (_, i) => ({
      name: `a${String(34 - i).padStart(2, "0")}`,
      description: "😀".repeat(250),
      tools: null,
    }));
    const out = shaped({ capabilities: { tools: [], agents } }).capabilities!.subagents;
    expect(out).toHaveLength(30);
    expect(out[0]!.name).toBe("a00");
    expect(Array.from(out[0]!.description)).toHaveLength(200);
  });
  test("no model or thinking in subagents", () => {
    const agent = { name: "a", description: "d", tools: ["read"], model: "m", thinking: "high" };
    const out = shaped({ capabilities: { tools: [], agents: [agent] } }).capabilities!.subagents;
    expect(Object.keys(out[0]!)).toEqual(["name", "description", "tools"]);
  });
});

describe("parseShortstat", () => {
  test("parses counts", () => {
    expect(parseShortstat(" 3 files changed, 70 insertions(+), 14 deletions(-)")).toEqual({
      changed_files: 3,
      diff_lines: 84,
    });
    expect(parseShortstat(" 1 file changed, 5 insertions(+)")).toEqual({
      changed_files: 1,
      diff_lines: 5,
    });
    expect(parseShortstat(" 2 files changed, 4 deletions(-)")).toEqual({
      changed_files: 2,
      diff_lines: 4,
    });
  });
  test("empty output is a clean tree", () => {
    expect(parseShortstat("")).toEqual({ changed_files: 0, diff_lines: 0 });
    expect(parseShortstat("  \n")).toEqual({ changed_files: 0, diff_lines: 0 });
  });
  test("garbage is undefined", () => {
    expect(parseShortstat("garbage")).toBeUndefined();
  });
});
