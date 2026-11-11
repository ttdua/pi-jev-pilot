import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfigLookup } from "#src/config/agent-types";
import type { SubagentManager } from "#src/lifecycle/subagent-manager";
import type { SubagentStatus } from "#src/lifecycle/subagent-state";
import type { Theme } from "#src/ui/display";
import type { FleetAgent } from "#src/ui/fleet-roster";
import { FleetList, type FleetUI, type FleetWidgetFactory } from "#src/ui/fleet-list";
import type { openTranscript } from "#src/ui/session-navigator";
import { makeNavigable } from "#test/helpers/make-navigable";

const NOW = 10_000;
const CWD = "/work";
const DOWN = "\x1b[B";
const UP = "\x1b[A";
const LEFT = "\x1b[D";
const ENTER = "\r";
const ESCAPE = "\x1b";
/** Kitty protocol key release for the down arrow. */
const DOWN_RELEASE = "\x1b[1;1:3B";
const WIDTH = 120;

const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as unknown as Theme;
const registry = {
  resolveAgentConfig: () => ({ name: "Explore", displayName: "Explore" }),
} as unknown as AgentConfigLookup;

type InputResult = { consume?: boolean; data?: string } | undefined;

interface Harness {
  list: FleetList;
  ui: ReturnType<typeof makeUI>;
  tui: ReturnType<typeof makeTui>;
  state: { agents: FleetAgent[]; editorText: string; enabled: boolean };
  open: ReturnType<typeof vi.fn>;
}

/** Fake `ctx.ui`: records widget calls, keeps the latest input handler, serves editor text. */
function makeUI(state: { editorText: string }) {
  const handlers: Array<(data: string) => InputResult> = [];
  const unsubscribes: Array<ReturnType<typeof vi.fn>> = [];
  return {
    setWidget: vi.fn(),
    onTerminalInput: vi.fn((handler: (data: string) => InputResult) => {
      handlers.push(handler);
      const unsubscribe = vi.fn();
      unsubscribes.push(unsubscribe);
      return unsubscribe;
    }),
    getEditorText: () => state.editorText,
    select: vi.fn(),
    notify: vi.fn(),
    custom: vi.fn(),
    send: (data: string): InputResult => handlers[handlers.length - 1](data),
    unsubscribes,
  };
}

/** Fake pi-tui `TUI`: `focus` is whatever component owns the keyboard. */
function makeTui(focus: unknown) {
  const tui = {
    focus,
    getFocusedComponent: () => tui.focus,
    requestRender: vi.fn(),
  };
  return tui;
}

function agent(overrides: Partial<FleetAgent>): FleetAgent {
  return {
    ...makeNavigable({ completedAt: undefined, status: "running" as SubagentStatus }),
    lifetimeUsage: { input: 1_000, output: 500, cacheWrite: 0 },
    ...overrides,
  };
}

function running(id: string, startedAt: number, description: string, overrides: Partial<FleetAgent> = {}): FleetAgent {
  return agent({ id, startedAt, description, status: "running", completedAt: undefined, ...overrides });
}

function finished(id: string, startedAt: number, description: string, completedAt: number): FleetAgent {
  return agent({ id, startedAt, description, status: "completed", completedAt });
}

function setup(options: { agents?: FleetAgent[]; enabled?: boolean; editorText?: string; open?: ReturnType<typeof vi.fn> } = {}): Harness {
  const state = { agents: options.agents ?? [], editorText: options.editorText ?? "", enabled: options.enabled ?? true };
  const ui = makeUI(state);
  const editor = { getText: () => state.editorText, setText: vi.fn() };
  const tui = makeTui(editor);
  const open = options.open ?? vi.fn(async () => {});
  const manager = { listAgents: () => state.agents } as unknown as Pick<SubagentManager, "listAgents">;
  const list = new FleetList({
    manager,
    registry,
    enabled: () => state.enabled,
    cwd: () => CWD,
    readFile: () => "",
    open: open as unknown as typeof openTranscript,
  });
  return { list, ui, tui, state, open };
}

