import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateSessionOptions } from "#src/lifecycle/create-subagent-session";
import { createSubagentSession } from "#src/lifecycle/create-subagent-session";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";
import {
  createAgentLookup,
  createChildLifecycleMock,
  createSubagentSessionDeps,
  createSubagentSessionIO,
} from "#test/helpers/subagent-session-io";

const TASK = "TASK-MARKER do the thing";

/** The system prompt and first user message of the request a child sent. */
interface ChildRequest {
  system: string;
  firstUser: string;
}

/** A loopback `openai-completions` endpoint that records request bodies and replies "ok". */
async function startLoopback(): Promise<{ url: string; bodies: unknown[]; close: () => Promise<void> }> {
  const bodies: unknown[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      bodies.push(JSON.parse(raw));
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
    bodies,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/**
 * Runs the production factory with the real `DefaultResourceLoader` and a real
 * `createAgentSession` turn against a loopback provider, so `before_agent_start`
 * fires. The request the child sent is what the model sees.
 */
describe("fresh child prompt (real SDK loader)", () => {
  let root: string;
  let projectDir: string;
  let agentDir: string;
  let loopback: Awaited<ReturnType<typeof startLoopback>>;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "fresh-prompt-"));
    projectDir = join(root, "project");
    agentDir = join(root, "agent");
    mkdirSync(join(projectDir, ".pi"), { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(projectDir, "AGENTS.md"), "AGENTS-MARKER project rules\n");
    writeFileSync(join(projectDir, ".pi", "APPEND_SYSTEM.md"), "APPEND-MARKER appended\n");
    loopback = await startLoopback();
  });

  afterEach(async () => {
    await loopback.close();
    rmSync(root, { recursive: true, force: true });
  });

  /** Create a fresh child for an agent whose body is `body`, run one turn, return what it sent. */
  async function freshChildRequest(body: string): Promise<ChildRequest> {
    const runtime = await ModelRuntime.create({
      authPath: join(agentDir, "auth.json"),
      modelsPath: join(agentDir, "models.json"),
    });
    runtime.registerProvider("loop", {
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
    const model = runtime.getModel("loop", "m");
    const io = createSubagentSessionIO();
    io.getAgentDir.mockReturnValue(agentDir);
    io.createSettingsManager.mockImplementation(() => SettingsManager.create(projectDir, agentDir));
    io.createSessionManager.mockImplementation(() => SessionManager.inMemory(projectDir));
    io.createResourceLoader.mockImplementation((opts) => new DefaultResourceLoader(opts));
    let session: AgentSession | undefined;
    io.createSession.mockImplementation(async (opts: CreateSessionOptions) => {
      const created = await createAgentSession({
        cwd: opts.cwd,
        agentDir: opts.agentDir,
        sessionManager: opts.sessionManager as SessionManager,
        settingsManager: opts.settingsManager,
        resourceLoader: opts.resourceLoader as DefaultResourceLoader,
        modelRuntime: runtime,
        model,
        tools: [],
      });
      session = created.session;
      return { session: created.session };
    });
    const registry = createAgentLookup({ name: "fresh-agent", systemPrompt: body });

    await createSubagentSession(
      {
        agentId: "a1",
        snapshot: { ...STUB_SNAPSHOT, cwd: projectDir, systemPrompt: "PARENT-MARKER" },
        type: "fresh-agent",
        cwd: projectDir,
      },
      createSubagentSessionDeps({ io, exec: vi.fn(), registry, lifecycle: createChildLifecycleMock() }),
    );
    if (!session) throw new Error("factory did not create a session");
    await session.bindExtensions({});
    await session.prompt(TASK);

    const request = loopback.bodies[0] as { messages: { role: string; content: unknown }[] };
    const text = (content: unknown) =>
      typeof content === "string"
        ? content
        : (content as { text: string }[]).map((part) => part.text).join("");
    return {
      system: text(request.messages.find((m) => m.role === "system")?.content),
      firstUser: text(request.messages.find((m) => m.role === "user")?.content),
    };
  }

  it("ends with the agent section, body last, header before it", async () => {
    const { system } = await freshChildRequest("BODY-MARKER");
    expect(system.trimEnd().endsWith("BODY-MARKER\n</agent>")).toBe(true);
    expect(system.lastIndexOf("<agent>")).toBeGreaterThan(system.lastIndexOf("<cwd>"));
    expect(system.indexOf('<active_agent name="fresh-agent"/>')).toBeLessThan(system.indexOf("BODY-MARKER"));
  });

  it("carries the project instructions for the child's directory before the body", async () => {
    const { system } = await freshChildRequest("BODY-MARKER");
    expect(system).toContain("AGENTS-MARKER");
    expect(system.indexOf("AGENTS-MARKER")).toBeLessThan(system.indexOf("BODY-MARKER"));
  });

  it("applies the append file exactly once", async () => {
    const { system } = await freshChildRequest("BODY-MARKER");
    expect(system.split("APPEND-MARKER").length - 1).toBe(1);
  });

  it("carries no parent identity", async () => {
    const { system } = await freshChildRequest("BODY-MARKER");
    expect(system).not.toContain("PARENT-MARKER");
  });

  it("sends the task as the first user message, unchanged", async () => {
    const { firstUser } = await freshChildRequest("BODY-MARKER");
    expect(firstUser).toBe(TASK);
  });
});
