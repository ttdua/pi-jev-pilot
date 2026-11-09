import { mkdirSync, writeFileSync } from "node:fs";
import { WORKER_TIER_CRITERIA } from "../../src/jev/rubrics.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { WindowEntry } from "../../src/policy/worker/cutpoints.ts";
import { CHILDREN_KEY } from "../../src/host/platform/child.ts";
import { registerWorkerRouting } from "../../src/host/worker/routing.ts";
import { tempDir } from "../helpers.ts";
import {
  base,
  body,
  bodyWith,
  effort,
  harness,
  ok,
  snap,
  TIERS,
  TIERS_X,
  type Handler,
  type Opts,
} from "./worker-fakes.ts";

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
    const input: Record<string, unknown> = base();
    await h.fire("message_end", h.msg(["a", input]));
    await h.fire("tool_call", h.call("a", input));
    expect(input).toMatchObject({ model: "fx/balanced" });
  });

  test("Missing credentials", async () => {
    const h = harness({ reg: { "fx/fast": {}, "fx/balanced": {}, "fx/deep": { auth: false } } });
    h.setScript(() => ok(body("deep")));
    const input: Record<string, unknown> = base();
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
    const input: Record<string, unknown> = base();
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
    const input: Record<string, unknown> = base();
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
    h.setScript(() => ok(body("balanced", "high")));
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

describe("One mode per launch", () => {
  const split = { fast: 0.05, balanced: 0.15, deep: 0.5, expert: 0.3 };
  // Score 2.175: expert in premium (cut 2.125), deep in standard (cut 2.345).
  const between = { fast: 0.05, balanced: 0.15, deep: 0.75, expert: 0.05 };

  test("Every mode sends the one worker rubric", async () => {
    const h = harness({ mode: "premium" });
    await h.fire("message_end", h.msg(["a", base()]));
    const q = h.asks[0]?.questions as { tier: { criteria: Record<string, string> } };
    // The fake registry names a model by its id, so the display-name prefix comes first.
    expect(q.tier.criteria["deep"]).toBe(`deep. ${WORKER_TIER_CRITERIA.deep}`);
  });

  test("Mode changed between message end and launch", async () => {
    const h = harness({ tiers: TIERS_X, mode: "standard" });
    h.setScript(() => ok(bodyWith("deep", between, "xhigh")));
    const input: Record<string, unknown> = base();
    await h.fire("message_end", h.msg(["a", input]));
    h.setSnap({ tiers: TIERS_X, mode: "premium" });
    await h.fire("tool_call", h.call("a", input));
    await h.fire("tool_result", h.result("a", "ag-a"));
    await h.emit("subagents:completed", { id: "ag-a", status: "completed" });
    expect(input["model"]).toBe("fx/deep");
    expect(h.lines[0]).toMatchObject({ mode: "standard", reason: "cut", score: 2.175 });
  });

  test("Premium at classification admits expert", async () => {
    const h = harness({ tiers: TIERS_X, mode: "premium" });
    h.setScript(() => ok(bodyWith("deep", split, "xhigh")));
    const input: Record<string, unknown> = base();
    await h.fire("message_end", h.msg(["a", input]));
    await h.fire("tool_call", h.call("a", input));
    expect(input["model"]).toBe("fx/expert");
  });

  test("Premium with expert switched off", async () => {
    const h = harness({ tiers: TIERS_X, mode: "premium", switches: { expert: false } });
    const three = { fast: 0.05, balanced: 0.15, deep: 0.8 };
    h.setScript(() => ok(bodyWith("deep", three, "xhigh")));
    const input: Record<string, unknown> = base();
    await h.fire("message_end", h.msg(["a", input]));
    const q = h.asks[0]?.questions as { tier: { criteria: Record<string, string> } };
    expect(q).not.toHaveProperty("expert_needed");
    expect(Object.keys(q.tier.criteria)).toEqual(["fast", "balanced", "deep"]);
    await h.fire("tool_call", h.call("a", input));
    expect(input["model"]).toBe("fx/deep");
  });
});

describe("Cut points of a launch", () => {
  // 100 medium-effort entries, scores 0.02 … 2.00: standard puts 1.25 on balanced, premium on deep.
  const spread: WindowEntry[] = Array.from({ length: 100 }, (_, i) => ({
    score: (i + 1) / 50,
    effort: "medium",
    decided: "balanced",
  }));
  const routed = async (h: ReturnType<typeof harness>, id: string, siblings = true) => {
    const input: Record<string, unknown> = base();
    if (siblings) await h.fire("message_end", h.msg([id, input]));
    await h.fire("tool_call", h.call(id, input));
    return input["model"];
  };

  test("Siblings share a window state", async () => {
    let window: readonly WindowEntry[] = spread;
    const h = harness({ mode: "premium", window: () => window });
    h.setScript(() => ok(body("balanced", "high")));
    const a: Record<string, unknown> = base();
    const b: Record<string, unknown> = base();
    await h.fire("message_end", h.msg(["a", a], ["b", b]));
    window = []; // changes after the message ended
    await h.fire("tool_call", h.call("a", a));
    await h.fire("tool_call", h.call("b", b));
    expect(a["model"]).toBe("fx/deep");
    expect(b["model"]).toBe("fx/deep");
  });

  test("Launch classified alone", async () => {
    let window: readonly WindowEntry[] = [];
    const h = harness({ mode: "premium", window: () => window });
    h.setScript(() => ok(body("balanced", "high")));
    expect(await routed(h, "a", false)).toBe("fx/balanced"); // seed
    window = spread;
    expect(await routed(h, "b", false)).toBe("fx/deep");
  });

  test("Two launches in different modes use different cut points from one window", async () => {
    const h = harness({ mode: "standard", window: () => spread });
    h.setScript(() => ok(body("balanced", "high")));
    expect(await routed(h, "a", false)).toBe("fx/balanced");
    h.setSnap({ mode: "premium" });
    expect(await routed(h, "b", false)).toBe("fx/deep");
  });

  test("Without a window the seed applies", async () => {
    const h = harness({ mode: "standard" });
    h.setScript(() => ok(body("balanced", "high")));
    expect(await routed(h, "a")).toBe("fx/balanced");
  });
});

describe("Slots", () => {
  const REVIEWER = { name: "reviewer", model: "fx/review", when: "Code review." };
  const reg = {
    "fx/fast": {},
    "fx/balanced": {},
    "fx/deep": {},
    "fx/review": { name: "Fixture Review" },
  };
  const slotAnswer = (p = 0.92) =>
    ok({
      answers: {
        tier: {
          type: "choice",
          choice: "slot::reviewer",
          confidence: p,
          probabilities: { fast: 0, balanced: 0, deep: 0, "slot::reviewer": p },
        },
        effort: effort("high"),
        risky: { type: "noul", noul: 0.1 },
      },
    });
  async function launch(h: ReturnType<typeof harness>, id: string) {
    const input: Record<string, unknown> = base();
    await h.fire("message_end", h.msg([id, input]));
    await h.fire("tool_call", h.call(id, input));
    return input;
  }
  const unusable = () =>
    harness({ slots: [REVIEWER], reg: { ...reg, "fx/review": { auth: false } } });

  test("Slot display name", async () => {
    const h = harness({ slots: [REVIEWER], reg });
    await h.fire("message_end", h.msg(["a", base()]));
    const q = h.asks[0]?.questions as { tier: { criteria: Record<string, string> } };
    expect(q.tier.criteria["slot::reviewer"]).toBe("Fixture Review (a custom model). Code review.");
  });

  test("Usable slot routes", async () => {
    const h = harness({ slots: [REVIEWER], reg });
    h.setScript(() => slotAnswer());
    expect(await launch(h, "a")).toMatchObject({ model: "fx/review", thinking: "high" });
  });

  test("Unusable slot", async () => {
    const h = unusable();
    h.setScript(() => slotAnswer());
    expect(await launch(h, "a")).toMatchObject({ model: "fx/balanced" });
  });

  test("Slot warning text", async () => {
    const h = unusable();
    h.setScript(() => slotAnswer());
    await launch(h, "a");
    expect(h.notes).toHaveLength(1);
    for (const s of [
      "slot reviewer",
      "fx/review",
      "no credentials",
      "balanced",
      'crew.slots "reviewer" model',
    ]) {
      expect(h.notes[0]?.text).toContain(s);
    }
    expect(h.notes[0]?.text).not.toContain("tiers.");
  });

  test("Once per slot", async () => {
    const h = unusable();
    h.setScript(() => slotAnswer());
    for (const id of ["a", "b", "c"]) await launch(h, id);
    expect(h.notes).toHaveLength(1);
  });

  test("Slot warning with nothing to fall back to", async () => {
    const h = harness({
      slots: [REVIEWER],
      reg: {
        "fx/fast": { auth: false },
        "fx/balanced": { auth: false },
        "fx/deep": {},
        "fx/review": { auth: false },
      },
    });
    h.setScript(() => slotAnswer());
    const input = await launch(h, "a");
    expect(h.notes[0]?.text).toContain("launch left unchanged");
    expect(input).toEqual(base());
  });

  test("Slot warning shown again after its model changes", async () => {
    const h = unusable();
    h.setScript(() => slotAnswer());
    await launch(h, "a");
    h.setSnap({ slots: [{ ...REVIEWER, model: "fx/other" }] });
    await launch(h, "b");
    expect(h.notes).toHaveLength(2);
  });

  test("Slot warning shown again after a slot command", async () => {
    const h = unusable();
    h.setScript(() => slotAnswer());
    await launch(h, "a");
    h.routing.clearWarnings();
    await launch(h, "b");
    expect(h.notes).toHaveLength(2);
  });

  test("Forked launch with thinking and a slot", async () => {
    const h = harness({ forkedLaunch: "thinking", slots: [REVIEWER], reg });
    await h.fire("message_end", h.msg(["a", { ...base(), inherit_context: true }]));
    expect(Object.keys(h.asks[0]?.questions as object).sort()).toEqual(["effort", "risky"]);
  });

  test("Slot removed before the tool call", async () => {
    const h = harness({ slots: [REVIEWER], reg });
    h.setScript(() => slotAnswer());
    const input: Record<string, unknown> = base();
    await h.fire("message_end", h.msg(["a", input]));
    h.setSnap({});
    await h.fire("tool_call", h.call("a", input));
    expect(input).toMatchObject({ model: "fx/review" });
  });
});