function lastWidgetContent(h: Harness): FleetWidgetFactory | undefined {
  const calls = h.ui.setWidget.mock.calls.filter(([key]) => key === "fleet");
  return calls.length === 0 ? undefined : calls[calls.length - 1][1];
}

/** Pi mounts the widget by calling its factory with the TUI; the test mounts it the same way. */
function mountWidget(h: Harness): { render(width: number): string[] } {
  const content = lastWidgetContent(h);
  if (!content) throw new Error("no fleet widget set");
  return content(h.tui as unknown as Parameters<FleetWidgetFactory>[0], theme);
}

function renderedLines(h: Harness): string[] {
  return mountWidget(h).render(WIDTH);
}

/** The one line carrying the selection marker `●`, if any. */
function markedLine(h: Harness): string | undefined {
  return renderedLines(h).find((line) => line.includes("●"));
}

/** Let pending promise continuations settle (the pane's `finally` runs after the promise resolves). */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

/** A promise the test resolves to close the pane it opened. */
function controllableOpen() {
  let resolveOpen: () => void = () => {};
  const open = vi.fn(() => new Promise<void>((resolve) => (resolveOpen = resolve)));
  return { open, close: () => resolveOpen() };
}

describe("FleetList", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("visibility", () => {
    it("sets the fleet widget below the editor when an agent runs", () => {
      const h = setup({ agents: [running("a1", 1000, "first task")] });

      h.list.setUICtx(h.ui as unknown as FleetUI);
      h.list.update();

      expect(h.ui.setWidget).toHaveBeenCalledWith("fleet", expect.any(Function), { placement: "belowEditor" });
    });

    it("clears it 4 s after the last agent finishes", () => {
      const h = setup({ agents: [running("a1", 1000, "first task")] });
      h.list.setUICtx(h.ui as unknown as FleetUI);
      h.list.update();

      h.state.agents = [finished("a1", 1000, "first task", NOW)];
      vi.advanceTimersByTime(3000);
      expect(lastWidgetContent(h)).toBeDefined();

      vi.advanceTimersByTime(1000);
      expect(lastWidgetContent(h)).toBeUndefined();
      expect(h.ui.setWidget).toHaveBeenLastCalledWith("fleet", undefined);
    });

    it("sets nothing while disabled", () => {
      const h = setup({ agents: [running("a1", 1000, "first task")], enabled: false });

      h.list.setUICtx(h.ui as unknown as FleetUI);
      h.list.update();

      expect(h.ui.setWidget).not.toHaveBeenCalledWith("fleet", expect.any(Function), expect.anything());
    });

    it("clears it when disabled", () => {
      const h = setup({ agents: [running("a1", 1000, "first task")] });
      h.list.setUICtx(h.ui as unknown as FleetUI);
      h.list.update();

      h.state.enabled = false;
      h.list.update();

      expect(h.ui.setWidget).toHaveBeenLastCalledWith("fleet", undefined);
    });
  });

  describe("activation", () => {
    it("↓ at an empty prompt selects the first agent and consumes", () => {
      const h = setup({ agents: [running("a1", 1000, "first task"), running("a2", 2000, "second task")] });
      h.list.setUICtx(h.ui as unknown as FleetUI);
      h.list.update();
      mountWidget(h);

      expect(h.ui.send(DOWN)).toEqual({ consume: true });
      expect(markedLine(h)).toContain("first task");
    });

    it("← activates too", () => {
      const h = setup({ agents: [running("a1", 1000, "first task")] });
      h.list.setUICtx(h.ui as unknown as FleetUI);
      h.list.update();
      mountWidget(h);

      expect(h.ui.send(LEFT)).toEqual({ consume: true });
      expect(markedLine(h)).toContain("first task");
    });

    it("passes ↓ through when the prompt has text", () => {
      const h = setup({ agents: [running("a1", 1000, "first task")], editorText: "fix" });
      h.list.setUICtx(h.ui as unknown as FleetUI);
      h.list.update();
      mountWidget(h);

      expect(h.ui.send(DOWN)).toBeUndefined();
      expect(markedLine(h)).toBeUndefined();
    });

    it("passes ← through when the prompt has text", () => {
      const h = setup({ agents: [running("a1", 1000, "first task")], editorText: "fix" });
      h.list.setUICtx(h.ui as unknown as FleetUI);
      h.list.update();
      mountWidget(h);

      expect(h.ui.send(LEFT)).toBeUndefined();
      expect(markedLine(h)).toBeUndefined();
    });

    it("passes keys through before the TUI is captured", () => {
      const h = setup({ agents: [running("a1", 1000, "first task")] });
      h.list.setUICtx(h.ui as unknown as FleetUI);
      h.list.update();

      expect(h.ui.send(DOWN)).toBeUndefined();
    });

    it("ignores key releases", () => {
      const h = setup({ agents: [running("a1", 1000, "first task")] });
      h.list.setUICtx(h.ui as unknown as FleetUI);
      h.list.update();
      mountWidget(h);

      expect(h.ui.send(DOWN_RELEASE)).toBeUndefined();
      expect(markedLine(h)).toBeUndefined();
    });
  });

  describe("navigation", () => {
    function activeHarness(agents: FleetAgent[]): Harness {
      const h = setup({ agents });
      h.list.setUICtx(h.ui as unknown as FleetUI);
      h.list.update();
      mountWidget(h);
      h.ui.send(DOWN);
      return h;
    }

    it("↓ stops at the last row", () => {
      const h = activeHarness([running("a1", 1000, "first task"), running("a2", 2000, "second task")]);

      h.ui.send(DOWN);
      expect(markedLine(h)).toContain("second task");

      expect(h.ui.send(DOWN)).toEqual({ consume: true });
      expect(markedLine(h)).toContain("second task");
    });

    it("↑ from the first agent selects main", () => {
      const h = activeHarness([running("a1", 1000, "first task")]);

      expect(h.ui.send(UP)).toEqual({ consume: true });
      expect(markedLine(h)).toContain("main");
    });

    it("↑ on main deactivates and consumes", () => {
      const h = activeHarness([running("a1", 1000, "first task")]);
      h.ui.send(UP);

      expect(h.ui.send(UP)).toEqual({ consume: true });
      expect(markedLine(h)).toBeUndefined();
    });

    it("Esc deactivates", () => {
      const h = activeHarness([running("a1", 1000, "first task")]);
      h.ui.send(UP);

      expect(h.ui.send(ESCAPE)).toEqual({ consume: true });
      expect(markedLine(h)).toBeUndefined();
    });

    it("Enter on main deactivates", () => {
      const h = activeHarness([running("a1", 1000, "first task")]);
      h.ui.send(UP);

      expect(h.ui.send(ENTER)).toEqual({ consume: true });
      expect(markedLine(h)).toBeUndefined();
      expect(h.open).not.toHaveBeenCalled();
    });

    it("another key deactivates and passes through", () => {
      const h = activeHarness([running("a1", 1000, "first task")]);

      expect(h.ui.send("a")).toBeUndefined();
      expect(markedLine(h)).toBeUndefined();
    });
  });

  describe("focus guard", () => {
    it("leaves a focused selector's keys alone", () => {
      const h = setup({ agents: [running("a1", 1000, "first task")] });
      h.tui.focus = { choose: vi.fn() };
      h.list.setUICtx(h.ui as unknown as FleetUI);
      h.list.update();
      mountWidget(h);

      expect(h.ui.send(DOWN)).toBeUndefined();
      expect(markedLine(h)).toBeUndefined();
    });

    it("accepts a custom editor with getText and setText", () => {
      const h = setup({ agents: [running("a1", 1000, "first task")] });
      h.tui.focus = { getText: () => "", setText: vi.fn() };
      h.list.setUICtx(h.ui as unknown as FleetUI);
      h.list.update();
      mountWidget(h);

      expect(h.ui.send(DOWN)).toEqual({ consume: true });
    });

    it("deactivates when focus moves away", () => {
      const h = setup({ agents: [running("a1", 1000, "first task")] });
      h.list.setUICtx(h.ui as unknown as FleetUI);
      h.list.update();
      mountWidget(h);
      h.ui.send(DOWN);

      h.tui.focus = { choose: vi.fn() };

      expect(h.ui.send(DOWN)).toBeUndefined();
      expect(markedLine(h)).toBeUndefined();
    });
  });

  describe("open", () => {
    it("Enter on an agent calls open with its navigation entry", () => {
      const { open, close } = controllableOpen();
      const first = running("a1", 1000, "first task");
      const h = setup({ agents: [first], open });
      h.list.setUICtx(h.ui as unknown as FleetUI);
      h.list.update();
      mountWidget(h);
      h.ui.send(DOWN);

      expect(h.ui.send(ENTER)).toEqual({ consume: true });

      expect(open).toHaveBeenCalledWith(h.ui, expect.objectContaining({ kind: "live", record: first }), { cwd: CWD, readFile: expect.any(Function) });
      close();
    });

    it("Enter on an agent with only outputFile opens a snapshot entry", () => {
      const { open, close } = controllableOpen();
      const released = running("a1", 1000, "first task", { isSessionReady: () => false, outputFile: "/tmp/a1.jsonl" });
      const h = setup({ agents: [released], open });
      h.list.setUICtx(h.ui as unknown as FleetUI);
      h.list.update();
      mountWidget(h);
      h.ui.send(DOWN);

      h.ui.send(ENTER);

      expect(open).toHaveBeenCalledWith(h.ui, expect.objectContaining({ kind: "snapshot", outputFile: "/tmp/a1.jsonl" }), expect.anything());
      close();
    });

    it("passes every key through while the pane is open", () => {
      const { open, close } = controllableOpen();
      const h = setup({ agents: [running("a1", 1000, "first task")], open });
      h.list.setUICtx(h.ui as unknown as FleetUI);
      h.list.update();
      mountWidget(h);
      h.ui.send(DOWN);
      h.ui.send(ENTER);

      expect(h.ui.send(DOWN)).toBeUndefined();
      expect(h.ui.send(ENTER)).toBeUndefined();
      expect(h.ui.send(ESCAPE)).toBeUndefined();
      close();
    });

    it("keeps the viewed agent listed while its pane is open", async () => {
      const { open, close } = controllableOpen();
      const h = setup({ agents: [finished("a1", 1000, "first task", NOW)], open });
      h.list.setUICtx(h.ui as unknown as FleetUI);
      h.list.update();
      mountWidget(h);
      h.ui.send(DOWN);
      h.ui.send(ENTER);

      vi.advanceTimersByTime(5000);

      expect(renderedLines(h).join("\n")).toContain("first task");
      close();
      await flush();
    });

    it("reselects the viewed agent by id after close", async () => {
      const { open, close } = controllableOpen();
      const h = setup({
        agents: [
          finished("a1", 1000, "first task", NOW),
          running("a2", 2000, "second task"),
          running("a3", 3000, "third task"),
        ],
        open,
      });
      h.list.setUICtx(h.ui as unknown as FleetUI);
      h.list.update();
      mountWidget(h);
      h.ui.send(DOWN);
      h.ui.send(DOWN);
      h.ui.send(DOWN);
      h.ui.send(ENTER);

      vi.advanceTimersByTime(5000);
      close();
      await flush();

      expect(markedLine(h)).toContain("third task");
    });

    it("keeps a valid selection when the viewed agent is gone", async () => {
      const { open, close } = controllableOpen();
      const a1 = running("a1", 1000, "first task");
      const a2 = running("a2", 2000, "second task");
      const h = setup({ agents: [a1, a2], open });
      h.list.setUICtx(h.ui as unknown as FleetUI);
      h.list.update();
      mountWidget(h);
      h.ui.send(DOWN);
      h.ui.send(DOWN);
      h.ui.send(ENTER);

      h.state.agents = [a1];
      close();
      await flush();

      expect(markedLine(h)).toContain("first task");
    });
  });

  describe("observer", () => {
    it.each(["onSubagentCreated", "onSubagentRunStarted", "onSubagentRunFinished"] as const)(
      "%s refreshes",
      (hook) => {
        const h = setup();
        h.list.setUICtx(h.ui as unknown as FleetUI);
        h.list.update();
        expect(h.ui.setWidget).not.toHaveBeenCalledWith("fleet", expect.any(Function), expect.anything());

        h.state.agents = [running("a1", 1000, "first task")];
        h.list[hook]();

        expect(h.ui.setWidget).toHaveBeenCalledWith("fleet", expect.any(Function), { placement: "belowEditor" });
      },
    );

    it("onSubagentCompacted changes nothing", () => {
      const h = setup({ agents: [running("a1", 1000, "first task")] });
      h.list.setUICtx(h.ui as unknown as FleetUI);
      h.list.update();
      const callsBefore = h.ui.setWidget.mock.calls.length;

      h.list.onSubagentCompacted();

      expect(h.ui.setWidget.mock.calls.length).toBe(callsBefore);
      expect(h.tui.requestRender).not.toHaveBeenCalled();
    });
  });

  describe("lifecycle", () => {
    it("replaces its input listener on a second setUICtx", () => {
      const h = setup({ agents: [running("a1", 1000, "first task")] });
      const second = makeUI(h.state);
      h.list.setUICtx(h.ui as unknown as FleetUI);
      h.list.setUICtx(second as unknown as FleetUI);

      expect(h.ui.unsubscribes[0]).toHaveBeenCalledOnce();
      expect(second.unsubscribes[0]).not.toHaveBeenCalled();
    });

    it("runs the 1 s timer while an agent is running with no row yet", () => {
      const h = setup({ agents: [running("a1", 1000, "first task", { isSessionReady: () => false })] });
      h.list.setUICtx(h.ui as unknown as FleetUI);
      h.list.update();

      expect(vi.getTimerCount()).toBe(1);
      expect(lastWidgetContent(h)).toBeUndefined();
    });

    it("shows the row once the session becomes ready, without a run event", () => {
      let ready = false;
      const h = setup({ agents: [running("a1", 1000, "first task", { isSessionReady: () => ready })] });
      h.list.setUICtx(h.ui as unknown as FleetUI);
      h.list.update();

      ready = true;
      vi.advanceTimersByTime(1000);

      expect(h.ui.setWidget).toHaveBeenCalledWith("fleet", expect.any(Function), { placement: "belowEditor" });
    });

    it("stops the timer when idle", () => {
      const h = setup({ agents: [running("a1", 1000, "first task")] });
      h.list.setUICtx(h.ui as unknown as FleetUI);
      h.list.update();
      expect(vi.getTimerCount()).toBe(1);

      h.state.agents = [finished("a1", 1000, "first task", NOW - 10_000)];
      vi.advanceTimersByTime(1000);

      expect(vi.getTimerCount()).toBe(0);
    });

    it("dispose clears the widget, the timer and the listener", () => {
      const h = setup({ agents: [running("a1", 1000, "first task")] });
      h.list.setUICtx(h.ui as unknown as FleetUI);
      h.list.update();

      h.list.dispose();

      expect(h.ui.setWidget).toHaveBeenLastCalledWith("fleet", undefined);
      expect(vi.getTimerCount()).toBe(0);
      expect(h.ui.unsubscribes[0]).toHaveBeenCalledOnce();
    });
  });
});
