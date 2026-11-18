import { describe, expect, it } from "vitest";
import { resolveSpawnConfig } from "#src/tools/spawn-config";
import { makeAgentConfig } from "#test/helpers/make-agent-config";
import { makeModel } from "#test/helpers/make-model";
import { registryWithGeneral } from "#test/helpers/make-registry";

/** Minimal registry with default agents only. */
const testRegistry = registryWithGeneral(() => new Map([["Explore", makeAgentConfig({ name: "Explore", displayName: "Explore", source: "builtin" })]]));

/** Shorthand for building ModelInfo. */
function makeModelInfo(overrides: Partial<Parameters<typeof resolveSpawnConfig>[2]> = {}) {
  return {
    parentModel: makeModel({ id: "claude-sonnet", name: "Claude Sonnet" }),
    modelRegistry: { find: () => undefined, getAll: () => [], getAvailable: () => [] },
    ...overrides,
  };
}

const defaultSettings = { defaultMaxTurns: undefined as number | undefined };

describe("resolveSpawnConfig — missing fallback agent", () => {
  it("returns an error naming general when the fallback is disabled", () => {
    const registry = registryWithGeneral(() => new Map([["general", makeAgentConfig({ name: "general", enabled: false })]]));
    const result = resolveSpawnConfig(
      { subagent_type: "Plan", prompt: "test", description: "d" },
      registry,
      makeModelInfo(),
      defaultSettings,
    );
    expect(result).toEqual({ error: expect.stringContaining('Agent type "general" is not available') });
  });

  it("notes the fallback exactly", () => {
    const result = resolveSpawnConfig(
      { subagent_type: "Plan", prompt: "test", description: "d" },
      testRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) throw new Error(result.error);
    expect(result.notes).toEqual(['Note: Unknown agent type "Plan" — using general.']);
  });
});

