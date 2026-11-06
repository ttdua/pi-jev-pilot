import { mkdirSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CHILDREN_KEY } from "../../src/host/child.ts";
import { registerWorkerRouting } from "../../src/host/worker.ts";
import { tempDir } from "../helpers.ts";
import { base, body, harness, ok, snap, TIERS, type Handler, type Opts } from "./worker-fakes.ts";

const saved = process.env.TYPESAFE_API_KEY;
beforeEach(() => {
  process.env.TYPESAFE_API_KEY = "k";
});
afterEach(() => {
  if (saved === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = saved;
});

describe("When routing runs", () => {
  const gated: [string, Opts][] = [
    ["Switch off", { switches: { subagents: false } }],
    ["No key", { keySet: false }],
    ["Invalid config", { valid: false }],
    ["Executor absent", { executor: false }],
  ];
  for (const [name, o] of gated) {
    test(name, async () => {
      const h = harness(o);
      const input = { ...base(), model: "fx/main" };
      const before = structuredClone(input);
      await h.fire("message_end", h.msg(["t1", input]));
      await h.fire("tool_call", h.call("t1", input));
      expect(h.asks).toHaveLength(0);
      expect(input).toEqual(before);
    });
  }

  test("Child session", async () => {
    const h = harness();
    const g = globalThis as Record<symbol, Set<string> | undefined>;
    const had = g[CHILDREN_KEY];
    g[CHILDREN_KEY] = new Set(["main-1"]);
    try {
      await h.fire("message_end", h.msg(["t1", base()]));
    } finally {
      g[CHILDREN_KEY] = had;
    }
    expect(h.asks).toHaveLength(0);
  });

  test("Nested launch with the switch off", async () => {
    const h = harness({ switches: { subagents: false } });
    const input = base();
    await h.fire("tool_call", h.call("p/1", input, { parentToolCallId: "p" }));
    expect(h.asks).toHaveLength(0);
    expect(input).toEqual(base());
  });

  test("Other tools ignored", async () => {
    const h = harness();
    await h.fire("message_end", {
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", id: "a", name: "read", arguments: {} },
          { type: "toolCall", id: "b", name: "bash", arguments: {} },
        ],
      },
    });
    expect(h.asks).toHaveLength(0);
  });
});

describe("Sibling launches classified together", () => {
  test("Two launches", async () => {
    const h = harness();
    h.setScript((req) => ok(body((req.state as { task: { brief: string } }).task.brief)));
    const a = { ...base(), prompt: "fast" };
    const b = { ...base(), prompt: "deep" };
    await h.fire("message_end", h.msg(["a", a], ["b", b]));
    expect(h.asks).toHaveLength(2);
    expect(h.routing.pending()).toBe(2);
    await h.fire("tool_call", h.call("a", a));
    await h.fire("tool_call", h.call("b", b));
    expect(h.asks).toHaveLength(2);
    expect(a).toMatchObject({ model: "fx/fast" });
    expect(b).toMatchObject({ model: "fx/deep" });
  });

  test("Untouched launch not asked", async () => {
    const h = harness();
    const resumed = { ...base(), resume: "agent-1" };
    await h.fire("message_end", h.msg(["a", resumed], ["b", base()]));
    expect(h.asks).toHaveLength(1);
    await h.fire("tool_call", h.call("a", resumed));
    expect(resumed).toEqual({ ...base(), resume: "agent-1" });
  });
});

describe("Launches without a cached result", () => {
  test("Nested launch", async () => {
    const h = harness();
    const input = { ...base(), model: "fx/main" };
    await h.fire("tool_call", h.call("p/1", input, { parentToolCallId: "p" }));
    expect(h.asks).toHaveLength(1);
    expect((h.asks[0]!.state as { task: { brief: string } }).task.brief).toBe("do a thing");
    expect(input).toMatchObject({ model: "fx/fast", thinking: "medium" });
  });

  test("Nested launch with Jev down", async () => {
    const h = harness();
    h.setScript(() => ({ kind: "miss", miss: "timeout", reason: "t", ms: 5 }));
    const input = { ...base(), model: "fx/main" };
    await h.fire("tool_call", h.call("p/1", input, { parentToolCallId: "p" }));
    expect(input).toEqual({ ...base(), model: "fx/main" });
  });
});

