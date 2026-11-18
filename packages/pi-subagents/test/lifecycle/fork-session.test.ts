import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { buildForkSession, FORKED_RESULT_TEXT, type ForkInput } from "#src/lifecycle/fork-session";
import { makeAgentConfig } from "#test/helpers/make-agent-config";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";

let seq = 0;
function entry(message: Record<string, unknown>): SessionEntry {
  seq += 1;
  return { type: "message", id: `e${seq}`, parentId: null, timestamp: "2026-01-01T00:00:00.000Z", message } as unknown as SessionEntry;
}

const user = entry({ role: "user", content: [{ type: "text", text: "do it" }], timestamp: 1 });
const readCall = { type: "toolCall", id: "call-read", name: "read", arguments: { path: "a" } };
const done = entry({ role: "assistant", content: [readCall], stopReason: "toolUse", timestamp: 2 });
const result = entry({
  role: "toolResult",
  toolCallId: "call-read",
  toolName: "read",
  content: [{ type: "text", text: "RESULT-MARKER" }],
  isError: false,
  timestamp: 3,
});
const pendingLeaf = entry({
  role: "assistant",
  content: [
    { type: "text", text: "spawning" },
    { type: "toolCall", id: "call-read-2", name: "read", arguments: { path: "b" } },
    { type: "toolCall", id: "call-sub", name: "subagent", arguments: { prompt: "x" } },
  ],
  stopReason: "toolUse",
  timestamp: 4,
});
const BRANCH = [user, done, result, pendingLeaf];

function input(overrides: Partial<ForkInput> = {}): ForkInput {
  return {
    parent: {
      ...STUB_SNAPSHOT,
      systemPrompt: "PARENT-PROMPT",
      toolNames: ["read", "grep", "edit", "subagent"],
      branch: BRANCH,
    },
    agent: makeAgentConfig({ name: "Explore", systemPrompt: "BODY-MARKER" }),
    cwd: "/child/cwd",
    task: "TASK-A",
    callableTools: ["read", "grep"],
    agentOnlyTools: [],
    ...overrides,
  };
}

/** The message carried by a plan entry. */
function messageOf(e: SessionEntry): Record<string, unknown> {
  return (e as unknown as { message: Record<string, unknown> }).message;
}

describe("buildForkSession", () => {
  it("Same prefix: entries begin with the parent branch in order", () => {
    const plan = buildForkSession(input());
    expect(plan.entries.slice(0, BRANCH.length)).toEqual(BRANCH);
  });

  it("Tool results inherited: a tool-result entry stays a tool result", () => {
    const plan = buildForkSession(input());
    const inherited = plan.entries.map(messageOf).find((m) => m.toolCallId === "call-read");
    expect(inherited?.role).toBe("toolResult");
    expect(JSON.stringify(inherited?.content)).toContain("RESULT-MARKER");
    expect(plan.firstMessage).not.toContain("RESULT-MARKER");
  });

  it("Mixed pending calls: every pending call at the leaf gets the fixed result", () => {
    const plan = buildForkSession(input());
    const added = plan.entries.slice(BRANCH.length).map(messageOf);
    expect(added).toEqual([
      expect.objectContaining({
        role: "toolResult",
        toolCallId: "call-read-2",
        toolName: "read",
        content: [{ type: "text", text: FORKED_RESULT_TEXT }],
        isError: false,
      }),
      expect.objectContaining({
        role: "toolResult",
        toolCallId: "call-sub",
        toolName: "subagent",
        content: [{ type: "text", text: FORKED_RESULT_TEXT }],
        isError: false,
      }),
    ]);
    expect(FORKED_RESULT_TEXT).toBe("Forked: this branch continues as a subagent.");
  });

  it("adds no result for a call that already has one", () => {
    const plan = buildForkSession(input({ parent: { ...input().parent, branch: [user, done, result] } }));
    expect(plan.entries).toEqual([user, done, result]);
  });

  it("Parallel forks share the prefix: plans differ only from the instructions message on", () => {
    const a = buildForkSession(input({ task: "TASK-A" }));
    const b = buildForkSession(input({ task: "TASK-B" }));
    expect(a.entries).toEqual(b.entries);
    expect(a.systemPrompt).toBe(b.systemPrompt);
    expect(a.toolNames).toEqual(b.toolNames);
    expect(a.firstMessage).not.toBe(b.firstMessage);
  });

  it("Child directory stated: the instructions name the child's cwd", () => {
    expect(buildForkSession(input()).firstMessage).toContain("Working directory: /child/cwd");
  });

  it("Agent-only tools named: the instructions name web_search as unavailable", () => {
    const plan = buildForkSession(input({ agentOnlyTools: ["web_search"] }));
    expect(plan.firstMessage).toMatch(/not available[^\n]*web_search/);
  });

  it("builds the instructions block in order, then the task", () => {
    const { firstMessage } = buildForkSession(input());
    const order = [
      "<subagent_instructions>",
      '<active_agent name="Explore"/>',
      "Working directory: /child/cwd",
      "BODY-MARKER",
      "You are a forked subagent. Do the task below and reply with the result. You cannot start subagents.",
      "</subagent_instructions>",
      "TASK-A",
    ].map((part) => firstMessage.indexOf(part));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(firstMessage.endsWith("TASK-A")).toBe(true);
  });

  it("keeps the parent's system prompt and tool names", () => {
    const plan = buildForkSession(input());
    expect(plan.systemPrompt).toBe("PARENT-PROMPT");
    expect(plan.toolNames).toEqual(["read", "grep", "edit", "subagent"]);
  });
});
