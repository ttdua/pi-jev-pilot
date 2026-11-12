/**
 * Fleet list wiring through the real `index.ts` factory: UI hand-off, the
 * settings switch, the input listener and shutdown. Only the SDK session
 * factory is replaced.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("#src/lifecycle/create-subagent-session", async () => {
  const actual = await vi.importActual<typeof import("#src/lifecycle/create-subagent-session")>(
    "#src/lifecycle/create-subagent-session",
  );
  return { ...actual, createSubagentSession: vi.fn() };
});

import subagentsExtension from "#src/index";
import { createSubagentSession } from "#src/lifecycle/create-subagent-session";
import { getSubagentsService, unpublishSubagentsService } from "#src/service/service";
import { createMockSession, createSubagentSessionStub, toSubagentSession } from "../helpers/mock-session";

function makePi() {
  const handlers = new Map<string, Array<(...args: any[]) => unknown>>();
  const bus = new EventEmitter();
  const commands = new Map<string, (args: string, ctx: any) => Promise<void>>();
  const pi = {
    registerMessageRenderer: vi.fn(),
    registerTool: vi.fn(),
    registerCommand: vi.fn((name: string, command: { handler: (args: string, ctx: any) => Promise<void> }) => {
      commands.set(name, command.handler);
    }),
    on: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
    events: {
      emit: (channel: string, data: unknown) => bus.emit(channel, data),
      on: (channel: string, handler: (data: unknown) => void) => {
        bus.on(channel, handler);
        return () => bus.off(channel, handler);
      },
    },
    appendEntry: vi.fn(),
    sendMessage: vi.fn(),
    exec: vi.fn(),
    getAllTools: vi.fn(() => []),
  } as any;
  const fire = async (event: string, ...args: any[]) => {
    for (const handler of handlers.get(event) ?? []) await handler(...args);
  };
  return { pi, fire, commands };
}

function makeUI() {
  const unsubscribe = vi.fn();
  return {
    setStatus: vi.fn(),
    setWidget: vi.fn(),
    onTerminalInput: vi.fn(() => unsubscribe),
    getEditorText: () => "",
    unsubscribe,
  };
}

function sessionCtx(ui: ReturnType<typeof makeUI>) {
  return {
    hasUI: true,
    ui,
    cwd: "/tmp",
    model: undefined,
    modelRegistry: { find: vi.fn(), getAvailable: vi.fn(() => []) },
    sessionManager: {
      getSessionId: () => "session-1",
      getSessionFile: () => "/sessions/parent.jsonl",
      getBranch: () => [],
    },
    getSystemPrompt: () => "parent prompt",
  } as any;
}

const fleetCalls = (ui: ReturnType<typeof makeUI>) => ui.setWidget.mock.calls.filter((call) => call[0] === "fleet");

let projectDir: string;

beforeEach(() => {
  vi.useFakeTimers();
  projectDir = mkdtempSync(join(tmpdir(), "pi-fleet-wiring-"));
  vi.spyOn(process, "cwd").mockReturnValue(projectDir);
  vi.mocked(createSubagentSession).mockResolvedValue(
    toSubagentSession(createSubagentSessionStub(createMockSession(), "/sessions/child.jsonl")),
  );
});

afterEach(() => {
  vi.mocked(process.cwd).mockRestore();
  vi.useRealTimers();
  unpublishSubagentsService();
  rmSync(projectDir, { recursive: true, force: true });
});

function writeSettings(settings: object): void {
  mkdirSync(join(projectDir, ".pi"), { recursive: true });
  writeFileSync(join(projectDir, ".pi", "subagents.json"), JSON.stringify(settings));
}

async function startWithAgent() {
  const { pi, fire, commands } = makePi();
  subagentsExtension(pi);
  const ui = makeUI();
  await fire("session_start", {}, sessionCtx(ui));
  getSubagentsService()!.spawn("general-purpose", "hi", { description: "child" });
  await vi.advanceTimersByTimeAsync(1000);
  return { fire, ui, commands };
}

describe("fleet list wiring", () => {
  it("registers the fleet widget below the editor once the spawned agent's session is ready", async () => {
    const { fire, ui } = await startWithAgent();

    expect(fleetCalls(ui).at(-1)).toEqual(["fleet", expect.any(Function), { placement: "belowEditor" }]);

    await fire("session_shutdown", {}, {});
  });

  it("keeps one input listener after two session_start events", async () => {
    const { pi, fire } = makePi();
    subagentsExtension(pi);
    const ui = makeUI();

    await fire("session_start", {}, sessionCtx(ui));
    await fire("session_start", {}, sessionCtx(ui));

    expect(ui.onTerminalInput).toHaveBeenCalledTimes(2);
    expect(ui.unsubscribe).toHaveBeenCalledTimes(1);

    await fire("session_shutdown", {}, {});
  });

  it("sets no fleet widget when fleetView is off in settings", async () => {
    writeSettings({ fleetView: false });

    const { fire, ui } = await startWithAgent();

    expect(fleetCalls(ui)).toEqual([]);

    await fire("session_shutdown", {}, {});
  });

  it("clears the widget when the settings menu turns the view off", async () => {
    const { fire, ui, commands } = await startWithAgent();
    expect(fleetCalls(ui).at(-1)?.[1]).toEqual(expect.any(Function));

    // The real toggle persists and emits `subagents:settings_changed`.
    const settingsUI = { select: async () => "Fleet view (current: on)", notify: vi.fn() };
    await commands.get("subagents:settings")!("", { ui: settingsUI });

    expect(fleetCalls(ui).at(-1)).toEqual(["fleet", undefined]);

    await fire("session_shutdown", {}, {});
  });

  it("removes the input listener on session_shutdown", async () => {
    const { fire, ui } = await startWithAgent();

    await fire("session_shutdown", {}, {});

    expect(ui.unsubscribe).toHaveBeenCalled();
  });
});