describe("Worker request content", () => {
  test("Display name prefix", async () => {
    const h = harness();
    await h.fire("message_end", h.msg(["a", base()]));
    const q = h.asks[0]?.questions as { tier: { criteria: Record<string, string> } };
    expect(q.tier.criteria["fast"]?.startsWith("Fixture Fast. ")).toBe(true);
  });

  test("Parent request on", async () => {
    const h = harness({ parentRequest: true });
    await h.fire("message_end", h.msg(["a", base()]));
    expect((h.asks[0]!.state as { parent_request?: string }).parent_request).toBe("do X");
  });

  test("Parent request off", async () => {
    const h = harness({ parentRequest: false });
    await h.fire("message_end", h.msg(["a", base()]));
    expect(h.asks[0]?.state).not.toHaveProperty("parent_request");
  });

  test("Forked launch with thinking asks fewer questions", async () => {
    const h = harness({ forkedLaunch: "thinking" });
    await h.fire("message_end", h.msg(["a", { ...base(), inherit_context: true }]));
    expect(Object.keys(h.asks[0]?.questions as object).sort()).toEqual(["effort", "risky"]);
  });
});

describe("Target check before writing", () => {
  test("Unknown model", async () => {
    const h = harness({ reg: { "fx/fast": {}, "fx/balanced": {} } });
    h.setScript(() => ok(body("deep")));
    const input = base();
    await h.fire("message_end", h.msg(["a", input]));
    await h.fire("tool_call", h.call("a", input));
    expect(input).toMatchObject({ model: "fx/balanced" });
  });

  test("Missing credentials", async () => {
    const h = harness({ reg: { "fx/fast": {}, "fx/balanced": {}, "fx/deep": { auth: false } } });
    h.setScript(() => ok(body("deep")));
    const input = base();
    await h.fire("message_end", h.msg(["a", input]));
    await h.fire("tool_call", h.call("a", input));
    expect(input).toMatchObject({ model: "fx/balanced" });
  });

  test("Model-locked launch not checked", async () => {
    const h = harness({ reg: { "fx/fast": {}, "fx/balanced": {}, "fx/deep": { auth: false } } });
    h.setScript(() => ok(body("deep")));
    const { cwd } = h.ctx;
    mkdirSync(`${cwd}/.pi/agents`, { recursive: true });
    writeFileSync(`${cwd}/.pi/agents/locker.md`, "---\nmodel: fx/x\nlocked: model\n---\nbody\n");
    const input = { ...base(), subagent_type: "locker" };
    await h.fire("message_end", h.msg(["a", input]));
    await h.fire("tool_call", h.call("a", input));
    expect(h.notes).toHaveLength(0);
    expect(input).not.toHaveProperty("model");
  });

  test("Model id with a slash", async () => {
    const h = harness({
      tiers: { ...TIERS, fast: "openrouter/anthropic/claude" },
      reg: { "openrouter/anthropic/claude": {}, "fx/balanced": {}, "fx/deep": {} },
    });
    const input = base();
    await h.fire("message_end", h.msg(["a", input]));
    await h.fire("tool_call", h.call("a", input));
    expect(h.finds).toContain("openrouter|anthropic/claude");
    expect(input).toMatchObject({ model: "openrouter/anthropic/claude" });
  });
});

describe("Input mutation", () => {
  test("Caller model replaced", async () => {
    const h = harness();
    const input = { ...base(), model: "fx/main", thinking: "high", run_in_background: true };
    await h.fire("message_end", h.msg(["a", input]));
    await h.fire("tool_call", h.call("a", input));
    expect(input).toEqual({
      ...base(),
      model: "fx/fast",
      thinking: "medium",
      run_in_background: true,
    });
  });

  test("Resume untouched", async () => {
    const h = harness();
    const input = { ...base(), resume: "x", model: "fx/main" };
    await h.fire("tool_call", h.call("a", input));
    expect(input).toEqual({ ...base(), resume: "x", model: "fx/main" });
  });
});

