import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { putToolCounts, takeToolCounts } from "../../../src/host/tools/counts.ts";
import { registerWorkerRouting, type WorkerDeps } from "../../../src/host/worker/routing.ts";
import type { JevOutcome } from "../../../src/jev/client.ts";
import { tempDir } from "../../helpers.ts";
import { base, body, harness, ok, snap, type Handler } from "../worker-fakes.ts";

// Pins when and how worker routing reads its inputs, so splitting the closure keeps the order:
// dependencies called detached and read when used, tool counts consumed last, message blocks read
// one at a time, tool-call stamps in their original order, and shutdown order.

const saved = process.env.TYPESAFE_API_KEY;
beforeEach(() => {
  process.env.TYPESAFE_API_KEY = "k";
});
afterEach(() => {
  if (saved === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = saved;
});

type Input = Record<string, unknown>;

/** A Pi fake that keeps every handler and records what each unsubscribe observes. */
function fakePi(onUnsubscribe: () => void = () => {}) {
  const handlers = new Map<string, Handler>();
  const bus = new Map<string, Handler>();
  const pi = {
    on: (name: string, handler: Handler) => (handlers.set(name, handler), onUnsubscribe),
    events: { on: (name: string, handler: Handler) => (bus.set(name, handler), onUnsubscribe) },
  };
  return { pi: pi as never, handlers, bus };
}

function baseDeps(lines: unknown[] = []): WorkerDeps & Record<string, unknown> {
  return {
    ask: () => Promise.resolve(ok(body("fast"))),
    append: (entry) => void lines.push(entry),
    snapshot: () => snap(),
    now: () => 1,
    agentDir: tempDir("jev-order-agents-"),
  };
}

describe("dependencies", () => {
  test("window is called detached from deps", async () => {
    const h = harness();
    const lines: unknown[] = [];
    const deps = {
      ...baseDeps(lines),
      window(this: unknown) {
        if (this !== undefined) throw new Error("window must be called detached");
        return [];
      },
    };
    const { pi, handlers } = fakePi();
    registerWorkerRouting(pi, deps);
    const input: Input = base();

    await handlers.get("tool_call")?.(h.call("t1", input), h.ctx);
    await handlers.get("tool_result")?.(h.result("t1"), h.ctx);

    expect(input["model"]).toBe("fx/fast");
    expect(lines).toHaveLength(1);
  });

  test("agentDir is read when a launch is classified, not at registration", async () => {
    const h = harness();
    const dir = tempDir("jev-order-agents-");
    let reads = 0;
    const deps = baseDeps();
    Object.defineProperty(deps, "agentDir", {
      get: () => (reads++, dir),
      enumerable: true,
      configurable: true,
    });
    const { pi, handlers } = fakePi();

    registerWorkerRouting(pi, deps);
    const atRegistration = reads;
    await handlers.get("tool_call")?.(h.call("t1", base()), h.ctx);

    expect(atRegistration).toBe(0);
    expect(reads).toBeGreaterThan(0);
  });

  test("an agentDir getter that throws fails the launch open, not the registration", async () => {
    const h = harness();
    const deps = baseDeps();
    Object.defineProperty(deps, "agentDir", {
      get: () => {
        throw new Error("agents unavailable");
      },
      enumerable: true,
      configurable: true,
    });
    const { pi, handlers } = fakePi();
    const input = base();

    expect(() => registerWorkerRouting(pi, deps)).not.toThrow();
    await handlers.get("tool_call")?.(h.call("t1", input), h.ctx);

    expect(input).not.toHaveProperty("model");
  });
});

describe("tool counts", () => {
  test("a line that fails before its counts leaves the counts in place", async () => {
    const h = harness();
    const broken = {
      kind: "ok",
      body: body("fast"),
      get ms(): number {
        throw new Error("ms unavailable");
      },
    } as unknown as JevOutcome;
    h.setScript(() => broken);
    putToolCounts("ag-c1", { toolsScored: 5, toolsFlagged: 2 });
    const input = base();

    await h.fire("message_end", h.msg(["c1", input]));
    await h.fire("tool_call", h.call("c1", input));
    await h.fire("tool_result", h.result("c1", "ag-c1"));
    await h.emit("subagents:completed", { id: "ag-c1", status: "completed" });

    expect(h.lines).toHaveLength(0);
    expect(takeToolCounts("ag-c1")).toEqual({ toolsScored: 5, toolsFlagged: 2 });
  });
});

describe("message_end", () => {
  test("a launch before a broken block is still classified", async () => {
    const h = harness();
    const message = {
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", id: "m1", name: "subagent", arguments: base() },
          {
            get type(): string {
              throw new Error("bad block");
            },
          },
        ],
      },
    };

    await h.fire("message_end", message);

    expect(h.asks).toHaveLength(1);
    expect(h.routing.pending()).toBe(1);
  });
});

