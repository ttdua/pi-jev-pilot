import { describe, expect, it, vi } from "vitest";
import { buildParentSnapshot } from "#src/lifecycle/parent-snapshot";
import type { SessionContext } from "#src/types";

const BRANCH = [
  { type: "message", id: "e1", parentId: null, timestamp: "t", message: { role: "user", content: "hi" } },
  { type: "message", id: "e2", parentId: "e1", timestamp: "t", message: { role: "assistant", content: [] } },
];

function makeCtx(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    cwd: "/test/project",
    getSystemPrompt: () => "parent system prompt",
    model: undefined,
    thinkingLevel: "high",
    modelRegistry: { find: vi.fn(), getAll: vi.fn(() => []) },
    sessionManager: {
      getSessionFile: () => undefined,
      getSessionId: () => "parent-id",
      getBranch: () => BRANCH,
    },
    ...overrides,
  };
}

const decl = (name: string) => ({ name, description: `${name} tool`, parameters: {} });

describe("buildParentSnapshot", () => {
  it("captures cwd, system prompt, model and registry", () => {
    const ctx = makeCtx({ cwd: "/custom" });
    const snapshot = buildParentSnapshot(ctx, "fresh", []);
    expect(snapshot.cwd).toBe("/custom");
    expect(snapshot.systemPrompt).toBe("parent system prompt");
    expect(snapshot.modelRegistry).toBe(ctx.modelRegistry);
  });

  it("carries the parent session id, tool names and thinking", () => {
    const snapshot = buildParentSnapshot(makeCtx(), "fork", [decl("read"), decl("edit")]);
    expect(snapshot.sessionId).toBe("parent-id");
    expect(snapshot.toolNames).toEqual(["read", "edit"]);
    expect(snapshot.thinking).toBe("high");
  });

  it("carries the live branch for a fork, before the session file is written", () => {
    // getSessionFile() is undefined: Pi has not persisted yet, the branch is in memory.
    const snapshot = buildParentSnapshot(makeCtx(), "fork", []);
    expect(snapshot.branch).toEqual(BRANCH);
  });

  it("detaches the branch from the live session", () => {
    const live = [...BRANCH];
    const snapshot = buildParentSnapshot(
      makeCtx({ sessionManager: { getSessionFile: () => undefined, getSessionId: () => "p", getBranch: () => live } }),
      "fork",
      [],
    );
    live.push(BRANCH[0]);
    expect(snapshot.branch).toHaveLength(2);
  });

  it("carries no branch for a fresh launch", () => {
    expect(buildParentSnapshot(makeCtx(), "fresh", []).branch).toEqual([]);
  });

  it("carries no text parent context", () => {
    const snapshot = buildParentSnapshot(makeCtx(), "fork", []);
    expect("parentContext" in snapshot).toBe(false);
    expect("portablePrompt" in snapshot).toBe(false);
  });
});
