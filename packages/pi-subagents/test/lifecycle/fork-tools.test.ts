/**
 * Fork tool limits: the callable set, the call-time refusal, the cache-routing
 * rewrite, and the fork path of `createSubagentSession` (declarations stay the
 * parent's; grants only widen the callable set).
 */
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createSubagentSession } from "#src/lifecycle/create-subagent-session";
import {
  FORK_SESSION_HEADERS,
  forkCallableTools,
  forkGuardExtension,
  type ForkGuardState,
} from "#src/lifecycle/fork-guard";
import { enforceForkGrants } from "#src/seams/grant-check";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";
import {
  createAgentLookup,
  createChildLifecycleMock,
  createFactorySession,
  createSubagentSessionDeps,
  createSubagentSessionIO,
} from "#test/helpers/subagent-session-io";

const PARENT = ["read", "grep", "edit", "bash", "subagent", "get_subagent_result", "steer_subagent"];

describe("forkCallableTools", () => {
  it("an allowlist narrows the callable set to the parent tools it names", () => {
    const { callable } = forkCallableTools({
      agentTools: ["read", "grep"],
      disallowed: [],
      parentTools: ["read", "grep", "edit", "subagent"],
    });
    expect(callable).toEqual(["read", "grep"]);
  });

  it("disallowed_tools: bash is not callable", () => {
    const { callable } = forkCallableTools({ agentTools: ["read", "bash"], disallowed: ["bash"], parentTools: PARENT });
    expect(callable).toEqual(["read"]);
  });

  it("Policy removal refuses: a launch-policy removal (absent from the base tools) is not callable", () => {
    // A removal reaches the fork as the launch plan's base tools without the tool.
    const { callable } = forkCallableTools({ agentTools: ["read", "grep", "bash"], disallowed: [], parentTools: PARENT });
    expect(callable).not.toContain("edit");
  });

  it("the orchestration tools are never callable", () => {
    const { callable } = forkCallableTools({ agentTools: PARENT, disallowed: [], parentTools: PARENT });
    expect(callable).toEqual(["read", "grep", "edit", "bash"]);
  });

  it("names the tools the agent allows but the parent lacks", () => {
    const { agentOnly } = forkCallableTools({
      agentTools: ["read", "web_search", "subagent"],
      disallowed: [],
      parentTools: ["read"],
    });
    expect(agentOnly).toEqual(["web_search"]);
  });
});

/** Run an extension factory against a fake `pi` and return its handlers by event. */
function handlersOf(factory: ExtensionFactory) {
  const handlers = new Map<string, (event: any) => unknown>();
  const pi = { on: (event: string, handler: (event: any) => unknown) => handlers.set(event, handler) };
  void factory(pi as unknown as ExtensionAPI);
  return handlers;
}

function guardState(callable: string[] = ["read"]): ForkGuardState {
  return { callable: new Set(callable), parentSessionId: "parent-id", systemPrompt: "PARENT-PROMPT" };
}

describe("forkGuardExtension", () => {
  it("refuses a call to a tool outside the callable set", () => {
    const toolCall = handlersOf(forkGuardExtension(guardState()))
      .get("tool_call")!;
    expect(toolCall({ toolName: "edit" })).toEqual({
      block: true,
      reason: 'Tool "edit" is not available to this subagent.',
    });
    expect(toolCall({ toolName: "subagent" })).toEqual({
      block: true,
      reason: 'Tool "subagent" is not available to this subagent.',
    });
    expect(toolCall({ toolName: "read" })).toBeUndefined();
  });

  it("reads the callable set live, so a grant checked after bind is honoured", () => {
    const state = guardState();
    const toolCall = handlersOf(forkGuardExtension(state)).get("tool_call")!;
    state.callable.add("edit");
    expect(toolCall({ toolName: "edit" })).toBeUndefined();
  });

  it("sets every spike-listed session header to the parent id", () => {
    const headers: Record<string, string | null> = { authorization: "Bearer x" };
    handlersOf(forkGuardExtension(guardState())).get("before_provider_headers")!({ headers });
    expect(FORK_SESSION_HEADERS).toEqual([
      "x-session-affinity",
      "x-session-id",
      "session_id",
      "session-id",
      "x-client-request-id",
      "x-affinity",
    ]);
    for (const name of FORK_SESSION_HEADERS) expect(headers[name]).toBe("parent-id");
    expect(headers.authorization).toBe("Bearer x");
  });

  it("rewrites the payload cache keys only when present", () => {
    const request = handlersOf(forkGuardExtension(guardState())).get("before_provider_request")!;
    expect(request({ payload: { model: "m", prompt_cache_key: "fork-id" } })).toEqual({
      model: "m",
      prompt_cache_key: "parent-id",
    });
    expect(request({ payload: { model: "m", promptCacheKey: "fork-id" } })).toEqual({
      model: "m",
      promptCacheKey: "parent-id",
    });
    expect(request({ payload: { model: "m" } })).toBeUndefined();
  });

  it("forces the parent's system prompt on every run", () => {
    const start = handlersOf(forkGuardExtension(guardState())).get("before_agent_start")!;
    expect(start({})).toEqual({ systemPrompt: "PARENT-PROMPT" });
    expect(start({})).toEqual({ systemPrompt: "PARENT-PROMPT" });
  });
});

