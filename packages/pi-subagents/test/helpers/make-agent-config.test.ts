import { describe, expect, it } from "vitest";
import { makeAgentConfig } from "./make-agent-config";

describe("makeAgentConfig", () => {
  it("returns a fully-shaped AgentConfig with defaults", () => {
    expect(makeAgentConfig()).toEqual({
      name: "test-agent",
      description: "Test agent",
      toolNames: ["read", "grep"],
      toolsDeclared: true,
      disallowedTools: [],
      systemPrompt: "You are a test agent.",
      context: "fresh",
      runInBackground: false,
    });
  });

  it("applies overrides while keeping other defaults", () => {
    const config = makeAgentConfig({ name: "twin", context: "fork", systemPrompt: "" });
    expect(config.name).toBe("twin");
    expect(config.context).toBe("fork");
    expect(config.systemPrompt).toBe("");
    expect(config.description).toBe("Test agent");
  });
});
