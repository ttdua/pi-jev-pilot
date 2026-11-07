import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CHILDREN_KEY, isChild } from "../../src/host/child.ts";
import { setup } from "../../src/host/setup.ts";
import { MAIN_SERVICE_KEY, mainService } from "../../src/host/tool-service.ts";
import { startJevFixture } from "../jev/fixture.ts";
import { tempDir } from "../helpers.ts";
import { body, TIERS } from "./worker-fakes.ts";

type Handler = (event: unknown, ctx: unknown) => Promise<void> | void;

function fakePi(opts: { throwOnOff?: boolean; executor?: boolean } = {}) {
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
  return { pi: pi as unknown as ExtensionAPI, handlers, commands, subs, order, emit };
}

function fakeCtx(sessionId: string, setWidget: () => void) {
  return {
    hasUI: true,
    mode: "rpc",
    ui: { setWidget, notify: () => {} },
    sessionManager: { getSessionId: () => sessionId },
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
    expect(f.subs.filter((s) => s.live)).toHaveLength(6);
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
      "tool_call",
      "tool_result",
      "turn_end",
    ]);
    expect(f.subs.map((s) => s.channel).slice(2)).toEqual([
      "subagents:completed",
      "subagents:failed",
      "subagents:resumed",
      "subagents:child:disposed",
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

  test("shutdown unsubscribes; a new instance keeps the registry ids", async () => {
    const a = fakePi();
    setup(a.pi);
    a.emit(CREATED, { sessionId: "kid" });
    await a.handlers.get("session_shutdown")![0]!({}, {});
    expect(a.subs.every((s) => !s.live)).toBe(true);
    expect(isChild("kid")).toBe(true);

    const b = fakePi();
    setup(b.pi);
    expect(b.subs.filter((s) => s.live)).toHaveLength(6);
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

    test("shutdown unsubscribes the dispose listener", async () => {
      const f = fakePi();
      setup(f.pi);
      await stop(f, "main");
      expect(f.subs.filter((s) => s.live)).toHaveLength(0);
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
      const ctx = {
        cwd: agentDir,
        sessionManager: {
          getSessionId: () => "kid",
          getSessionFile: (): never => {
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
