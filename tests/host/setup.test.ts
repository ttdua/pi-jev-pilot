import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CHILDREN_KEY, isChild } from "../../src/host/child.ts";
import { setup } from "../../src/host/setup.ts";
import { tempDir } from "../helpers.ts";

type Handler = (event: unknown, ctx: unknown) => Promise<void> | void;

function fakePi(opts: { throwOnOff?: boolean } = {}) {
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
    getAllTools: () => [],
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
let agentDir = "";

beforeEach(() => {
  agentDir = tempDir("jev-setup-");
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.TYPESAFE_API_KEY = "k";
});
afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[CHILDREN_KEY];
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

  test("subscribes to both child events before any handler is registered", () => {
    const f = fakePi();
    setup(f.pi);
    expect(f.order.slice(0, 2).sort()).toEqual([`events:${CREATED}`, `events:${DISPOSED}`].sort());
    expect(f.order.indexOf("on:session_start")).toBeGreaterThan(1);
    expect([...f.commands.keys()]).toEqual(["jev"]);
    expect([...f.handlers.keys()].sort()).toEqual([
      "before_agent_start",
      "session_shutdown",
      "session_start",
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
    expect(b.subs.filter((s) => s.live)).toHaveLength(2);
    let calls = 0;
    await b.handlers.get("session_start")![0]!(
      {},
      fakeCtx("kid", () => calls++),
    );
    expect(calls).toBe(0);
    b.emit(DISPOSED, { sessionId: "kid" });
    expect(isChild("kid")).toBe(false);
  });
});
