import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CHILDREN_KEY, isChild } from "../../src/host/child.ts";
import { sessionModes } from "../../src/host/session-mode.ts";
import { setup } from "../../src/host/setup.ts";
import { MAIN_SERVICE_KEY, mainService } from "../../src/host/tool-service.ts";
import { startJevFixture } from "../jev/fixture.ts";
import { tempDir } from "../helpers.ts";
import { firing } from "./tuning-fakes.ts";
import { body, TIERS } from "./worker-fakes.ts";

type Handler = (event: unknown, ctx: unknown) => Promise<void> | void;

function fakePi(opts: { throwOnOff?: boolean; executor?: boolean; noRenderer?: boolean } = {}) {
  const renderers = new Map<string, (entry: unknown, o: unknown, t: unknown) => unknown>();
  const entries: { type: string; data: unknown }[] = [];
  let level = "low";
  const handlers = new Map<string, Handler[]>();
  const commands = new Map<string, unknown>();
  const subs: { channel: string; live: boolean; handler: (d: unknown) => void }[] = [];
  const order: string[] = [];
  const pi = {
    on: (name: string, h: Handler) => {
      order.push(`on:${name}`);
      handlers.set(name, [...(handlers.get(name) ?? []), h]);
    },
    registerCommand: (name: string, def: unknown) => commands.set(name, def),
    registerTool: () => {},
    ...(opts.noRenderer === true
      ? {}
      : {
          registerEntryRenderer: (
            type: string,
            r: (e: unknown, o: unknown, t: unknown) => unknown,
          ) => renderers.set(type, r),
        }),
    appendEntry: (type: string, data: unknown) => entries.push({ type, data }),
    getThinkingLevel: () => level,
    setThinkingLevel: (l: string) => {
      level = l;
    },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    getAllTools: () => (opts.executor === true ? [{ name: "subagent" }] : []),
    events: {
      on: (channel: string, handler: (d: unknown) => void) => {
        order.push(`events:${channel}`);
        const sub = { channel, live: true, handler };
        subs.push(sub);
        return () => {
          if (opts.throwOnOff) throw new Error("unsubscribe failed");
          sub.live = false;
        };
      },
    },
  };
  const emit = (channel: string, data: unknown) => {
    for (const s of subs) if (s.live && s.channel === channel) s.handler(data);
  };
  return {
    pi: pi as unknown as ExtensionAPI,
    handlers,
    commands,
    subs,
    order,
    emit,
    renderers,
    entries,
  };
}

function fakeCtx(sessionId: string, setWidget: () => void, branch: () => unknown[] = () => []) {
  return {
    hasUI: true,
    mode: "rpc",
    ui: { setWidget, notify: () => {} },
    sessionManager: { getSessionId: () => sessionId, getBranch: branch },
  };
}

const CREATED = "subagents:child:session-created";
const DISPOSED = "subagents:child:disposed";
const saved = { dir: process.env.PI_CODING_AGENT_DIR, key: process.env.TYPESAFE_API_KEY };
const EXECUTOR_KEY = Symbol.for("@gotgenes/pi-subagents:service");
let agentDir = "";

beforeEach(() => {
  agentDir = tempDir("jev-setup-");
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.TYPESAFE_API_KEY = "k";
});
afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[CHILDREN_KEY];
  delete (globalThis as Record<symbol, unknown>)[MAIN_SERVICE_KEY];
  delete (globalThis as Record<symbol, unknown>)[EXECUTOR_KEY];
  sessionModes().rebuild("reset", []);
  rmSync(agentDir, { recursive: true, force: true });
  if (saved.dir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = saved.dir;
  if (saved.key === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = saved.key;
});