describe("tool_call stamps", () => {
  test("the caller model is read before the session id is stamped", async () => {
    const h = harness();
    const order: string[] = [];
    let sessionReads = 0;
    h.ctx.sessionManager.getSessionId = () => (order.push(`session-${++sessionReads}`), "main-1");
    const input: Input = base();
    Object.defineProperty(input, "model", {
      configurable: true,
      get: () => (order.push("model-read"), undefined),
      set: () => {
        order.push("model-write");
      },
    });

    await h.fire("tool_call", h.call("t1", input));

    expect(order.slice(0, 3)).toEqual(["session-1", "model-read", "session-2"]);
  });

  test("a launch keeps its caller model when the session id fails once", async () => {
    const h = harness();
    let sessionReads = 0;
    h.ctx.sessionManager.getSessionId = () => {
      if (++sessionReads === 2) throw new Error("session unavailable");
      return "main-1";
    };
    const input: Input = { ...base(), model: "caller/original" };

    await h.fire("tool_call", h.call("t1", input));
    delete input["model"];
    await h.fire("tool_call", h.call("t1", input));
    await h.fire("tool_result", h.result("t1"));

    expect(h.lines[0]?.["callerModel"]).toBe("caller/original");
  });
});

describe("executor outcomes", () => {
  test("an outcome is stamped before its fields are read", async () => {
    const h = harness();
    const input: Input = { ...base(), resume: "ag-e1" };
    const data = {
      id: "ag-e1",
      status: "completed",
      get tokens() {
        void h.fire("tool_call", h.call("e1", input));
        return { total: 10 };
      },
    };

    await h.emit("subagents:completed", data);
    await h.fire("tool_result", h.result("e1", "ag-e1"));

    expect(h.lines).toHaveLength(0);
    expect(h.routing.pending()).toBe(1);
  });
});

describe("off", () => {
  test("held launches stay counted while handlers unsubscribe", async () => {
    const h = harness();
    const observed: number[] = [];
    let routing: ReturnType<typeof registerWorkerRouting> | undefined;
    const { pi, handlers } = fakePi(() => void observed.push(routing?.pending() ?? -1));
    routing = registerWorkerRouting(pi, baseDeps());
    await handlers.get("tool_call")?.(h.call("t1", base()), h.ctx);

    routing.off();

    expect(observed.length).toBeGreaterThan(0);
    expect(observed.every((pending) => pending === 1)).toBe(true);
    expect(routing.pending()).toBe(0);
  });
});

describe("warnings", () => {
  test("a launch without a UI does not use up the warning", async () => {
    const reg = { "fx/fast": {}, "fx/balanced": {}, "fx/deep": { auth: false } };
    const h = harness({ reg });
    h.setScript(() => ok(body("deep")));
    const ctx = h.ctx as { hasUI: boolean };

    ctx.hasUI = false;
    await h.fire("tool_call", h.call("w1", base()));
    ctx.hasUI = true;
    await h.fire("tool_call", h.call("w2", base()));
    await h.fire("tool_call", h.call("w3", base()));

    expect(h.notes).toHaveLength(1);
  });
});
