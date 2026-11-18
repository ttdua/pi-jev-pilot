import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { AgentTypeRegistry } from "#src/config/agent-types";
import type { AgentConfig } from "#src/types";
import {
  formatRunDuration,
  formatSessionTokens,
  getDisplayName,
  buildInvocationTags,
  getContextLabel,
  modelLabel,
  type Theme,
} from "#src/ui/display";
import { makeAgentConfig } from "#test/helpers/make-agent-config";
import { makeModel } from "#test/helpers/make-model";
import { registryWithGeneral } from "#test/helpers/make-registry";

const testRegistry = registryWithGeneral(() => new Map());

describe("Theme", () => {
  it("accepts only Pi theme color names", () => {
    expectTypeOf<Parameters<Theme["fg"]>[0]>().toEqualTypeOf<ThemeColor>();
  });
});

describe("getDisplayName", () => {
  it("returns displayName when set", () => {
    const customAgents = new Map<string, AgentConfig>([[
      "my-agent",
      {
        name: "my-agent",
        displayName: "My Agent",
        description: "test",
        systemPrompt: "",
        toolsDeclared: false,
        disallowedTools: [],
      },
    ]]);
    const registry = registryWithGeneral(() => customAgents);
    expect(getDisplayName("my-agent", registry)).toBe("My Agent");
  });

  it("falls back to name when displayName is not set", () => {
    const customAgents = new Map<string, AgentConfig>([[
      "my-agent",
      {
        name: "my-agent",
        description: "test",
        systemPrompt: "",
        toolsDeclared: false,
        disallowedTools: [],
      },
    ]]);
    const registry = registryWithGeneral(() => customAgents);
    expect(getDisplayName("my-agent", registry)).toBe("my-agent");
  });

  it("uses registry to resolve Explore displayName", () => {
    expect(getDisplayName("Explore", testRegistry)).toBe("Explore");
  });

  it("shows a legacy type as recorded when no agent resolves it", () => {
    expect(getDisplayName("general-purpose", testRegistry)).toBe("general-purpose");
  });
});

describe("getContextLabel", () => {
  it("returns 'fork' for a fork", () => {
    expect(getContextLabel("fork")).toBe("fork");
  });

  it("returns 'fork → fresh' for a fresh run that fell back from a fork", () => {
    expect(getContextLabel("fresh", "no-parent-session")).toBe("fork → fresh");
  });

  it("returns undefined for a fresh run", () => {
    expect(getContextLabel("fresh")).toBeUndefined();
  });
});

describe("buildInvocationTags", () => {
  it("never emits 'inherit context'", () => {
    const { tags } = buildInvocationTags({ context: "fork", runInBackground: true, maxTurns: 9 });
    expect(tags).toEqual(["background", "max turns: 9"]);
  });
});

describe("formatSessionTokens", () => {
  const theme = { fg: (c: string, s: string) => `<${c}>${s}</${c}>`, bold: (s: string) => s };

  it("applies threshold colors (<70 dim, 70–85 warning, ≥85 error)", () => {
    expect(formatSessionTokens(1234, null, theme)).toBe("1.2k token");
    expect(formatSessionTokens(1234, 50, theme)).toBe("1.2k token <dim>(</dim><dim>50%</dim><dim>)</dim>");
    expect(formatSessionTokens(1234, 70, theme)).toBe("1.2k token <dim>(</dim><warning>70%</warning><dim>)</dim>");
    expect(formatSessionTokens(1234, 84, theme)).toBe("1.2k token <dim>(</dim><warning>84%</warning><dim>)</dim>");
    expect(formatSessionTokens(1234, 85, theme)).toBe("1.2k token <dim>(</dim><error>85%</error><dim>)</dim>");
    expect(formatSessionTokens(1234, 99, theme)).toBe("1.2k token <dim>(</dim><error>99%</error><dim>)</dim>");
  });

  it("annotates compaction count alongside percent", () => {
    // compactions only (e.g. immediately post-compaction, percent null)
    expect(formatSessionTokens(1234, null, theme, 1)).toBe("1.2k token <dim>(</dim><dim>⇊1</dim><dim>)</dim>");
    expect(formatSessionTokens(1234, null, theme, 3)).toBe("1.2k token <dim>(</dim><dim>⇊3</dim><dim>)</dim>");
    // percent + compactions, joined with ` · `
    expect(formatSessionTokens(1234, 45, theme, 2)).toBe("1.2k token <dim>(</dim><dim>45%</dim><dim> · </dim><dim>⇊2</dim><dim>)</dim>");
    expect(formatSessionTokens(1234, 88, theme, 4)).toBe("1.2k token <dim>(</dim><error>88%</error><dim> · </dim><dim>⇊4</dim><dim>)</dim>");
    // compactions=0 omitted
    expect(formatSessionTokens(1234, 45, theme, 0)).toBe("1.2k token <dim>(</dim><dim>45%</dim><dim>)</dim>");
  });
});

describe("modelLabel", () => {
  it("labels a model as provider/id", () => {
    expect(modelLabel(makeModel({ provider: "anthropic", id: "claude-haiku-4-5" }))).toBe("anthropic/claude-haiku-4-5");
  });

  it("is undefined while the model is unknown", () => {
    expect(modelLabel(undefined)).toBeUndefined();
  });
});

describe("formatRunDuration", () => {
  // Each run starts at 1000, so 6_000 is 5 s later.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(6_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a still-queued run's time in the queue", () => {
    expect(formatRunDuration({ status: "queued", startedAt: 1000, completedAt: undefined, stoppedWhileQueued: false })).toBe("queued 5.0s");
  });

  it("freezes a run stopped while queued at the time it waited", () => {
    expect(formatRunDuration({ status: "stopped", startedAt: 1000, completedAt: 4000, stoppedWhileQueued: true })).toBe("queued 3.0s");
  });

  it("renders a completed run's running time", () => {
    expect(formatRunDuration({ status: "completed", startedAt: 1000, completedAt: 4000, stoppedWhileQueued: false })).toBe("3.0s");
  });

  it("marks a still-running run's elapsed time as running", () => {
    expect(formatRunDuration({ status: "running", startedAt: 1000, completedAt: undefined, stoppedWhileQueued: false })).toBe("5.0s (running)");
  });
});

describe("getDisplayName — history without the fallback agent", () => {
  const withoutGeneral = (agents: Map<string, AgentConfig> = new Map()) => new AgentTypeRegistry(() => agents);

  it.each(["Plan", "Explore", "general-purpose"])("shows the recorded legacy type %s when general is missing", (type) => {
    expect(getDisplayName(type, withoutGeneral())).toBe(type);
  });

  it("shows the recorded type when general is disabled", () => {
    const registry = withoutGeneral(new Map([["general", makeAgentConfig({ name: "general", enabled: false })]]));
    expect(getDisplayName("Plan", registry)).toBe("Plan");
  });

  it("shows the recorded type when general is present but the type does not resolve", () => {
    expect(getDisplayName("Plan", testRegistry)).toBe("Plan");
  });

  it("uses a resolving agent's display name or name, case-insensitively", () => {
    const registry = withoutGeneral(new Map([["Explore", makeAgentConfig({ name: "Explore" })]]));
    expect(getDisplayName("explore", registry)).toBe("Explore");
  });
});