describe("Routing fails open", () => {
  test("Jev error", async () => {
    const h = harness();
    h.setScript(() => ({ kind: "miss", miss: "error", reason: "500", ms: 1 }));
    const input = { ...base(), model: "m" };
    await h.fire("message_end", h.msg(["a", input]));
    await h.fire("tool_call", h.call("a", input));
    expect(input).toEqual({ ...base(), model: "m" });
  });

  test("Unreadable answers", async () => {
    const h = harness();
    h.setScript(() => ok({ nope: 1 }));
    const input = { ...base(), model: "m" };
    await h.fire("message_end", h.msg(["a", input]));
    await h.fire("tool_call", h.call("a", input));
    expect(input).toEqual({ ...base(), model: "m" });
  });

  test("Turn cancelled", async () => {
    const h = harness();
    h.setScript(() => ({ kind: "cancelled" }));
    const input = { ...base(), model: "m" };
    await h.fire("message_end", h.msg(["a", input]));
    await h.fire("tool_call", h.call("a", input));
    expect(input).toEqual({ ...base(), model: "m" });
  });

  test("Cancelled batch not re-asked", async () => {
    const h = harness();
    h.setScript(() => ({ kind: "cancelled" }));
    const input = base();
    await h.fire("message_end", h.msg(["a", input]));
    await h.fire("tool_call", h.call("a", input));
    expect(h.asks).toHaveLength(1);
  });

  test("Internal error", async () => {
    const h = harness();
    const input = { ...base(), model: "m" };
    // ask throws synchronously
    const handlers = new Map<string, Handler[]>();
    const pi = {
      on: (n: string, f: Handler) => {
        handlers.set(n, [...(handlers.get(n) ?? []), f]);
        return () => {};
      },
    } as unknown as ExtensionAPI;
    registerWorkerRouting(pi, {
      ask: () => {
        throw new Error("boom");
      },
      snapshot: () => snap(),
      agentDir: tempDir("jev-worker-agents-"),
    });
    for (const f of handlers.get("tool_call") ?? []) {
      await f(h.call("a", input), h.ctx);
    }
    expect(input).toEqual({ ...base(), model: "m" });
  });

  test("Agent read throws", async () => {
    const h = harness();
    const input = { ...base(), subagent_type: "x", model: "m" };
    Object.defineProperty(input, "subagent_type", {
      get() {
        throw new Error("boom");
      },
      enumerable: true,
    });
    await h.fire("message_end", h.msg(["a", input]));
    await h.fire("tool_call", h.call("a", input));
    expect(input.model).toBe("m");
  });

  test("off() makes handlers no-ops", async () => {
    const h = harness();
    h.routing.off();
    await h.fire("message_end", h.msg(["a", base()]));
    expect(h.asks).toHaveLength(0);
    expect(h.routing.pending()).toBe(0);
  });
});

describe("Fallback warning", () => {
  const noDeep = { "fx/fast": {}, "fx/balanced": {}, "fx/deep": { auth: false } };
  async function launch(h: ReturnType<typeof harness>, id: string) {
    const input = base();
    await h.fire("message_end", h.msg([id, input]));
    await h.fire("tool_call", h.call(id, input));
    return input;
  }

  test("Warning text", async () => {
    const h = harness({ reg: noDeep });
    h.setScript(() => ok(body("deep")));
    await launch(h, "a");
    expect(h.notes).toHaveLength(1);
    const n = h.notes[0];
    expect(n?.type).toBe("warning");
    for (const s of ["tier deep", "fx/deep", "no credentials", "using balanced", "tiers.deep"]) {
      expect(n?.text).toContain(s);
    }
  });

  test("Once per tier", async () => {
    const h = harness({ reg: noDeep });
    h.setScript(() => ok(body("deep")));
    await launch(h, "a");
    await launch(h, "b");
    await launch(h, "c");
    expect(h.notes).toHaveLength(1);
  });

  test("Shown again after a model change", async () => {
    const h = harness({ reg: noDeep });
    h.setScript(() => ok(body("deep")));
    await launch(h, "a");
    h.setSnap({ tiers: { ...TIERS, deep: "fx/deep2" } });
    await launch(h, "b");
    expect(h.notes).toHaveLength(2);
    expect(h.notes[1]?.text).toContain("not in the model registry");
  });

  test("Shown again after /jev", async () => {
    const h = harness({ reg: noDeep });
    h.setScript(() => ok(body("deep")));
    await launch(h, "a");
    h.routing.clearWarnings();
    await launch(h, "b");
    expect(h.notes).toHaveLength(2);
  });

  test("Nothing can run", async () => {
    const h = harness({ reg: { "fx/fast": { auth: false }, "fx/balanced": { auth: false } } });
    h.setScript(() => ok(body("balanced")));
    const input = await launch(h, "a");
    expect(h.notes).toHaveLength(1);
    expect(h.notes[0]?.text).toContain("tier balanced");
    expect(h.notes[0]?.text).toContain("launch left unchanged");
    expect(input).toEqual(base());
  });

  test("Unknown model wording", async () => {
    const h = harness({ reg: { "fx/fast": {}, "fx/balanced": {} } });
    h.setScript(() => ok(body("deep")));
    await launch(h, "a");
    expect(h.notes[0]?.text).toContain("not in the model registry");
  });

  test("No UI", async () => {
    const h = harness({ reg: noDeep });
    h.setScript(() => ok(body("deep")));
    (h.ctx as { hasUI: boolean }).hasUI = false;
    const input = await launch(h, "a");
    expect(h.notes).toHaveLength(0);
    expect(input).toMatchObject({ model: "fx/balanced" });
  });
});
