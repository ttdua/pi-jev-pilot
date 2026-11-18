/**
 * A fork through the production factory, the real `DefaultResourceLoader` and
 * a real `createAgentSession`, against a loopback `openai-completions`
 * provider. The parent runs one real turn first; its request is what the fork
 * must extend.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  type ExtensionFactory,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateSessionOptions } from "#src/lifecycle/create-subagent-session";
import { createSubagentSession } from "#src/lifecycle/create-subagent-session";
import { FORK_SESSION_HEADERS } from "#src/lifecycle/fork-guard";
import { buildParentSnapshot } from "#src/lifecycle/parent-snapshot";
import { createForkSessionManager } from "#src/session/fork-session-manager";
import { createChildLifecycleMock, createSubagentSessionDeps, createSubagentSessionIO, createAgentLookup } from "#test/helpers/subagent-session-io";

interface Request {
  body: { messages: { role: string; content: unknown }[]; tools?: unknown };
  headers: IncomingHttpHeaders;
}

/** Loopback endpoint recording each request and replying "ok". */
async function startLoopback() {
  const requests: Request[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      requests.push({ body: JSON.parse(raw), headers: req.headers });
      res.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = (delta: object, finish: string | null) =>
        `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      res.write(chunk({ role: "assistant", content: "ok" }, null));
      res.write(chunk({}, "stop"));
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A tool the parent registers through the SDK: the child's loader has no definition of it. */
const SDK_TOOL = defineTool({
  name: "parent_sdk_tool",
  label: "parent_sdk_tool",
  description: "A tool only the parent has.",
  parameters: Type.Object({ q: Type.String() }),
  execute: async () => ({ content: [{ type: "text" as const, text: "PARENT-RAN" }], details: undefined }),
});

/** A tool from an extension the child's loader does not load. */
const EXTENSION_TOOL = "parent_ext_tool";
const parentOnlyExtension: ExtensionFactory = (pi) => {
  pi.registerTool({
    name: EXTENSION_TOOL,
    label: EXTENSION_TOOL,
    description: "A tool from an excluded package.",
    parameters: Type.Object({ n: Type.Number() }),
    execute: async () => ({ content: [{ type: "text" as const, text: "PARENT-EXT-RAN" }], details: undefined }),
  });
};

describe("fork child (real SDK loader and session)", () => {
  let root: string;
  let cwd: string;
  let childCwd: string;
  let agentDir: string;
  let loopback: Awaited<ReturnType<typeof startLoopback>>;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "fork-prompt-"));
    cwd = join(root, "project");
    agentDir = join(root, "agent");
    childCwd = join(root, "child");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(childCwd, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(cwd, "AGENTS.md"), "PROJECT-MARKER rules\n");
    loopback = await startLoopback();
  });

  afterEach(async () => {
    await loopback.close();
    rmSync(root, { recursive: true, force: true });
  });

  async function runtime() {
    const rt = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
    rt.registerProvider("loop", {
      baseUrl: loopback.url,
      api: "openai-completions",
      apiKey: "test-key",
      models: [
        {
          id: "m",
          name: "m",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 8000,
          maxTokens: 1000,
        },
      ],
    });
    return { rt, model: rt.getModel("loop", "m") };
  }

  /** Run one parent turn, then fork it; return the parent, the fork, and the factory's mocks. */
  async function parentThenFork(opts: { parentOnly?: boolean; grants?: string[]; onToolFacts?: (f: unknown) => void } = {}) {
    const { rt, model } = await runtime();
    const settings = SettingsManager.create(cwd, agentDir);
    const parentLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager: settings,
      noExtensions: true,
      noSkills: true,
      extensionFactories: opts.parentOnly ? [parentOnlyExtension] : [],
    });
    await parentLoader.reload();
    const parentManager = SessionManager.inMemory(cwd);
    const { session: parent } = await createAgentSession({
      cwd,
      agentDir,
      modelRuntime: rt,
      model,
      sessionManager: parentManager,
      settingsManager: settings,
      resourceLoader: parentLoader,
      tools: opts.parentOnly ? ["read", "grep", "edit", SDK_TOOL.name, EXTENSION_TOOL] : ["read", "grep", "edit"],
      customTools: opts.parentOnly ? [SDK_TOOL] : [],
    });
    await parent.bindExtensions({});
    await parent.prompt("PARENT-TURN-MARKER");

    const snapshot = buildParentSnapshot(
      {
        cwd,
        model,
        modelRegistry: { find: () => undefined, getAll: () => [] },
        getSystemPrompt: () => parent.systemPrompt,
        sessionManager: parentManager,
      },
      "fork",
      parent.getActiveToolNames().flatMap((name) => parent.getAllTools().filter((tool) => tool.name === name)),
    );

    const io = createSubagentSessionIO();
    io.getAgentDir.mockReturnValue(agentDir);
    io.createSettingsManager.mockImplementation(() => SettingsManager.create(cwd, agentDir));
    io.createResourceLoader.mockImplementation((opts) => new DefaultResourceLoader({ ...opts, noExtensions: true, noSkills: true }));
    io.deriveSessionDir.mockReturnValue(join(root, "sessions"));
    io.createForkSessionManager.mockImplementation(createForkSessionManager);
    let fork: AgentSession | undefined;
    io.createSession.mockImplementation(async (opts: CreateSessionOptions) => {
      const created = await createAgentSession({
        cwd: opts.cwd,
        agentDir: opts.agentDir,
        sessionManager: opts.sessionManager as SessionManager,
        settingsManager: opts.settingsManager,
        resourceLoader: opts.resourceLoader as DefaultResourceLoader,
        modelRuntime: rt,
        model,
        tools: opts.tools,
        excludeTools: opts.excludeTools,
        customTools: opts.customTools,
      });
      fork = created.session;
      return { session: created.session };
    });
    const sub = await createSubagentSession(
      {
        agentId: "a1",
        snapshot,
        type: "Explore",
        context: "fork",
        task: "FORK-TASK",
        // An isolated child: its own loader would render another <cwd> and no project marker.
        cwd: childCwd,
        askParent: vi.fn(),
        tools: opts.grants ? { toolNames: ["read"], grants: opts.grants, removed: [] } : undefined,
        onToolFacts: opts.onToolFacts,
        parentSession: { parentSessionId: parentManager.getSessionId() },
      },
      createSubagentSessionDeps({
        io,
        registry: createAgentLookup({ toolNames: ["read"] }),
        lifecycle: createChildLifecycleMock(),
        listParentToolNames: () => parent.getActiveToolNames(),
      }),
    );
    if (!fork) throw new Error("factory did not create a session");
    return { parent, parentManager, fork, sub };
  }

  it("sends the parent's system message and tools byte-identically, and extends its messages", async () => {
    const { fork, sub } = await parentThenFork();
    await sub.runTurnLoop("FORK-TASK", {});

    const [parentRequest, forkRequest] = loopback.requests;
    expect(JSON.stringify(forkRequest!.body.messages[0])).toBe(JSON.stringify(parentRequest!.body.messages[0]));
    expect(JSON.stringify(forkRequest!.body.tools)).toBe(JSON.stringify(parentRequest!.body.tools));
    const parentMessages = parentRequest!.body.messages;
    expect(JSON.stringify(forkRequest!.body.messages.slice(0, parentMessages.length))).toBe(JSON.stringify(parentMessages));
    expect(fork.getActiveToolNames()).toEqual(["read", "grep", "edit"]);
  });

  it("gets no fresh prompt extension: the system prompt it sends is the parent's", async () => {
    const { parent, sub } = await parentThenFork();
    await sub.runTurnLoop("FORK-TASK", {});
    // What the provider received; Pi resets session.systemPrompt to its base options after a run.
    const system = JSON.stringify(loopback.requests[1]!.body.messages[0]!.content);
    expect(system).toBe(JSON.stringify(parent.systemPrompt));
    expect(system).toContain("PROJECT-MARKER");
    expect(system).not.toContain(childCwd);
    expect(system).not.toContain("<agent>");
  });

  it("sends the parent's prompt again on a second fork turn", async () => {
    const { sub } = await parentThenFork();
    await sub.runTurnLoop("FORK-TASK", {});
    await sub.runTurnLoop("SECOND-TURN", {});

    const [parentRequest, , second] = loopback.requests;
    expect(JSON.stringify(second!.body.messages[0])).toBe(JSON.stringify(parentRequest!.body.messages[0]));
    expect(second!.body.messages.filter((m) => m.role === "system")).toHaveLength(1);
  });

  it("has its own session id and sends the parent's id as the cache-routing key", async () => {
    const { parentManager, fork, sub } = await parentThenFork();
    await sub.runTurnLoop("FORK-TASK", {});

    expect(fork.sessionId).not.toBe(parentManager.getSessionId());
    const headers = loopback.requests[1]!.headers;
    for (const name of FORK_SESSION_HEADERS) expect(headers[name]).toBe(parentManager.getSessionId());
  });

  it("sends the instructions message, then the task, after the copied branch", async () => {
    const { sub } = await parentThenFork();
    await sub.runTurnLoop("FORK-TASK", {});
    const last = loopback.requests[1]!.body.messages.at(-1)!;
    const text = JSON.stringify(last.content);
    expect(last.role).toBe("user");
    expect(text).toContain("<subagent_instructions>");
    expect(text).toContain("FORK-TASK");
    expect(text).toContain(`Working directory: ${childCwd}`);
  });

  it("declares a parent-only tool and an excluded-package tool exactly as the parent does, and refuses them", async () => {
    const onToolFacts = vi.fn();
    const { parent, fork, sub } = await parentThenFork({
      parentOnly: true,
      grants: [SDK_TOOL.name, EXTENSION_TOOL, "grep"],
      onToolFacts,
    });
    await sub.runTurnLoop("FORK-TASK", {});

    const [parentRequest, forkRequest] = loopback.requests;
    expect(JSON.stringify(forkRequest!.body.tools)).toBe(JSON.stringify(parentRequest!.body.tools));
    expect(fork.getActiveToolNames()).toEqual(parent.getActiveToolNames());
    expect(sub.forkGuard?.callable.has(SDK_TOOL.name)).toBe(false);
    expect(sub.forkGuard?.callable.has(EXTENSION_TOOL)).toBe(false);
    expect(sub.forkGuard?.callable.has("read")).toBe(true);
    // Only read and the granted grep run; the stubs and edit count as blocked.
    expect(onToolFacts).toHaveBeenCalledWith({ toolCount: 2, blockedToolCount: 3 });
  });
});
