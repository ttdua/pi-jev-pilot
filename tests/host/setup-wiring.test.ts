// Characterization of how `setup` wires the Pi handlers: registration order, the session_start
// step order and its separately guarded steps, the child filter on the turn handlers, the
// shutdown order and the `/jev` command. Written against the code before it was split.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CHILDREN_KEY } from "../../src/host/platform/child.ts";
import { MAIN_CWD_KEY } from "../../src/host/platform/main-cwd.ts";
import type { CutpointWindow } from "../../src/host/worker/index.ts";
import { MAIN_SERVICE_KEY, mainService } from "../../src/host/tools/service.ts";
import { setup } from "../../src/host/setup.ts";
import { startJevFixture } from "../jev/fixture.ts";
import { tempDir } from "../helpers.ts";
import { firing } from "./tuning-fakes.ts";
import { TIERS } from "./worker-fakes.ts";

type Handler = (event: unknown, ctx: unknown) => Promise<unknown> | unknown;
type Slots = Record<symbol, unknown>;

const g = globalThis as Slots;
const EXECUTOR_KEY = Symbol.for("@gotgenes/pi-subagents:service");
const CREATED = "subagents:child:session-created";

function fakePi(log: string[] = []) {
  const handlers = new Map<string, Handler[]>();
  const commands = new Map<string, { description: string; handler: Handler }>();
  const offs: (() => void)[] = [];
  let level = "low";
  const pi = {
    on: (name: string, h: Handler) => {
      log.push(`on:${name}`);
      handlers.set(name, [...(handlers.get(name) ?? []), h]);
    },
    registerCommand: (name: string, def: { description: string; handler: Handler }) => {
      log.push(`command:${name}`);
      commands.set(name, def);
    },
    registerTool: (t: { name: string }) => log.push(`tool:${t.name}`),
    registerEntryRenderer: (type: string) => log.push(`renderer:${type}`),
    appendEntry: () => {},
    getThinkingLevel: () => level,
    setThinkingLevel: (l: string) => {
      level = l;
    },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    getCommands: () => [],
    getAllTools: () => [{ name: "jev_review" }],
    getActiveTools: () => ["read"],
    setActiveTools: () => {},
    events: {
      on: (channel: string, h: (d: unknown) => void) => {
        log.push(`events:${channel}`);
        if (channel === CREATED) created.push(h);
        const off = () => {
          log.push(`off:${channel}`);
        };
        offs.push(off);
        return off;
      },
    },
  };
  const created: ((d: unknown) => void)[] = [];
  return {
    pi: pi as unknown as ExtensionAPI,
    handlers,
    commands,
    log,
    markChild: (id: string) => created.forEach((h) => h({ sessionId: id })),
    fire: (name: string, event: unknown, ctx: unknown) => handlers.get(name)![0]!(event, ctx),
  };
}

let agentDir = "";
const saved = { dir: process.env.PI_CODING_AGENT_DIR, key: process.env.TYPESAFE_API_KEY };

function reset(): void {
  delete g[CHILDREN_KEY];
  delete g[MAIN_SERVICE_KEY];
  delete g[EXECUTOR_KEY];
  delete g[MAIN_CWD_KEY];
}

beforeEach(() => {
  agentDir = tempDir("jev-wiring-");
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.TYPESAFE_API_KEY = "k";
});
afterEach(() => {
  reset();
  rmSync(agentDir, { recursive: true, force: true });
  if (saved.dir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = saved.dir;
  if (saved.key === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = saved.key;
});

/** A context whose every observable step lands in `log`. */
function loggingCtx(id: string, log: string[], over: Record<string, unknown> = {}) {
  return {
    hasUI: true,
    mode: "rpc",
    cwd: agentDir,
    ui: {
      setWidget: () => log.push("draw"),
      notify: () => log.push("tuning"),
    },
    sessionManager: {
      getSessionId: () => {
        log.push("getSessionId");
        return id;
      },
      getBranch: () => [],
    },
    ...over,
  };
}

function writeUnseenTuning(): void {
  const dir = join(agentDir, "jev");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "tuning.json"),
    JSON.stringify({
      version: 1,
      timeoutMs: { value: 1700, base: 1500 },
      history: [{ at: 1000, parameter: "timeoutMs", from: 1500, to: 1700, cause: "rule" }],
    }),
  );
}

/** Records the process-wide slots the session_start steps write, in write order. */
function watchSlots(log: string[]): void {
  Object.defineProperty(g, EXECUTOR_KEY, {
    configurable: true,
    get() {
      log.push("capture");
      return undefined;
    },
  });
  Object.defineProperty(g, MAIN_CWD_KEY, {
    configurable: true,
    set() {
      log.push("setMainCwd");
    },
  });
}

