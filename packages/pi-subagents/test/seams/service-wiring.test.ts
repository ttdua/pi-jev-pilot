/**
 * Service publication through the real `session_start` / `session_shutdown`
 * handlers `index.ts` registers. Only the SDK session factory is replaced: it
 * announces a child through the extension's own lifecycle publisher, as the
 * real factory does before it binds the child's extensions.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("#src/lifecycle/create-subagent-session", async () => {
  const actual = await vi.importActual<typeof import("#src/lifecycle/create-subagent-session")>(
    "#src/lifecycle/create-subagent-session",
  );
  return {
    ...actual,
    createSubagentSession: vi.fn(async (params: { agentId: string; type: string }, deps: any) => {
      deps.lifecycle.sessionCreated({
        sessionId: `child-of-${params.agentId}`,
        agentId: params.agentId,
        agentType: params.type,
      });
      throw new Error("child not started in this test");
    }),
  };
});

import subagentsExtension from "#src/index";
import { getSubagentsService, unpublishSubagentsService } from "#src/service/service";

function instance() {
  const handlers = new Map<string, Array<(...args: any[]) => unknown>>();
  const pi = {
    registerMessageRenderer: vi.fn(),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    on: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
    events: { emit: vi.fn(), on: vi.fn(() => vi.fn()) },
    appendEntry: vi.fn(),
    sendMessage: vi.fn(),
    exec: vi.fn(),
    getAllTools: vi.fn(() => []),
  } as any;
  subagentsExtension(pi);
  const fire = async (event: string, ...args: any[]) => {
    for (const handler of handlers.get(event) ?? []) await handler(...args);
  };
  const start = (sessionId: string) =>
    fire("session_start", {}, {
      hasUI: false,
      ui: { setStatus: vi.fn(), setWidget: vi.fn() },
      cwd: "/tmp",
      model: undefined,
      modelRegistry: { find: vi.fn(), getAll: () => [], getAvailable: () => [] },
      sessionManager: {
        getSessionId: () => sessionId,
        getSessionFile: () => `/sessions/${sessionId}.jsonl`,
        getBranch: () => [],
      },
      getSystemPrompt: () => "prompt",
    });
  return { start, shutdown: () => fire("session_shutdown", {}, {}) };
}

afterEach(() => {
  unpublishSubagentsService();
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("@ttdua/pi-subagents:children")];
});

describe("service publication through the extension's handlers", () => {
  it("publishes the main session's service from session_start", async () => {
    const main = instance();
    await main.start("main-1");

    expect(getSubagentsService()).toMatchObject({ implementation: "@ttdua/pi-subagents", sessionId: "main-1" });
    await main.shutdown();
  });

  it("children do not replace the main service, and their shutdown leaves it", async () => {
    const main = instance();
    await main.start("main-1");
    const mainService = getSubagentsService();

    // The main instance spawns two children; each announces itself before binding.
    for (const type of ["Explore", "Plan"]) {
      mainService!.spawn(type, "go", { foreground: true });
      await Promise.resolve();
    }
    // Each child's own extension instance then starts and shuts down.
    const childIds = [...(globalThis as any)[Symbol.for("@ttdua/pi-subagents:children")]];
    expect(childIds).toHaveLength(2);
    for (const childId of childIds) {
      const child = instance();
      await child.start(childId);
      await child.shutdown();
    }

    expect(getSubagentsService()).toBe(mainService);
    await main.shutdown();
    expect(getSubagentsService()).toBeUndefined();
  });

  it("shutdown removes only its own service", async () => {
    const first = instance();
    const second = instance();
    await first.start("s1");
    await second.start("s2");
    const secondService = getSubagentsService();

    await first.shutdown();

    expect(getSubagentsService()).toBe(secondService);
    await second.shutdown();
    expect(getSubagentsService()).toBeUndefined();
  });
});