describe("enforceForkGrants", () => {
  it("adds a registered, model-callable grant to the callable set", () => {
    const state = guardState();
    const granted = enforceForkGrants(state, ["edit"], [{ name: "edit", exposure: "direct" }]);
    expect(granted).toEqual(["edit"]);
    expect(state.callable.has("edit")).toBe(true);
  });

  it("drops a grant the child did not register", () => {
    const state = guardState();
    expect(enforceForkGrants(state, ["web_search"], [{ name: "read", exposure: "direct" }])).toEqual([]);
    expect(state.callable.has("web_search")).toBe(false);
  });

  it("drops a grant registered with an exposure the model cannot call", () => {
    const state = guardState();
    expect(enforceForkGrants(state, ["secret"], [{ name: "secret", exposure: "hidden" }])).toEqual([]);
    expect(state.callable.has("secret")).toBe(false);
  });
});

/** A fork launch through the factory, with a fake SDK session that registers `registered`. */
async function launchFork(opts: {
  agentTools: string[];
  disallowed?: string[];
  grants?: string[];
  registered?: { name: string; exposure: "direct" | "hidden" }[];
}) {
  const io = createSubagentSessionIO();
  const session = createFactorySession();
  let active: string[] = [];
  io.createSession.mockImplementation(async (o: { tools: string[] }) => {
    active = [...o.tools];
    return { session };
  });
  session.getActiveToolNames.mockImplementation(() => [...active]);
  Object.assign(session, {
    getAllTools: () => opts.registered ?? PARENT.map((name) => ({ name, exposure: "direct" })),
  });
  const onToolFacts = vi.fn();
  const lifecycle = createChildLifecycleMock();
  const result = await createSubagentSession(
    {
      agentId: "a1",
      snapshot: { ...STUB_SNAPSHOT, toolNames: PARENT, sessionId: "parent-id", systemPrompt: "PARENT-PROMPT" },
      type: "Explore",
      context: "fork",
      task: "TASK",
      askParent: vi.fn(),
      notifyParent: vi.fn(),
      tools: opts.grants ? { toolNames: opts.agentTools, grants: opts.grants, removed: [] } : undefined,
      onToolFacts,
    },
    createSubagentSessionDeps({
      io,
      lifecycle,
      registry: createAgentLookup({ toolNames: opts.agentTools, disallowedTools: opts.disallowed ?? [] }),
      listParentToolNames: () => PARENT,
    }),
  );
  return { io, session, result, onToolFacts, lifecycle };
}

