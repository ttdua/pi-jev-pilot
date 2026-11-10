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
import { getSubagentsService, publishSubagentsService, unpublishSubagentsService } from "#src/service/service";

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
});

describe("service publication through the extension's wiring", () => {
  it("Load-time consumer finds the service", () => {
    instance();

    // A companion extension loading after the executor reads the slot at once.
    expect(getSubagentsService()).toMatchObject({ implementation: "@ttdua/pi-subagents" });
  });

  it("names the session at its first session_start, and not before", async () => {
    const main = instance();
    expect(getSubagentsService()?.sessionId).toBe("");

    await main.start("main-1");
    expect(getSubagentsService()?.sessionId).toBe("main-1");

    await main.start("main-2");
    expect(getSubagentsService()?.sessionId).toBe("main-1");
    await main.shutdown();
  });

  it("a later-loaded instance does not replace the main service, and its shutdown leaves it", async () => {
    const main = instance();
    await main.start("main-1");
    const mainService = getSubagentsService();

    // The main instance spawns two children; each loads its own instance.
    for (const type of ["Explore", "Plan"]) {
      mainService!.spawn(type, "go", { foreground: true });
      await Promise.resolve();
      const child = instance();
      await child.start(`child-${type}`);
      await child.shutdown();
    }

    expect(getSubagentsService()).toBe(mainService);
    expect(getSubagentsService()?.sessionId).toBe("main-1");
    await main.shutdown();
    expect(getSubagentsService()).toBeUndefined();
  });

  it("shutdown removes only its own service", async () => {
    const first = instance();
    await first.start("s1");
    const firstService = getSubagentsService();
    // Another implementation's service takes the slot.
    const foreign = { implementation: "@gotgenes/pi-subagents" } as never;
    publishSubagentsService(foreign);

    await first.shutdown();

    expect(getSubagentsService()).toBe(foreign);
    expect(firstService).not.toBe(foreign);
  });
});
