import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { readAgent } from "../../src/host/agents.ts";
import { buildWorkerState } from "../../src/jev/state.ts";
import type { AgentFacts } from "../../src/policy/launch.ts";
import { tempDir } from "../helpers.ts";

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