describe("resolveSpawnConfig — type resolution", () => {
  it("resolves a known agent type", () => {
    const result = resolveSpawnConfig(
      { subagent_type: "general", prompt: "test", description: "d" },
      testRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    expect("error" in result && result.error).toBeFalsy();
    if ("error" in result) return;
    expect(result.identity.subagentType).toBe("general");
    expect(result.identity.fellBack).toBe(false);
  });

  it("falls back to general for unknown agent type", () => {
    const result = resolveSpawnConfig(
      { subagent_type: "unknown-type", prompt: "test", description: "d" },
      testRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    expect("error" in result && result.error).toBeFalsy();
    if ("error" in result) return;
    expect(result.identity.subagentType).toBe("general");
    expect(result.identity.fellBack).toBe(true);
  });

  it("sets displayName from registry", () => {
    const result = resolveSpawnConfig(
      { subagent_type: "Explore", prompt: "test", description: "d" },
      testRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) return;
    expect(result.identity.displayName).toBe("Explore");
  });

  it("uses displayName from agent config when available", () => {
    const result = resolveSpawnConfig(
      { subagent_type: "general", prompt: "test", description: "d" },
      testRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) return;
    // the general built-in declares no display name
    expect(result.identity.displayName).toBe("general");
  });
});

describe("resolveSpawnConfig — model resolution", () => {
  it("inherits parent model when no model specified", () => {
    const parentModel = makeModel({ id: "claude-sonnet", name: "Claude Sonnet" });
    const result = resolveSpawnConfig(
      { subagent_type: "general", prompt: "test", description: "d" },
      testRegistry,
      makeModelInfo({ parentModel }),
      defaultSettings,
    );
    if ("error" in result) return;
    expect(result.execution.model).toBe(parentModel);
  });

  it("returns error when user-specified model cannot be resolved", () => {
    const result = resolveSpawnConfig(
      { subagent_type: "general", prompt: "test", description: "d", model: "nonexistent-xyz" },
      testRegistry,
      makeModelInfo({ modelRegistry: { find: () => undefined, getAll: () => [], getAvailable: () => [] } }),
      defaultSettings,
    );
    expect("error" in result && result.error).toBeTruthy();
  });
});

describe("resolveSpawnConfig — model label", () => {
  const parentModel = makeModel({ provider: "anthropic", id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" });
  const haiku = makeModel({ provider: "anthropic", id: "claude-haiku-4-5", name: "Claude Haiku 4.5" });
  const registryWithHaiku = {
    find: (provider: string, id: string) => (provider === haiku.provider && id === haiku.id ? haiku : undefined),
    getAll: () => [haiku],
    getAvailable: () => [haiku],
  };

  function modelNameFor(params: Record<string, unknown>, modelInfo: Parameters<typeof resolveSpawnConfig>[2]) {
    const result = resolveSpawnConfig(
      { subagent_type: "general", prompt: "test", description: "d", ...params },
      testRegistry,
      modelInfo,
      defaultSettings,
    );
    if ("error" in result) throw new Error(result.error);
    return result.presentation.detailBase.modelName;
  }

  it("labels an inherited model even though it matches the parent's", () => {
    expect(modelNameFor({}, makeModelInfo({ parentModel }))).toBe("anthropic/claude-sonnet-5-5");
  });

  it("labels a requested model as provider/id, not its display name", () => {
    expect(
      modelNameFor({ model: "anthropic/claude-haiku-4-5" }, makeModelInfo({ parentModel, modelRegistry: registryWithHaiku })),
    ).toBe("anthropic/claude-haiku-4-5");
  });

  it("leaves the label unset when no model resolved", () => {
    expect(modelNameFor({}, makeModelInfo({ parentModel: undefined }))).toBeUndefined();
  });
});

describe("resolveSpawnConfig — max turns normalization", () => {
  it("normalizes max_turns from params", () => {
    const result = resolveSpawnConfig(
      { subagent_type: "general", prompt: "test", description: "d", max_turns: 10 },
      testRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) return;
    expect(result.execution.effectiveMaxTurns).toBe(10);
  });

  it("uses settings defaultMaxTurns when no max_turns in params", () => {
    const result = resolveSpawnConfig(
      { subagent_type: "general", prompt: "test", description: "d" },
      testRegistry,
      makeModelInfo(),
      { defaultMaxTurns: 25 },
    );
    if ("error" in result) return;
    expect(result.execution.effectiveMaxTurns).toBe(25);
  });

  it("returns undefined effectiveMaxTurns when neither params nor settings specify", () => {
    const result = resolveSpawnConfig(
      { subagent_type: "general", prompt: "test", description: "d" },
      testRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) return;
    expect(result.execution.effectiveMaxTurns).toBeUndefined();
  });
});

describe("resolveSpawnConfig — invocation fields", () => {
  it("sets runInBackground from params", () => {
    const result = resolveSpawnConfig(
      { subagent_type: "general", prompt: "test", description: "d", run_in_background: true },
      testRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) return;
    expect(result.execution.runInBackground).toBe(true);
  });

  it("builds agentInvocation snapshot", () => {
    const result = resolveSpawnConfig(
      { subagent_type: "general", prompt: "test", description: "d", thinking: "high" },
      testRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) return;
    expect(result.execution.agentInvocation).toEqual({
      thinking: "high",
      maxTurns: undefined,
      context: "fresh",
      runInBackground: false,
    });
  });
});

describe("resolveSpawnConfig — detailBase and tags", () => {
  it("builds detailBase with description from params", () => {
    const result = resolveSpawnConfig(
      { subagent_type: "general", prompt: "test", description: "my task" },
      testRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) return;
    expect(result.presentation.detailBase.description).toBe("my task");
    expect(result.presentation.detailBase.subagentType).toBe("general");
    expect(result.presentation.detailBase.displayName).toBe("general");
  });

  it("carries thinking on detailBase, not as a tag", () => {
    const result = resolveSpawnConfig(
      {
        subagent_type: "general",
        prompt: "test",
        description: "d",
        thinking: "high",
        inherit_context: true,
      },
      testRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) return;
    expect(result.presentation.detailBase.thinking).toBe("high");
    expect(result.presentation.agentTags).toEqual(["thinking: high"]);
    expect(result.presentation.detailBase.tags).toBeUndefined();
  });

  it("omits mode label for replace-mode agents", () => {
    const result = resolveSpawnConfig(
      { subagent_type: "Explore", prompt: "test", description: "d" },
      testRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) return;
    // Explore is fresh → no mode label, no invocation overrides
    expect(result.presentation.agentTags).toEqual([]);
  });

  it("includes fork tag for a forked launch", () => {
    const result = resolveSpawnConfig(
      { subagent_type: "general", prompt: "test", description: "d", context: "fork" },
      testRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) return;
    // The label comes from the run's record (see buildDetails), not from the spawn config.
    expect(result.presentation.agentTags).not.toContain("fork");
    expect(result.presentation.detailBase.modeLabel).toBeUndefined();
  });

  it("sets tags to undefined on detailBase for replace-mode agents with no invocation overrides", () => {
    const result = resolveSpawnConfig(
      { subagent_type: "Explore", prompt: "test", description: "d" },
      testRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) return;
    // Explore is fresh and no invocation overrides → no tags
    expect(result.presentation.detailBase.tags).toBeUndefined();
  });
});

describe("resolveSpawnConfig — thinking level", () => {
  it("returns an error naming the valid levels for an unrecognized thinking param", () => {
    const result = resolveSpawnConfig(
      { subagent_type: "Explore", prompt: "test", description: "d", thinking: "turbo" },
      testRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    expect(result).toEqual({
      error:
        'Invalid thinking level "turbo". Valid levels: off, minimal, low, medium, high, xhigh, max.',
    });
  });

  it("resolves a recognized thinking param", () => {
    const result = resolveSpawnConfig(
      { subagent_type: "Explore", prompt: "test", description: "d", thinking: "xhigh" },
      testRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) throw new Error(result.error);
    expect(result.execution.thinking).toBe("xhigh");
  });
});

describe("resolveSpawnConfig — minimum turns note", () => {
  const MINIMUM_NOTE =
    "Note: max_turns 1 is below the minimum of 2 (one turn to work, one to answer), so the subagent runs with 2.";

  it("notes a max_turns parameter below the minimum and runs with 2", () => {
    const result = resolveSpawnConfig(
      { subagent_type: "Explore", prompt: "test", description: "d", max_turns: 1 },
      testRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) throw new Error(result.error);
    expect(result.notes).toEqual([MINIMUM_NOTE]);
    expect(result.execution.effectiveMaxTurns).toBe(2);
  });

  it("notes an agent file's max_turns below the minimum", () => {
    const registry = registryWithGeneral(
      () =>
        new Map([
          ["terse", { name: "terse", description: "Terse", systemPrompt: "", toolsDeclared: false, disallowedTools: [], maxTurns: 1 }],
        ]),
    );
    const result = resolveSpawnConfig(
      { subagent_type: "terse", prompt: "test", description: "d" },
      registry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) throw new Error(result.error);
    expect(result.notes).toEqual([MINIMUM_NOTE]);
  });

  it("adds no note at the minimum", () => {
    const result = resolveSpawnConfig(
      { subagent_type: "Explore", prompt: "test", description: "d", max_turns: 2 },
      testRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) throw new Error(result.error);
    expect(result.notes).toEqual([]);
  });
});

describe("resolveSpawnConfig — notes", () => {
  it("carries no note for a known agent type", () => {
    const result = resolveSpawnConfig(
      { subagent_type: "Explore", prompt: "test", description: "d" },
      testRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) return;
    expect(result.notes).toEqual([]);
  });

  it("carries a lock note naming the discarded parameters", () => {
    const lockedRegistry = registryWithGeneral(
      () =>
        new Map([
          [
            "pinned",
            {
              name: "pinned",
              description: "Pinned",
              systemPrompt: "",
              promptMode: "append" as const,
              toolsDeclared: false,
              disallowedTools: [],
              model: "provider/pinned",
              maxTurns: 7,
              locked: true as const,
            },
          ],
        ]),
    );
    const result = resolveSpawnConfig(
      {
        subagent_type: "pinned",
        prompt: "test",
        description: "d",
        model: "other",
        max_turns: 3,
      },
      lockedRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) throw new Error(result.error);
    expect(result.notes).toEqual([
      'Note: agent "pinned" locks model, max_turns, so those parameters were ignored.',
    ]);
  });

  it("names a single discarded parameter in the singular", () => {
    const lockedRegistry = registryWithGeneral(
      () =>
        new Map([
          [
            "pinned",
            {
              name: "pinned",
              description: "Pinned",
              systemPrompt: "",
              promptMode: "append" as const,
              toolsDeclared: false,
              disallowedTools: [],
              model: "provider/pinned",
              locked: ["model"] as const,
            },
          ],
        ]),
    );
    const result = resolveSpawnConfig(
      { subagent_type: "pinned", prompt: "test", description: "d", model: "other" },
      lockedRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) throw new Error(result.error);
    expect(result.notes).toEqual([
      'Note: agent "pinned" locks model, so the model parameter was ignored.',
    ]);
  });

  it("carries the unknown-type note when the type fell back", () => {
    const result = resolveSpawnConfig(
      { subagent_type: "unknown-type", prompt: "test", description: "d" },
      testRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) return;
    expect(result.notes).toEqual([
      'Note: Unknown agent type "unknown-type" — using general.',
    ]);
  });

  it("reports the fallback before the lock when a project pins the fallback agent", () => {
    const pinnedFallback = registryWithGeneral(
      () =>
        new Map([
          [
            "general",
            {
              name: "general",
              description: "Pinned general",
              systemPrompt: "",
              promptMode: "append" as const,
              toolsDeclared: false,
              disallowedTools: [],
              maxTurns: 7,
              locked: true as const,
            },
          ],
        ]),
    );
    const result = resolveSpawnConfig(
      { subagent_type: "unknown-type", prompt: "test", description: "d", max_turns: 3 },
      pinnedFallback,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) throw new Error(result.error);
    expect(result.notes).toEqual([
      'Note: Unknown agent type "unknown-type" — using general.',
      'Note: agent "general" locks max_turns, so the max_turns parameter was ignored.',
    ]);
  });
});

describe("resolveSpawnConfig — prompt and rawType passthrough", () => {
  it("passes through prompt and rawType", () => {
    const result = resolveSpawnConfig(
      { subagent_type: "Explore", prompt: "search for bugs", description: "bug search" },
      testRegistry,
      makeModelInfo(),
      defaultSettings,
    );
    if ("error" in result) return;
    expect(result.execution.prompt).toBe("search for bugs");
    expect(result.identity.rawType).toBe("Explore");
  });
});

describe("resolveSpawnConfig — fork model and thinking", () => {
  const parentModel = makeModel({ id: "parent-m", name: "Parent", provider: "p" });
  const agentModel = makeModel({ id: "agent-m", name: "Agent", provider: "a" });
  const modelRegistry = {
    find: (provider: string, id: string) => [parentModel, agentModel].find((m) => m.provider === provider && m.id === id),
    getAll: () => [parentModel, agentModel],
    getAvailable: () => [parentModel, agentModel],
  };
  const registryOf = (locked?: true) =>
    registryWithGeneral(
      () =>
        new Map([
          [
            "Forker",
            makeAgentConfig({ name: "Forker", model: "a/agent-m", thinking: "low", context: "fork", locked }),
          ],
        ]),
    );

  it("Agent default ignored: an unlocked agent model and thinking do not apply to a fork", () => {
    const result = resolveSpawnConfig(
      { subagent_type: "Forker", prompt: "t", description: "d" },
      registryOf(),
      { parentModel, modelRegistry },
      defaultSettings,
    );
    if ("error" in result) throw new Error(result.error);
    expect(result.execution.context).toBe("fork");
    expect(result.execution.model).toBe(parentModel);
    expect(result.execution.thinking).toBeUndefined();
  });

  it("Locked agent model applies to a fork", () => {
    const result = resolveSpawnConfig(
      { subagent_type: "Forker", prompt: "t", description: "d" },
      registryOf(true),
      { parentModel, modelRegistry },
      defaultSettings,
    );
    if ("error" in result) throw new Error(result.error);
    expect(result.execution.model).toBe(agentModel);
    expect(result.execution.thinking).toBe("low");
  });

  it("an agent-file fork without a branch runs fresh on the agent default", () => {
    const result = resolveSpawnConfig(
      { subagent_type: "Forker", prompt: "t", description: "d" },
      registryOf(),
      { parentModel, modelRegistry, parentHasBranch: false },
      defaultSettings,
    );
    if ("error" in result) throw new Error(result.error);
    expect(result.execution.context).toBe("fork");
    expect(result.execution.model).toBe(agentModel);
    expect(result.execution.thinking).toBe("low");
  });

  it("a caller model still wins for an agent-file fork without a branch", () => {
    const result = resolveSpawnConfig(
      { subagent_type: "Forker", prompt: "t", description: "d", model: "p/parent-m", thinking: "high" },
      registryOf(),
      { parentModel, modelRegistry, parentHasBranch: false },
      defaultSettings,
    );
    if ("error" in result) throw new Error(result.error);
    expect(result.execution.model).toBe(parentModel);
    expect(result.execution.thinking).toBe("high");
  });

  it("a caller fork without a branch keeps fork resolution (the manager refuses it)", () => {
    const result = resolveSpawnConfig(
      { subagent_type: "Forker", prompt: "t", description: "d", context: "fork" },
      registryOf(),
      { parentModel, modelRegistry, parentHasBranch: false },
      defaultSettings,
    );
    if ("error" in result) throw new Error(result.error);
    expect(result.execution.model).toBe(parentModel);
  });

  it("a fresh launch of the same agent keeps its defaults", () => {
    const result = resolveSpawnConfig(
      { subagent_type: "Forker", prompt: "t", description: "d", context: "fresh" },
      registryOf(),
      { parentModel, modelRegistry },
      defaultSettings,
    );
    if ("error" in result) throw new Error(result.error);
    expect(result.execution.model).toBe(agentModel);
    expect(result.execution.thinking).toBe("low");
  });
});