function fakeWindow(log: string[], loadThrows = false): CutpointWindow {
  return {
    load: () => {
      log.push("window.load");
      if (loadThrows) throw new Error("bad ledger");
    },
    add: () => {},
    entries: () => [],
    clear: () => log.push("window.clear"),
  };
}

describe("setup registration", () => {
  test("registers the routing, handlers, review tool, renderer and command in this order", () => {
    const f = fakePi();
    setup(f.pi);
    expect(f.log).toEqual([
      `events:${CREATED}`,
      "events:subagents:child:disposed",
      "on:message_end",
      "on:tool_call",
      "on:tool_result",
      "events:subagents:completed",
      "events:subagents:failed",
      "events:subagents:resumed",
      "on:session_start",
      "tool:jev_review",
      "renderer:jev-log",
      "on:before_agent_start",
      "on:before_provider_request",
      "on:turn_end",
      "on:agent_settled",
      "on:session_shutdown",
      "command:jev",
    ]);
  });

  test("registers each Pi handler exactly once, with the /jev description", () => {
    const f = fakePi();
    setup(f.pi);
    for (const [name, list] of f.handlers) expect([name, list.length]).toEqual([name, 1]);
    expect(f.handlers.size).toBe(9);
    expect(f.commands.size).toBe(1);
    expect(f.commands.get("jev")?.description).toBe("Show or change jev-pilot features");
  });
});

describe("setup session_start", () => {
  test("runs its steps in order on a main session, tuning last", async () => {
    writeUnseenTuning();
    const log: string[] = [];
    watchSlots(log);
    const f = fakePi();
    setup(f.pi, { window: fakeWindow(log), readLines: () => [] });
    await f.fire("session_start", {}, loggingCtx("main", log));
    expect(log).toEqual([
      "getSessionId", // the child check
      "capture",
      "window.load",
      "getSessionId", // log.reset(sessionId)
      "setMainCwd",
      "draw",
      "tuning",
    ]);
  });

  test("clears the window when loading it throws, then carries on", async () => {
    writeUnseenTuning();
    const log: string[] = [];
    watchSlots(log);
    const f = fakePi();
    setup(f.pi, { window: fakeWindow(log, true), readLines: () => [] });
    await f.fire("session_start", {}, loggingCtx("main", log));
    expect(log).toEqual([
      "getSessionId",
      "capture",
      "window.load",
      "window.clear",
      "getSessionId",
      "setMainCwd",
      "draw",
      "tuning",
    ]);
  });

  test("clears the window when reading the ledger lines throws", async () => {
    const log: string[] = [];
    const f = fakePi();
    setup(f.pi, {
      window: fakeWindow(log),
      readLines: () => {
        throw new Error("unreadable");
      },
    });
    await f.fire("session_start", {}, loggingCtx("main", log));
    expect(log).toEqual(["getSessionId", "window.clear", "getSessionId", "draw"]);
  });

  test("a throw in the service capture skips the rest of the guarded steps but not the tuning", async () => {
    writeUnseenTuning();
    const log: string[] = [];
    watchSlots(log);
    Object.defineProperty(g, EXECUTOR_KEY, {
      configurable: true,
      get() {
        log.push("capture");
        throw new Error("service gone");
      },
    });
    const f = fakePi();
    setup(f.pi, { window: fakeWindow(log), readLines: () => [] });
    await f.fire("session_start", {}, loggingCtx("main", log));
    expect(log).toEqual(["getSessionId", "capture", "tuning"]);
  });

  test("a throw in setMainCwd skips the draw but not the tuning, after the log reset", async () => {
    writeUnseenTuning();
    const log: string[] = [];
    watchSlots(log);
    Object.defineProperty(g, MAIN_CWD_KEY, {
      configurable: true,
      set() {
        log.push("setMainCwd");
        throw new Error("slot locked");
      },
    });
    const f = fakePi();
    setup(f.pi, { window: fakeWindow(log), readLines: () => [] });
    await f.fire("session_start", {}, loggingCtx("main", log));
    expect(log).toEqual([
      "getSessionId",
      "capture",
      "window.load",
      "getSessionId",
      "setMainCwd",
      "tuning",
    ]);
  });

  test("a throwing draw does not skip the tuning", async () => {
    writeUnseenTuning();
    const log: string[] = [];
    const f = fakePi();
    const ctx = loggingCtx("main", log, {
      ui: {
        setWidget: () => {
          log.push("draw");
          throw new Error("ui gone");
        },
        notify: () => log.push("tuning"),
      },
    });
    setup(f.pi, { window: fakeWindow(log), readLines: () => [] });
    await expect(f.fire("session_start", {}, ctx)).resolves.toBeUndefined();
    expect(log).toEqual(["getSessionId", "window.load", "getSessionId", "draw", "tuning"]);
  });

  test("a child session returns after the child check: no step and no tuning line", async () => {
    writeUnseenTuning();
    const log: string[] = [];
    watchSlots(log);
    const f = fakePi();
    setup(f.pi, { window: fakeWindow(log), readLines: () => [] });
    f.markChild("kid");
    await f.fire("session_start", {}, loggingCtx("kid", log));
    expect(log).toEqual(["getSessionId"]);
  });

  test("reads the ledger lines through the default reader at event time", async () => {
    const f = fakePi();
    setup(f.pi);
    const log: string[] = [];
    await f.fire("session_start", {}, loggingCtx("main", log));
    expect(log).toContain("draw");
  });
});