describe("createSubagentSession: fork path", () => {
  it("declares exactly the parent's tools, with no protocol tools and no denylist", async () => {
    const { io } = await launchFork({ agentTools: ["read", "grep"] });
    const opts = io.createSession.mock.calls[0]![0];
    expect(opts.tools).toEqual(PARENT);
    expect(opts.customTools).toEqual([]);
    expect(opts.excludeTools).toEqual([]);
    expect(opts.tools).not.toContain("ask_parent");
    expect(opts.tools).not.toContain("notify_parent");
  });

  it("disallowed_tools: bash stays declared but is not callable", async () => {
    const { io, result } = await launchFork({ agentTools: ["read", "bash"], disallowed: ["bash"] });
    expect(io.createSession.mock.calls[0]![0].tools).toContain("bash");
    expect(result.forkGuard?.callable.has("bash")).toBe(false);
    expect(result.forkGuard?.callable.has("read")).toBe(true);
  });

  it("keeps the declarations after bind and after the grant check", async () => {
    const { session, result } = await launchFork({ agentTools: ["read"], grants: ["edit"] });
    expect(session.getActiveToolNames()).toEqual(PARENT);
    expect(session.setActiveToolsByName).not.toHaveBeenCalled();
    expect(result.forkGuard?.callable.has("edit")).toBe(true);
  });

  it("a granted parent tool the child did not register is not callable nor granted", async () => {
    const { result, lifecycle } = await launchFork({
      agentTools: ["read"],
      grants: ["edit"],
      registered: [{ name: "read", exposure: "direct" }],
    });
    expect(result.forkGuard?.callable.has("edit")).toBe(false);
    expect(lifecycle.bound.mock.calls[0]![0].grantedTools).toEqual([]);
  });

  it("a granted tool registered with a non-callable exposure is not added", async () => {
    const { result, lifecycle } = await launchFork({
      agentTools: ["read"],
      grants: ["edit"],
      registered: [{ name: "edit", exposure: "hidden" }],
    });
    expect(result.forkGuard?.callable.has("edit")).toBe(false);
    expect(lifecycle.bound.mock.calls[0]![0].grantedTools).toEqual([]);
  });

  it("installs the fork guard and not the fresh prompt extension", async () => {
    const { io } = await launchFork({ agentTools: ["read"] });
    const loaderOpts = io.createResourceLoader.mock.calls[0]![0];
    expect(loaderOpts.systemPromptOverride).toBeUndefined();
    const names = (loaderOpts.extensionFactories ?? []).map((ext: any) => handlersOf(typeof ext === "function" ? ext : ext.factory));
    const events = names.flatMap((handlers: Map<string, unknown>) => [...handlers.keys()]);
    expect(events).toContain("tool_call");
    expect(events.filter((e: string) => e === "before_agent_start")).toHaveLength(1);
  });

  it("counts the callable set as tools and the rest of the total as blocked", async () => {
    const { onToolFacts } = await launchFork({ agentTools: ["read", "grep"] });
    expect(onToolFacts).toHaveBeenCalledWith({ toolCount: 2, blockedToolCount: PARENT.length - 2 });
  });

  it("Refused fork tool is blocked: a declared edit outside the callable set counts as blocked", async () => {
    const { onToolFacts, result } = await launchFork({ agentTools: ["read"] });
    expect(result.forkGuard?.callable.has("edit")).toBe(false);
    expect(onToolFacts).toHaveBeenCalledWith({ toolCount: 1, blockedToolCount: PARENT.length - 1 });
  });

  it("removes the fork transcript when the launch fails after the file exists", async () => {
    const io = createSubagentSessionIO();
    io.createSession.mockRejectedValue(new Error("boom"));
    await expect(
      createSubagentSession(
        {
          agentId: "a1",
          snapshot: { ...STUB_SNAPSHOT, toolNames: PARENT, sessionId: "parent-id" },
          type: "Explore",
          context: "fork",
          task: "TASK",
        },
        createSubagentSessionDeps({ io, registry: createAgentLookup({ toolNames: ["read"] }), listParentToolNames: () => PARENT }),
      ),
    ).rejects.toThrow("boom");
    expect(io.removeSessionFile).toHaveBeenCalledWith("/sessions/fork.jsonl");
  });

  it("keeps a fresh child's file when its launch fails", async () => {
    const io = createSubagentSessionIO();
    io.createSession.mockRejectedValue(new Error("boom"));
    await expect(
      createSubagentSession(
        { agentId: "a1", snapshot: STUB_SNAPSHOT, type: "Explore", context: "fresh" },
        createSubagentSessionDeps({ io, registry: createAgentLookup({ toolNames: ["read"] }) }),
      ),
    ).rejects.toThrow("boom");
    expect(io.removeSessionFile).not.toHaveBeenCalled();
  });

  it("registers only the fork's own id on every lifecycle event, never the parent's", async () => {
    const { lifecycle } = await launchFork({ agentTools: ["read"] });
    expect(lifecycle.sessionCreated.mock.calls[0]![0].sessionId).toBe("fork-session-id");
    expect(lifecycle.bound.mock.calls[0]![0].sessionId).toBe("fork-session-id");
    expect(JSON.stringify([lifecycle.sessionCreated.mock.calls, lifecycle.bound.mock.calls])).not.toMatch(/"sessionId":"parent-id"/);
  });

  it("publishes context fork on session-created", async () => {
    const { lifecycle } = await launchFork({ agentTools: ["read"] });
    expect(lifecycle.sessionCreated.mock.calls[0]![0]).toEqual(expect.objectContaining({ context: "fork" }));
  });
});

describe("createSubagentSession: fork model and thinking without a policy", () => {
  const parentModel = { provider: "p", id: "parent-model" } as never;
  const agentModel = { provider: "a", id: "agent-model" } as never;
  const registryWithModels = {
    find: (provider: string) => (provider === "a" ? agentModel : provider === "p" ? parentModel : undefined),
    getAll: () => [agentModel, parentModel],
  };

  async function forkWith(agent: Record<string, unknown>, params: Record<string, unknown> = {}) {
    const io = createSubagentSessionIO();
    io.createSession.mockResolvedValue({ session: createFactorySession() });
    await createSubagentSession(
      {
        agentId: "a1",
        snapshot: {
          ...STUB_SNAPSHOT,
          model: parentModel,
          thinking: "high",
          modelRegistry: registryWithModels,
          toolNames: ["read"],
          branch: [],
        },
        type: "Explore",
        context: "fork",
        task: "T",
        ...params,
      },
      createSubagentSessionDeps({ io, registry: createAgentLookup({ toolNames: ["read"], ...agent }) }),
    );
    return io.createSession.mock.calls[0]![0] as { model?: unknown; thinkingLevel?: string };
  }

  it("Agent default ignored: an unlocked agent model and thinking do not apply", async () => {
    const opts = await forkWith({ model: "a/agent-model", thinking: "low" });
    expect(opts.model).toBe(parentModel);
    expect(opts.thinkingLevel).toBe("high");
  });

  it("Locked agent values apply", async () => {
    const opts = await forkWith({ model: "a/agent-model", thinking: "low", locked: true });
    expect(opts.model).toBe(agentModel);
    expect(opts.thinkingLevel).toBe("low");
  });

  it("the caller's values apply", async () => {
    const opts = await forkWith({ model: "a/agent-model", thinking: "low" }, { model: agentModel, thinkingLevel: "minimal" });
    expect(opts.model).toBe(agentModel);
    expect(opts.thinkingLevel).toBe("minimal");
  });
});