describe("setup", () => {
  test("session_shutdown resolves even when an unsubscribe throws", async () => {
    const f = fakePi({ throwOnOff: true });
    setup(f.pi);
    await expect(f.handlers.get("session_shutdown")![0]!({}, {})).resolves.toBeUndefined();
  });

  test("session_shutdown removes routing subscriptions", async () => {
    const f = fakePi();
    setup(f.pi);
    expect(f.subs.filter((s) => s.live)).toHaveLength(5);
    await f.handlers.get("session_shutdown")![0]!({}, {});
    expect(f.subs.filter((s) => s.live)).toHaveLength(0);
  });

  test("shutdown unsubscribes routing even when the child unsubscribe throws", async () => {
    const f = fakePi();
    let throwing = true;
    const on = f.pi.events.on.bind(f.pi.events);
    let n = 0;
    f.pi.events.on = ((channel: string, h: (d: unknown) => void) => {
      const off = on(channel, h);
      // The first two subscriptions are the child registry's; make them throw.
      return n++ < 2 && throwing
        ? () => {
            throw new Error("unsubscribe failed");
          }
        : off;
    }) as never;
    setup(f.pi);
    await f.handlers.get("session_shutdown")![0]!({}, {});
    expect(f.subs.filter((s) => s.channel.startsWith("subagents:c")).length).toBeGreaterThan(0);
    expect(
      f.subs.filter(
        (s) =>
          ["subagents:completed", "subagents:failed", "subagents:resumed"].includes(s.channel) &&
          s.live,
      ),
    ).toHaveLength(0);
    throwing = false;
  });

  test("/jev clears shown warnings", async () => {
    const fx = await startJevFixture({ "/ask": { json: body("deep") } });
    try {
      mkdirSync(join(agentDir, "jev"), { recursive: true });
      writeFileSync(
        join(agentDir, "jev", "config.json"),
        JSON.stringify({ classifier: { url: fx.url("/ask") }, tiers: TIERS }),
      );
      const f = fakePi({ executor: true });
      setup(f.pi);
      const notes: string[] = [];
      const ctx = {
        cwd: agentDir,
        hasUI: true,
        mode: "rpc",
        ui: { setWidget: () => {}, notify: (t: string) => notes.push(t) },
        sessionManager: { getSessionId: () => "main-1", getBranch: () => [] },
        modelRegistry: {
          find: (p: string, id: string) =>
            id === "deep" ? undefined : { id, provider: p, name: id, reasoning: true },
          hasConfiguredAuth: () => true,
        },
      };
      const launch = async (id: string) => {
        const event = {
          type: "tool_call",
          toolName: "subagent",
          toolCallId: id,
          input: { prompt: "do a thing", description: "d", subagent_type: "general-purpose" },
        };
        for (const h of f.handlers.get("tool_call") ?? []) await h(event, ctx);
      };
      await launch("c1");
      expect(notes).toHaveLength(1);
      await launch("c2");
      expect(notes).toHaveLength(1);
      const jev = f.commands.get("jev") as { handler: (a: string, c: unknown) => Promise<void> };
      await jev.handler("", ctx);
      const before = notes.length;
      await launch("c3");
      expect(notes.length).toBe(before + 1);
      expect(notes.at(-1)).toContain("tier deep");
    } finally {
      await fx.stop();
    }
  });

  const mainEntry = {
    v: 1,
    at: 1,
    session: "s1",
    mode: "standard",
    answered: true,
    kind: "main",
    turnId: "t1",
    outcome: "ok",
    from: "low",
    effective: "high",
    ms: 512,
    effortP: { low: 0.05, medium: 0.1, high: 0.7, xhigh: 0.1, max: 0.05 },
  };
  const MAIN_TEXT =
    "jev · main · low → high · 0.5s · p low 0.05 medium 0.10 high 0.70 xhigh 0.10 max 0.05";

  test("registers jev-log renderer", () => {
    const f = fakePi();
    setup(f.pi);
    const r = f.renderers.get("jev-log")!;
    const wide = r({ data: mainEntry }, {}, {}) as { render: (w: number) => string[] };
    expect(wide.render(200)).toEqual([MAIN_TEXT]);
    const narrow = wide.render(10);
    expect(narrow).toHaveLength(1);
    expect(narrow[0]).toHaveLength(10);
  });

  test("renderer swallows", () => {
    const f = fakePi();
    setup(f.pi);
    const r = f.renderers.get("jev-log")!;
    expect(r({ data: { kind: "other" } }, {}, {})).toBeUndefined();
    const bad = {
      get data(): unknown {
        throw new Error("boom");
      },
    };
    expect(r(bad, {}, {})).toBeUndefined();
  });

  test("older Pi without registerEntryRenderer", async () => {
    const f = fakePi({ noRenderer: true });
    expect(() => setup(f.pi)).not.toThrow();
    const notes: string[] = [];
    const jev = f.commands.get("jev") as { handler: (a: string, c: unknown) => Promise<void> };
    await jev.handler("", {
      cwd: agentDir,
      hasUI: true,
      mode: "rpc",
      ui: { setWidget: () => {}, notify: (t: string) => notes.push(t) },
      sessionManager: { getSessionId: () => "main-1", getBranch: () => [] },
    });
    expect(notes.length).toBeGreaterThan(0);
  });

  async function runPrompt(opts: { writable?: boolean; prompts?: number } = {}) {
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
    mkdirSync(join(agentDir, "jev", opts.writable ? "" : "ledger.jsonl"), { recursive: true });
    writeFileSync(
      join(agentDir, "jev", "config.json"),
      JSON.stringify({ classifier: { url: fx.url("/ask") }, tiers: TIERS }),
    );
    const f = fakePi();
    setup(f.pi);
    const notes: string[] = [];
    const widgets: string[] = [];
    const ctx = {
      cwd: agentDir,
      hasUI: true,
      mode: "rpc",
      model: { id: "m", provider: "p", name: "m", reasoning: true },
      ui: {
        setWidget: (_k: string, c: unknown) => {
          if (Array.isArray(c)) widgets.push(String(c[0]));
        },
        notify: (t: string) => notes.push(t),
      },
      sessionManager: { getSessionId: () => "main-1", getBranch: () => [] },
    };
    const fire = async (name: string, event: unknown) => {
      for (const h of f.handlers.get(name) ?? []) await h(event, ctx);
    };
    const jev = f.commands.get("jev") as { handler: (a: string, c: unknown) => Promise<void> };
    const status = async () => {
      await jev.handler("", ctx);
      return notes.at(-1) ?? "";
    };
    await fire("session_start", { reason: "startup" });
    for (let i = 0; i < (opts.prompts ?? 1); i++) {
      await fire("before_agent_start", { messageType: "user", prompt: "hello", systemPrompt: "" });
      await fire("before_provider_request", { payload: {} });
      await fire("agent_settled", { aborted: false });
    }
    return { fx, fire, status, widgets };
  }

  test("cadence: the 10th prompt shows the compact tally, the 9th does not", async () => {
    const nine = await runPrompt({ writable: true, prompts: 9 });
    try {
      expect(nine.widgets.at(-1)).not.toContain("prompts");
    } finally {
      await nine.fx.stop();
    }
    const ten = await runPrompt({ writable: true, prompts: 10 });
    try {
      expect(ten.widgets.at(-1)).toBe("Jev · standard · 10 prompts · 0 workers · 0 fallbacks");
    } finally {
      await ten.fx.stop();
    }
  });

  test("session_tree redraw keeps an active tally overlay", async () => {
    const ten = await runPrompt({ writable: true, prompts: 10 });
    try {
      await ten.fire("session_tree", {});
      expect(ten.widgets.at(-1)).toBe("Jev · standard · 10 prompts · 0 workers · 0 fallbacks");
    } finally {
      await ten.fx.stop();
    }
  });

  test("tally counts with failed append", async () => {
    const { fx, status } = await runPrompt();
    try {
      expect(await status()).toContain("  prompts 1");
    } finally {
      await fx.stop();
    }
  });

  test.each(["new", "resume"])("session_start resets the tally (%s)", async (reason) => {
    const { fx, fire, status } = await runPrompt();
    try {
      expect(await status()).toContain("  prompts 1");
      await fire("session_start", { reason });
      expect(await status()).toContain("  prompts 0");
    } finally {
      await fx.stop();
    }
  });

  test("subscribes to both child events before any handler is registered", () => {
    const f = fakePi();
    setup(f.pi);
    expect(f.order.slice(0, 2).sort()).toEqual([`events:${CREATED}`, `events:${DISPOSED}`].sort());
    expect(f.order.indexOf("on:session_start")).toBeGreaterThan(1);
    expect([...f.commands.keys()]).toEqual(["jev"]);
    expect([...f.handlers.keys()].sort()).toEqual([
      "agent_settled",
      "before_agent_start",
      "before_provider_request",
      "message_end",
      "session_shutdown",
      "session_start",
      "session_tree",
      "tool_call",
      "tool_result",
      "turn_end",
    ]);
    expect(f.subs.map((s) => s.channel).slice(2)).toEqual([
      "subagents:completed",
      "subagents:failed",
      "subagents:resumed",
    ]);
  });

  test("session_start draws the line on a main session", async () => {
    const f = fakePi();
    setup(f.pi);
    let calls = 0;
    await f.handlers.get("session_start")![0]!(
      {},
      fakeCtx("main", () => calls++),
    );
    expect(calls).toBeGreaterThan(0);
  });

  test("turn_end and before_provider_request return undefined", async () => {
    const f = fakePi();
    setup(f.pi);
    const ctx = fakeCtx("main", () => {});
    const payload = { a: 1 };
    expect(await f.handlers.get("before_provider_request")![0]!({ payload }, ctx)).toBeUndefined();
    expect(payload).toEqual({ a: 1 });
    expect(
      await f.handlers.get("turn_end")![0]!({ message: {}, toolResults: [] }, ctx),
    ).toBeUndefined();
  });

  test("session_start with a throwing setWidget returns normally", async () => {
    const f = fakePi();
    setup(f.pi);
    const ctx = fakeCtx("main", () => {
      throw new Error("ui gone");
    });
    await f.handlers.get("session_start")![0]!({}, ctx);
  });

  test("session_start in a child session makes no setWidget call", async () => {
    const f = fakePi();
    setup(f.pi);
    f.emit(CREATED, { sessionId: "kid" });
    let calls = 0;
    await f.handlers.get("session_start")![0]!(
      {},
      fakeCtx("kid", () => calls++),
    );
    expect(calls).toBe(0);
  });

  test("child session start and settle leave tuning alone", async () => {
    const dir = join(agentDir, "jev");
    mkdirSync(dir, { recursive: true });
    const tuning = JSON.stringify({
      history: [{ at: 1000, parameter: "timeoutMs", from: 1500, to: 1700, cause: "rule" }],
    });
    writeFileSync(join(dir, "tuning.json"), tuning);
    writeFileSync(
      join(dir, "ledger.jsonl"),
      firing()
        .map((e) => JSON.stringify(e))
        .join("\n") + "\n",
    );
    const f = fakePi();
    setup(f.pi);
    f.emit(CREATED, { sessionId: "kid" });
    let notified = 0;
    const ctx = {
      ...fakeCtx("kid", () => {}),
      ui: { setWidget: () => {}, notify: () => notified++ },
    };
    await f.handlers.get("session_start")![0]!({}, ctx);
    await f.handlers.get("agent_settled")![0]!({}, ctx);
    expect(readFileSync(join(dir, "tuning.json"), "utf8")).toBe(tuning);
    expect(notified).toBe(0);
  });

  test("tuning follows the jev dir resolved at event time", async () => {
    const second = tempDir("jev-setup-second-");
    try {
      const f = fakePi();
      setup(f.pi);
      process.env.PI_CODING_AGENT_DIR = second;
      mkdirSync(join(second, "jev"), { recursive: true });
      writeFileSync(
        join(second, "jev", "ledger.jsonl"),
        firing()
          .map((e) => JSON.stringify(e))
          .join("\n") + "\n",
      );
      const ctx = {
        ...fakeCtx("main", () => {}),
        ui: { setWidget: () => {}, notify: () => {} },
      };
      await f.handlers.get("agent_settled")![0]!({}, ctx);
      expect(existsSync(join(second, "jev", "tuning.json"))).toBe(true);
      expect(existsSync(join(agentDir, "jev", "tuning.json"))).toBe(false);
    } finally {
      process.env.PI_CODING_AGENT_DIR = agentDir;
      rmSync(second, { recursive: true, force: true });
    }
  });

  test("shutdown unsubscribes; a new instance keeps the registry ids", async () => {
    const a = fakePi();
    setup(a.pi);
    a.emit(CREATED, { sessionId: "kid" });
    await a.handlers.get("session_shutdown")![0]!({}, {});
    expect(a.subs.every((s) => !s.live)).toBe(true);
    expect(isChild("kid")).toBe(true);

    const b = fakePi();
    setup(b.pi);
    expect(b.subs.filter((s) => s.live)).toHaveLength(5);
    let calls = 0;
    await b.handlers.get("session_start")![0]!(
      {},
      fakeCtx("kid", () => calls++),
    );
    expect(calls).toBe(0);
    b.emit(DISPOSED, { sessionId: "kid" });
    expect(isChild("kid")).toBe(false);
  });

  describe("tool assessment wiring", () => {
    const service = { listAgents: () => [] as unknown[] };
    const put = () => ((globalThis as Record<symbol, unknown>)[EXECUTOR_KEY] = service);
    const start = (f: ReturnType<typeof fakePi>, id: string) =>
      f.handlers.get("session_start")![0]!(
        {},
        fakeCtx(id, () => {}),
      );
    const stop = (f: ReturnType<typeof fakePi>, id: string) =>
      f.handlers.get("session_shutdown")![0]!(
        {},
        fakeCtx(id, () => {}),
      );

    test("main session_start captures the service", async () => {
      put();
      const f = fakePi();
      setup(f.pi);
      await start(f, "main");
      expect(mainService()).toBe(service);
    });

    test("child session_start does not capture", async () => {
      put();
      const f = fakePi();
      setup(f.pi);
      f.emit(CREATED, { sessionId: "kid" });
      await start(f, "kid");
      expect(mainService()).toBeUndefined();
    });

    test("main shutdown clears, child shutdown leaves it", async () => {
      put();
      const f = fakePi();
      setup(f.pi);
      await start(f, "main");
      f.emit(CREATED, { sessionId: "kid" });
      await start(f, "kid");
      await stop(f, "kid");
      expect(mainService()).toBe(service);
      await stop(f, "main");
      expect(mainService()).toBeUndefined();
    });

    test("child before_agent_start hides the review tool, then assesses", async () => {
      const fx = await startJevFixture({
        "/ask": { json: { answers: { "tool::read": { type: "noul", noul: 0.1 } } } },
      });
      try {
        mkdirSync(join(agentDir, "jev"), { recursive: true });
        writeFileSync(
          join(agentDir, "jev", "config.json"),
          JSON.stringify({ classifier: { url: fx.url("/ask") } }),
        );
        (globalThis as Record<symbol, unknown>)[EXECUTOR_KEY] = {
          listAgents: () => [
            { id: "a1", type: "general-purpose", description: "d", outputFile: "/kid.jsonl" },
          ],
        };
        const f = fakePi();
        setup(f.pi);
        await start(f, "main");
        f.emit(CREATED, { sessionId: "kid" });
        const selectedTools = ["read", "jev_review"];
        const ctx = {
          cwd: agentDir,
          sessionManager: { getSessionId: () => "kid", getSessionFile: () => "/kid.jsonl" },
        };
        const event = {
          messageType: "user",
          prompt: "do it",
          systemPromptOptions: { selectedTools },
        };
        const out = await f.handlers.get("before_agent_start")![0]!(event, ctx);
        expect(out).toBeUndefined();
        expect(selectedTools).toEqual(["read"]);
        expect(fx.requests).toHaveLength(1);
        const questions = Object.keys(JSON.parse(fx.requests[0]!.body).questions);
        expect(questions).toEqual(["tool::read"]);
      } finally {
        await fx.stop();
      }
    });

    test("an assessment failure still leaves the review tool hidden", async () => {
      mkdirSync(join(agentDir, "jev"), { recursive: true });
      writeFileSync(join(agentDir, "jev", "config.json"), JSON.stringify({}));
      (globalThis as Record<symbol, unknown>)[EXECUTOR_KEY] = { listAgents: () => [] };
      const f = fakePi();
      setup(f.pi);
      await start(f, "main");
      f.emit(CREATED, { sessionId: "kid" });
      const selectedTools = ["read", "jev_review"];
      let fileCalls = 0;
      const ctx = {
        cwd: agentDir,
        sessionManager: {
          getSessionId: () => "kid",
          getSessionFile: (): never => {
            fileCalls++;
            throw new Error("no session file");
          },
        },
      };
      const event = {
        messageType: "user",
        prompt: "do it",
        systemPromptOptions: { selectedTools },
      };
      expect(await f.handlers.get("before_agent_start")![0]!(event, ctx)).toBeUndefined();
      expect(selectedTools).toEqual(["read"]);
      expect(fileCalls).toBe(1);
    });

    test("a throwing event leaves before_agent_start returning undefined", async () => {
      const f = fakePi();
      setup(f.pi);
      f.emit(CREATED, { sessionId: "kid" });
      const event = {
        messageType: "user",
        prompt: "p",
        get systemPromptOptions(): never {
          throw new Error("boom");
        },
      };
      const ctx = { cwd: agentDir, sessionManager: { getSessionId: () => "kid" } };
      expect(await f.handlers.get("before_agent_start")![0]!(event, ctx)).toBeUndefined();
    });
  });
});