describe("setup turn handlers", () => {
  async function promptFlow() {
    const probabilities = { low: 0.1, medium: 0.1, high: 0.6, xhigh: 0.1, max: 0.1 };
    const fx = await startJevFixture({
      "/ask": {
        json: {
          answers: {
            effort: { type: "choice", choice: "high", probabilities },
            risky: { type: "noul", noul: 0.1 },
            corrects: { type: "noul", noul: 0.05 },
          },
        },
      },
    });
    mkdirSync(join(agentDir, "jev"), { recursive: true });
    writeFileSync(
      join(agentDir, "jev", "config.json"),
      JSON.stringify({ classifier: { url: fx.url("/ask") }, tiers: TIERS }),
    );
    const f = fakePi();
    setup(f.pi);
    const ctxFor = (id: string) => ({
      cwd: agentDir,
      hasUI: true,
      mode: "rpc",
      model: { id: "m", provider: "p", name: "m", reasoning: true },
      ui: { setWidget: () => {}, notify: () => {} },
      sessionManager: { getSessionId: () => id, getBranch: () => [] },
    });
    const main = ctxFor("main");
    await f.fire("session_start", {}, main);
    await f.fire(
      "before_agent_start",
      { messageType: "user", prompt: "hello", systemPrompt: "" },
      main,
    );
    f.markChild("kid");
    const mainLines = (): Record<string, unknown>[] => {
      try {
        return readFileSync(join(agentDir, "jev", "ledger.jsonl"), "utf8")
          .split("\n")
          .filter((l) => l !== "")
          .map((l) => JSON.parse(l) as Record<string, unknown>)
          .filter((l) => l.kind === "main");
      } catch {
        return [];
      }
    };
    return { f, fx, main, kid: ctxFor("kid"), mainLines };
  }

  test("turn_end and before_provider_request reach main for a main session", async () => {
    const { f, fx, main, mainLines } = await promptFlow();
    try {
      await f.fire("before_provider_request", { payload: {} }, main);
      await f.fire(
        "turn_end",
        { message: { stopReason: "stop" }, toolResults: [{ isError: false }, { isError: true }] },
        main,
      );
      await f.fire("agent_settled", { aborted: true }, main);
      const [line] = mainLines();
      expect(line).toMatchObject({ toolCalls: 2, failures: 1, outcome: "aborted" });
    } finally {
      await fx.stop();
    }
  });

  test("an abort before any provider request is undone and writes no main line", async () => {
    const { f, fx, main, mainLines } = await promptFlow();
    try {
      await f.fire("agent_settled", { aborted: true }, main);
      expect(mainLines()).toEqual([]);
    } finally {
      await fx.stop();
    }
  });

  test("child sessions are ignored by before_provider_request, turn_end and agent_settled", async () => {
    const { f, fx, main, kid, mainLines } = await promptFlow();
    try {
      await f.fire("before_provider_request", { payload: {} }, kid);
      await f.fire("turn_end", { message: {}, toolResults: [{}, {}, {}] }, kid);
      await f.fire("agent_settled", { aborted: false }, kid);
      expect(mainLines()).toEqual([]); // the child's settle did not end the main turn
      // The child's request and turn_end did not reach the main turn: it settles with no counts.
      await f.fire("before_provider_request", { payload: {} }, main);
      await f.fire("agent_settled", { aborted: false }, main);
      expect(mainLines()[0]).toMatchObject({ toolCalls: 0, inputTokens: 0 });
    } finally {
      await fx.stop();
    }
  });

  test("agent_settled steps the tuning after main, only for a main session", async () => {
    const dir = join(agentDir, "jev");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "ledger.jsonl"),
      firing()
        .map((e) => JSON.stringify(e))
        .join("\n") + "\n",
    );
    const f = fakePi();
    setup(f.pi);
    f.markChild("kid");
    const ui = { setWidget: () => {}, notify: () => {} };
    const ctx = (id: string) => ({
      hasUI: true,
      mode: "rpc",
      cwd: agentDir,
      ui,
      sessionManager: { getSessionId: () => id, getBranch: () => [] },
    });
    await f.fire("agent_settled", { aborted: false }, ctx("kid"));
    expect(() => readFileSync(join(dir, "tuning.json"), "utf8")).toThrow();
    await f.fire("agent_settled", { aborted: false }, ctx("main"));
    expect(readFileSync(join(dir, "tuning.json"), "utf8")).toContain("history");
  });

  test("each turn handler resolves undefined and reads the session id once", async () => {
    const f = fakePi();
    setup(f.pi);
    for (const name of ["before_provider_request", "turn_end"]) {
      const log: string[] = [];
      const out = await f.fire(name, { message: {}, toolResults: [] }, loggingCtx("main", log));
      expect([name, out, log]).toEqual([name, undefined, ["getSessionId"]]);
    }
  });

  test("handlers survive a context whose session manager throws", async () => {
    const f = fakePi();
    setup(f.pi);
    const bad = {
      sessionManager: {
        getSessionId: (): never => {
          throw new Error("no session");
        },
      },
    };
    for (const name of ["before_agent_start", "before_provider_request", "turn_end"]) {
      expect(await f.fire(name, {}, bad)).toBeUndefined();
    }
    await expect(f.fire("agent_settled", {}, bad)).resolves.toBeUndefined();
  });
});

