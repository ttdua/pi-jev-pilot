import { describe, expect, it } from "vitest";
import type { EnvInfo } from "#src/session/env";
import { freshPromptExtension } from "#src/session/fresh-prompt-extension";
import { buildAgentPrompt, composeAgentSection } from "#src/session/prompts";
import { makeAgentConfig } from "#test/helpers/make-agent-config";

const env: EnvInfo = {
  isGitRepo: true,
  branch: "main",
  platform: "darwin",
};

const envNoGit: EnvInfo = {
  isGitRepo: false,
  branch: "",
  platform: "linux",
};

describe("composeAgentSection", () => {
  it("places the active_agent tag before the body, with the body last", () => {
    const section = composeAgentSection('<active_agent name="x"/>', "BODY-MARKER");
    expect(section).toBe('<active_agent name="x"/>\n\nBODY-MARKER');
    expect(section.endsWith("BODY-MARKER")).toBe(true);
  });

  it("yields the header only when the body is blank", () => {
    expect(composeAgentSection('<active_agent name="x"/>', "  \n ")).toBe('<active_agent name="x"/>');
  });
});

describe("freshPromptExtension", () => {
  it("sets the agent section on before_agent_start and returns nothing", async () => {
    let handler: ((event: unknown) => unknown) | undefined;
    const pi = {
      on: (name: string, fn: (event: unknown) => unknown) => {
        if (name === "before_agent_start") handler = fn;
      },
    };
    freshPromptExtension("SECTION")(pi as never);
    const event = { systemPromptOptions: { sections: { other: "keep" } as Record<string, string> } };
    const result = await handler?.(event);
    expect(result).toBeUndefined();
    expect(event.systemPromptOptions.sections).toEqual({ other: "keep", agent: "SECTION" });
  });
});

describe("buildAgentPrompt (fresh)", () => {
  it("puts the active_agent tag before the environment header", () => {
    const config = makeAgentConfig({ name: "Explore", systemPrompt: "You are an explorer." });
    const prompt = buildAgentPrompt(config, "/workspace", env);
    const tagAt = prompt.indexOf('<active_agent name="Explore"/>');
    const envAt = prompt.indexOf("# Environment");
    expect(tagAt).toBeGreaterThan(-1);
    expect(envAt).toBeGreaterThan(tagAt);
  });

  it("carries no agent body; composeAgentSection appends it last", () => {
    const config = makeAgentConfig({ name: "custom", systemPrompt: "BODY-MARKER" });
    const prompt = buildAgentPrompt(config, "/workspace", env);
    expect(prompt).not.toContain("BODY-MARKER");
  });

  it("includes cwd and git info", () => {
    const config = makeAgentConfig({ name: "general-purpose", systemPrompt: "" });
    const prompt = buildAgentPrompt(config, "/workspace", env);
    expect(prompt).toContain("Working directory: /workspace");
    expect(prompt).toContain("Branch: main");
    expect(prompt).toContain("Platform: darwin");
  });

  it("states that the directory is not a git repository", () => {
    const config = makeAgentConfig({ name: "Explore", systemPrompt: "" });
    const prompt = buildAgentPrompt(config, "/workspace", envNoGit);
    expect(prompt).toContain("Not a git repository");
    expect(prompt).not.toContain("Branch:");
  });

  it("uses the agent name verbatim in the tag", () => {
    const config = makeAgentConfig({ name: "my-custom-agent", systemPrompt: "You are custom." });
    const prompt = buildAgentPrompt(config, "/workspace", env);
    expect(prompt).toContain('<active_agent name="my-custom-agent"/>');
  });

  it("does not carry a parent identity into a fresh child", () => {
    const config = makeAgentConfig({ name: "standalone", systemPrompt: "BODY" });
    const prompt = buildAgentPrompt(config, "/workspace", env);
    expect(prompt).not.toContain("PARENT-MARKER");
    expect(prompt).not.toContain("<sub_agent_context>");
    expect(prompt).not.toContain("<agent_instructions>");
  });
});
