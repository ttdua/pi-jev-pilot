import { describe, expect, test } from "bun:test";
import type { AgentTypeSnapshot } from "@ttdua/pi-subagents";
import { agentFacts, executorAgents } from "../../../src/host/platform/agents.ts";

const READ_ONLY = ["read", "bash", "grep", "find", "ls"];
const DEFAULT_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const EXPLORE_INSTRUCTIONS = `# CRITICAL: READ-ONLY MODE\n${"Search and analyze code. ".repeat(60)}`;

function snapshot(over: Partial<AgentTypeSnapshot> = {}): AgentTypeSnapshot {
  return Object.freeze({
    name: "worker",
    source: "project",
    description: "A worker",
    instructions: "Do the work.",
    tools: null,
    defaultTools: DEFAULT_TOOLS,
    disallowedTools: [],
    ...over,
  });
}

const explore = (): AgentTypeSnapshot =>
  snapshot({
    name: "Explore",
    source: "builtin",
    description: "Fast codebase exploration agent (read-only)",
    instructions: EXPLORE_INSTRUCTIONS,
    tools: READ_ONLY,
    model: "anthropic/claude-haiku-4-5-20251001",
  });

describe("agentFacts", () => {
  test("Built-in Explore", () => {
    const facts = agentFacts(explore());
    expect(facts.name).toBe("Explore");
    expect(facts.source).toBe("builtin");
    expect(facts.description).toBe("Fast codebase exploration agent (read-only)");
    expect(facts.declaredTools).toEqual(READ_ONLY);
    expect(facts.instructionsExcerpt).toBe(Array.from(EXPLORE_INSTRUCTIONS).slice(0, 500).join(""));
    expect(facts.disallowedTools).toEqual([]);
    expect(facts.sets).toEqual({ model: true, thinking: false });
    expect(facts.maxTurns).toBeNull();
  });

  test("Long instructions", () => {
    const text = "x".repeat(2000);
    expect(agentFacts(snapshot({ instructions: text })).instructionsExcerpt).toBe("x".repeat(500));
  });

  test("Instructions are trimmed and cut by code points", () => {
    const text = `  ${"😀".repeat(600)}  `;
    const excerpt = agentFacts(snapshot({ instructions: text })).instructionsExcerpt;
    expect(Array.from(excerpt)).toHaveLength(500);
    expect(excerpt.startsWith("😀")).toBe(true);
  });

  test("Disallowed tools carried", () => {
    expect(agentFacts(snapshot({ disallowedTools: ["bash"] })).disallowedTools).toEqual(["bash"]);
  });

  test("Model never read out", () => {
    const facts = agentFacts(snapshot({ model: "anthropic/claude-opus", thinking: "high" }));
    const text = JSON.stringify(facts);
    expect(text).not.toContain("anthropic/claude-opus");
    expect(text).not.toContain('"high"');
    expect(facts.sets).toEqual({ model: true, thinking: true });
  });

  test("Invalid thinking is not set", () => {
    expect(agentFacts(snapshot({ thinking: "banana" })).sets.thinking).toBe(false);
  });

  test("Launch fields carried only when declared", () => {
    const declared = agentFacts(
      snapshot({ maxTurns: 7, runInBackground: true, inheritContext: false }),
    );
    expect(declared.maxTurns).toBe(7);
    expect(declared.runInBackground).toBe(true);
    expect(declared.inheritContext).toBe(false);
    const bare = agentFacts(snapshot());
    expect("runInBackground" in bare).toBe(false);
    expect("inheritContext" in bare).toBe(false);
  });

  test("Executor agents mapped through agentFacts", () => {
    const service = { listAgentTypes: () => [explore(), snapshot()] };
    expect(executorAgents(service)).toEqual([agentFacts(explore()), agentFacts(snapshot())]);
  });

  test("No executor gives no agents", () => {
    expect(executorAgents(undefined)).toEqual([]);
  });

  test("Throwing registry gives no agents", () => {
    const service = {
      listAgentTypes: (): readonly AgentTypeSnapshot[] => {
        throw new Error("boom");
      },
    };
    expect(executorAgents(service)).toEqual([]);
  });

  test("Facts never alias the snapshot", () => {
    const snap = snapshot({ tools: ["read"], disallowedTools: ["bash"] });
    const facts = agentFacts(snap);
    expect(facts.declaredTools).not.toBe(snap.tools);
    expect(facts.disallowedTools).not.toBe(snap.disallowedTools);
  });
});