describe("setup session mode", () => {
  const modeEntry = (mode: string) => ({
    type: "custom",
    customType: "jev-mode",
    data: { mode },
  });

  function widgetCtx(id: string, branch: () => unknown[]) {
    const widgets: string[] = [];
    const notes: string[] = [];
    const ctx = {
      ...fakeCtx(id, () => {}, branch),
      ui: {
        setWidget: (_k: string, c: unknown) => {
          if (Array.isArray(c)) widgets.push(String(c[0]));
        },
        notify: (t: string) => notes.push(t),
      },
    };
    return { ctx, widgets, notes };
  }

  test("session_start rebuilds the session mode", async () => {
    for (const reason of ["startup", "reload", "resume", "fork", "new"]) {
      const f = fakePi();
      setup(f.pi);
      const { ctx, widgets } = widgetCtx("main", () => [modeEntry("budget")]);
      await f.handlers.get("session_start")![0]!({ reason }, ctx);
      expect(widgets.at(-1)).toContain("Jev · budget (session)");
    }
  });

  test("Tree navigation before the entry redraws and reports the saved mode", async () => {
    const f = fakePi();
    setup(f.pi);
    let branch: unknown[] = [modeEntry("premium")];
    const { ctx, widgets, notes } = widgetCtx("main", () => branch);
    await f.handlers.get("session_start")![0]!({ reason: "startup" }, ctx);
    expect(widgets.at(-1)).toContain("Jev · premium (session)");
    branch = [];
    await f.handlers.get("session_tree")![0]!({}, ctx);
    expect(widgets.at(-1)).toContain("Jev · standard");
    expect(widgets.at(-1)).not.toContain("(session)");
    const jev = f.commands.get("jev") as { handler: (a: string, c: unknown) => Promise<void> };
    await jev.handler("", ctx);
    expect(notes.at(-1)).toContain("mode: standard");
  });

  test("Command in a new session before its session_start ignores the old mode", async () => {
    const f = fakePi();
    setup(f.pi);
    sessionModes().rebuild("A", [modeEntry("premium")]);
    const { ctx, notes } = widgetCtx("B", () => []);
    const jev = f.commands.get("jev") as { handler: (a: string, c: unknown) => Promise<void> };
    await jev.handler("", ctx);
    expect(notes.at(-1)).toContain("mode: standard");
    expect(notes.at(-1)).not.toContain("(session");
  });

  test("Setting a session mode before session_start applies to the new session", async () => {
    const f = fakePi();
    setup(f.pi);
    sessionModes().rebuild("A", [modeEntry("premium")]);
    const { ctx, notes } = widgetCtx("B", () => []);
    const jev = f.commands.get("jev") as { handler: (a: string, c: unknown) => Promise<void> };
    await jev.handler("mode budget session", ctx);
    expect(f.entries).toContainEqual({ type: "jev-mode", data: { mode: "budget" } });
    await jev.handler("", ctx);
    expect(notes.at(-1)).toContain("mode: budget (session; saved standard)");
  });

  test("session_tree in a child session does not rebuild", async () => {
    const f = fakePi();
    setup(f.pi);
    f.emit(CREATED, { sessionId: "kid" });
    sessionModes().rebuild("main", [modeEntry("budget")]);
    await f.handlers.get("session_tree")![0]!(
      {},
      fakeCtx("kid", () => {}),
    );
    expect(sessionModes().modeFor(undefined)).toBe("budget");
  });

  test("Child start does not rebuild", async () => {
    const f = fakePi();
    setup(f.pi);
    f.emit(CREATED, { sessionId: "kid" });
    sessionModes().rebuild("main", [modeEntry("budget")]);
    await f.handlers.get("session_start")![0]!(
      { reason: "startup" },
      fakeCtx("kid", () => {}),
    );
    expect(sessionModes().modeFor(undefined)).toBe("budget");
  });
});