describe("setup session_shutdown", () => {
  test("clears the service, then drops the child and routing subscriptions in order", async () => {
    const service = { implementation: "@ttdua/pi-subagents", listAgents: () => [] as unknown[] };
    g[EXECUTOR_KEY] = service;
    const log: string[] = [];
    const f = fakePi(log);
    setup(f.pi);
    await f.fire("session_start", {}, loggingCtx("main", []));
    expect(mainService()).toBe(service as never);
    log.length = 0;
    await f.fire("session_shutdown", {}, loggingCtx("main", log));
    expect(mainService()).toBeUndefined();
    expect(log).toEqual([
      "getSessionId",
      `off:${CREATED}`,
      "off:subagents:child:disposed",
      "off:subagents:completed",
      "off:subagents:failed",
      "off:subagents:resumed",
    ]);
  });

  test("a child shutdown keeps the service but still unsubscribes", async () => {
    const service = { implementation: "@ttdua/pi-subagents", listAgents: () => [] as unknown[] };
    g[EXECUTOR_KEY] = service;
    const log: string[] = [];
    const f = fakePi(log);
    setup(f.pi);
    await f.fire("session_start", {}, loggingCtx("main", []));
    f.markChild("kid");
    log.length = 0;
    await f.fire("session_shutdown", {}, loggingCtx("kid", log));
    expect(mainService()).toBe(service as never);
    expect(log.filter((l) => l.startsWith("off:"))).toHaveLength(5);
  });

  test("a throwing session id read does not skip any unsubscribe", async () => {
    const log: string[] = [];
    const f = fakePi(log);
    setup(f.pi);
    log.length = 0;
    await f.fire("session_shutdown", {}, {}); // ctx.sessionManager is undefined: the read throws
    expect(log.filter((l) => l.startsWith("off:"))).toHaveLength(5);
  });
});

describe("setup /jev command", () => {
  test("returns the runJev promise and resolves the jev dir when the command runs", async () => {
    const f = fakePi();
    setup(f.pi);
    const second = tempDir("jev-wiring-second-");
    try {
      process.env.PI_CODING_AGENT_DIR = second;
      const notes: string[] = [];
      const ctx = {
        cwd: second,
        hasUI: true,
        mode: "rpc",
        ui: { setWidget: () => {}, notify: (t: string) => notes.push(t) },
        sessionManager: { getSessionId: () => "main", getBranch: () => [] },
      };
      const out = f.commands.get("jev")!.handler("tune off", ctx);
      expect(out).toBeInstanceOf(Promise);
      await out;
      expect(readFileSync(join(second, "jev", "tuning.json"), "utf8")).toContain('"off": true');
      expect(notes.length).toBe(1);
    } finally {
      process.env.PI_CODING_AGENT_DIR = agentDir;
      rmSync(second, { recursive: true, force: true });
    }
  });

  test("shows the status for the current window, decision and tally", async () => {
    const f = fakePi();
    setup(f.pi);
    const notes: string[] = [];
    await f.commands.get("jev")!.handler("", {
      cwd: agentDir,
      hasUI: true,
      mode: "rpc",
      ui: { setWidget: () => {}, notify: (t: string) => notes.push(t) },
      sessionManager: { getSessionId: () => "main", getBranch: () => [] },
    });
    expect(notes[0]).toContain("  prompts 0");
  });
});
