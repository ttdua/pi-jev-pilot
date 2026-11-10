import { afterEach, describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CHILDREN_KEY } from "../../../src/host/platform/child.ts";
import {
  registerJevCommand,
  subscribeSessionShutdown,
  subscribeTurn,
  type Parts,
} from "../../../src/host/wiring/index.ts";

type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[CHILDREN_KEY];
});

function fakePi() {
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, { description: string }>();
  const pi = {
    on: (n: string, h: Handler) => handlers.set(n, h),
    registerCommand: (n: string, d: { description: string }) => commands.set(n, d),
  } as unknown as ExtensionAPI;
  return { pi, handlers, commands };
}

const ctx = { sessionManager: { getSessionId: () => "main" } };

function fakeParts(calls: string[]): Parts {
  return {
    off: () => calls.push("off"),
    routing: { off: () => calls.push("routing.off") },
    main: {
      beforeProviderRequest: async () => calls.push("main.request"),
      turnEnd: async () => calls.push("main.turnEnd"),
      agentSettled: async () => calls.push("main.settled"),
    },
    tuningDeps: () => {
      calls.push("tuningDeps");
      throw new Error("no tuning here");
    },
  } as unknown as Parts;
}

describe("subscribeTurn", () => {
  test("subscribes the four turn handlers, in Pi's event order", () => {
    const f = fakePi();
    subscribeTurn(f.pi, fakeParts([]));
    expect([...f.handlers.keys()]).toEqual([
      "before_agent_start",
      "before_provider_request",
      "turn_end",
      "agent_settled",
    ]);
  });

  test("agent_settled settles main, then still tries tuning when tuning throws", async () => {
    const calls: string[] = [];
    const f = fakePi();
    subscribeTurn(f.pi, fakeParts(calls));
    await f.handlers.get("agent_settled")!({ aborted: false }, ctx);
    expect(calls).toEqual(["main.settled", "tuningDeps"]);
  });
});

describe("subscribeSessionShutdown", () => {
  test("drops both subscriptions even when the first step throws", async () => {
    const calls: string[] = [];
    const f = fakePi();
    subscribeSessionShutdown(f.pi, fakeParts(calls));
    await f.handlers.get("session_shutdown")!({}, {});
    expect(calls).toEqual(["off", "routing.off"]);
  });
});

describe("registerJevCommand", () => {
  test("registers /jev with its description", () => {
    const f = fakePi();
    registerJevCommand(f.pi, fakeParts([]));
    expect(f.commands.get("jev")?.description).toBe("Show or change jev-pilot features");
  });
});
