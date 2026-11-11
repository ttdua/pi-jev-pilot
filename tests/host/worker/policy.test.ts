import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { askJev, type JevOutcome } from "../../../src/jev/client.ts";
import { WORKER_TIER_CRITERIA } from "../../../src/jev/rubrics.ts";
import { CHILDREN_KEY } from "../../../src/host/platform/child.ts";
import {
  POLICY_TIMEOUT_MS,
  registerWorkerRouting,
  SLOT_TAKEN,
} from "../../../src/host/worker/routing.ts";
import type { WindowEntry } from "../../../src/policy/worker/cutpoints.ts";
import { validateLedgerEntry } from "../../../src/store/ledger-schema.ts";
import { startJevFixture } from "../../jev/fixture.ts";
import {
  body,
  bodyWith,
  effort,
  fakeService,
  harness,
  ok,
  runToCompletion,
  snap,
  TIERS,
  TIERS_X,
  type Opts,
} from "../worker-fakes.ts";

const saved = process.env.TYPESAFE_API_KEY;
beforeEach(() => {
  process.env.TYPESAFE_API_KEY = "k";
});
afterEach(() => {
  if (saved === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = saved;
  delete (globalThis as Record<symbol, unknown>)[CHILDREN_KEY];
});

type H = ReturnType<typeof harness>;
const questionsOf = (h: H, i = 0) => h.asks[i]?.questions as Record<string, unknown>;
const tierCriteria = (h: H) =>
  (questionsOf(h) as { tier: { criteria: Record<string, string> } }).tier.criteria;

describe("Routing is the executor's launch policy", () => {
  test("registers one policy with the 10 s watchdog", () => {
    const h = harness();
    expect(h.executor.registrations).toEqual([{ timeoutMs: 10_000 }]);
    expect(POLICY_TIMEOUT_MS).toBe(10_000);
    expect(h.executor.policy()).toBeDefined();
  });

  test("registers no Pi handler", () => {
    const h = harness();
    expect(h.handlers).toEqual([]);
  });

  test("starting again unregisters the earlier policy first", () => {
    const h = harness();
    const first = h.executor.policy();
    h.routing.start(h.ctx as never);
    expect(h.executor.unregisters()).toBe(1);
    expect(h.executor.registrations).toHaveLength(2);
    expect(h.executor.policy()).not.toBe(first);
  });

  test("re-register on reload with a running worker", async () => {
    const executor = fakeService();
    const lines: unknown[] = [];
    const deps = {
      ask: () => Promise.resolve(ok(body("fast"))),
      snapshot: () => snap(),
      append: (e: unknown) => void lines.push(e),
      service: () => executor.service,
    };
    const bus = new Map<string, ((d: unknown) => void)[]>();
    const pi = {
      on: () => () => {},
      events: {
        on: (n: string, f: (d: unknown) => void) => {
          bus.set(n, [...(bus.get(n) ?? []), f]);
          return () =>
            bus.set(
              n,
              (bus.get(n) ?? []).filter((x) => x !== f),
            );
        },
      },
      getAllTools: () => [],
    } as never;
    const ctx = harness().ctx as never;
    const before = registerWorkerRouting(pi, deps);
    before.start(ctx);
    const running = await executor.policy()!(
      (await import("../worker-fakes.ts")).launchRequest({ agentId: "ag-run" }),
      new AbortController().signal,
    );
    expect(running).toEqual({ model: "fx/fast", thinking: "medium" });
    // Reload: the old instance shuts down, the new one starts in the new runtime.
    before.off();
    const after = registerWorkerRouting(pi, deps);
    expect(() => after.start(ctx)).not.toThrow();
    expect(executor.unregisters()).toBe(1);
    expect(executor.registrations).toHaveLength(2);
    expect(after.problems()).toEqual([]);
    for (const f of bus.get("subagents:completed") ?? []) f({ id: "ag-run", status: "completed" });
    expect(lines).toHaveLength(0);
  });
});

describe("Launches routing acts on", () => {
  test("Launch from a worker", async () => {
    const h = harness();
    (globalThis as Record<symbol, unknown>)[CHILDREN_KEY] = new Set(["child-1"]);
    const { adjustment } = await h.launch({ parentSessionId: "child-1" });
    expect(adjustment).toBeUndefined();
    expect(h.asks).toHaveLength(0);
  });

  test("Child session", async () => {
    const h = harness({ switches: { tools: true } });
    (globalThis as Record<symbol, unknown>)[CHILDREN_KEY] = new Set(["child-1"]);
    await h.launch({ parentSessionId: "child-1" });
    expect(h.asks).toHaveLength(0);
  });

  test("a launch from the main session is routed", async () => {
    const h = harness();
    const { adjustment } = await h.launch({ parentSessionId: "main-1" });
    expect(adjustment).toEqual({ model: "fx/fast", thinking: "medium" });
  });

  test("Service launch with an explicit model", async () => {
    const h = harness();
    h.setScript(() => ok(body("fast", "high")));
    const { adjustment, request } = await h.launch({
      origin: { kind: "service" },
      requested: { model: "fixture/fixture-deep" },
    });
    expect(adjustment).toEqual({ thinking: "high" });
    h.created(request.agentId, {
      effectiveModel: "fixture/fixture-deep",
      effectiveThinking: "high",
    });
    h.completed(request.agentId);
    expect(h.lines[0]).toMatchObject({ locked: true, tier: "fast", reason: "cut" });
    expect(h.lines[0]).not.toHaveProperty("model");
  });

  test("Service launch of an agent with its own model, no caller model → routed", async () => {
    const h = harness();
    // The executor fills `requested.model` from the agent's own `model:` when the caller names none.
    const { adjustment, request } = await h.launch({
      origin: { kind: "service" },
      agent: { name: "worker", source: "project", model: "fixture/fixture-agent" },
      requested: { model: "fixture/fixture-agent" },
    });
    expect(adjustment).toEqual({ model: "fx/fast", thinking: "medium" });
    h.created(request.agentId);
    h.completed(request.agentId);
    expect(h.lines[0]).not.toHaveProperty("locked");
    expect(h.lines[0]).toMatchObject({ model: "fx/fast" });
  });

  test("Service launch without a model", async () => {
    const h = harness();
    const { adjustment } = await h.launch({ origin: { kind: "service" } });
    expect(adjustment).toEqual({ model: "fx/fast", thinking: "medium" });
  });

  test("service fork with explicit model", async () => {
    const forked = { origin: { kind: "service" as const }, requested: { model: "fx/main" } };
    const thinking = harness({ forkedLaunch: "thinking" });
    thinking.setScript(() => ok(body("deep", "high")));
    const r = await thinking.launch({ ...forked, inheritContext: true });
    expect(Object.keys(questionsOf(thinking)).sort()).toEqual(["effort", "risky"]);
    expect(r.adjustment).toEqual({ thinking: "high" });
    const untouched = harness({ forkedLaunch: "untouched" });
    const u = await untouched.launch({ ...forked, inheritContext: true });
    expect(u.adjustment).toBeUndefined();
    expect(untouched.asks).toHaveLength(0);
  });
});

describe("Launch policy slot taken", () => {
  test("Slot taken", async () => {
    const h = harness({ taken: true });
    const { adjustment } = await h.launch();
    expect(adjustment).toBeUndefined();
    expect(h.asks).toHaveLength(0);
    expect(h.routing.problems()).toEqual([SLOT_TAKEN]);
    expect(SLOT_TAKEN).toBe("launch policy held by another extension");
  });

  test("a later start that registers clears the problem", () => {
    const executor = fakeService();
    const blocker = executor.service.registerLaunchPolicy(() => undefined, { timeoutMs: 1 });
    const routing = registerWorkerRouting(
      { on: () => () => {}, events: { on: () => () => {} } } as never,
      { snapshot: () => snap(), service: () => executor.service },
    );
    routing.start(harness().ctx as never);
    expect(routing.problems()).toEqual([SLOT_TAKEN]);
    blocker();
    routing.start(harness().ctx as never);
    expect(routing.problems()).toEqual([]);
  });
});

describe("When routing runs", () => {
  const gated: [string, Opts][] = [
    ["Switch off", { switches: { subagents: false } }],
    ["No key", { keySet: false }],
    ["Invalid config", { valid: false }],
    ["Duplicate executor", { executor: "duplicate" }],
  ];
  for (const [name, o] of gated) {
    test(name, async () => {
      const h = harness(o);
      const { adjustment } = await h.launch({ requested: { model: "fx/main" } });
      expect(h.asks).toHaveLength(0);
      expect(adjustment).toBeUndefined();
    });
  }

  test("Executor absent", async () => {
    const h = harness({ executor: false });
    expect(h.executor.registrations).toHaveLength(0);
    expect(h.executor.policy()).toBeUndefined();
    expect(h.asks).toHaveLength(0);
  });

  test("conditions are read fresh at each policy call", async () => {
    const h = harness({ switches: { subagents: false } });
    await h.launch();
    expect(h.asks).toHaveLength(0);
    h.setSnap({});
    await h.launch();
    expect(h.asks).toHaveLength(1);
  });

  test("Other tools ignored", () => {
    const h = harness();
    expect(h.handlers).toEqual([]);
    expect(h.asks).toHaveLength(0);
  });

  test("Nested launch with the switch off", async () => {
    const h = harness({ switches: { subagents: false } });
    const { adjustment } = await h.launch({ origin: { kind: "tool", toolCallId: "p/1" } });
    expect(h.asks).toHaveLength(0);
    expect(adjustment).toBeUndefined();
  });
});

describe("Worker request content", () => {
  test("Display name prefix", async () => {
    const h = harness();
    await h.launch();
    expect(tierCriteria(h)["fast"]?.startsWith("Fixture Fast. ")).toBe(true);
  });

  test("Slot display name", async () => {
    const h = harness({
      slots: [{ name: "reviewer", model: "fx/review", when: "Code review." }],
      reg: {
        "fx/fast": {},
        "fx/balanced": {},
        "fx/deep": {},
        "fx/review": { name: "Fixture Review" },
      },
    });
    await h.launch();
    expect(tierCriteria(h)["slot::reviewer"]).toBe("Fixture Review (a custom model). Code review.");
  });

  test("Parent request on", async () => {
    const h = harness({ parentRequest: true });
    await h.launch();
    expect((h.asks[0]!.state as { parent_request?: string }).parent_request).toBe("do X");
  });

  test("Parent request off", async () => {
    const h = harness({ parentRequest: false });
    await h.launch();
    expect(h.asks[0]?.state).not.toHaveProperty("parent_request");
  });

  test("Forked launch with thinking asks fewer questions", async () => {
    const h = harness({ forkedLaunch: "thinking" });
    await h.launch({ inheritContext: true });
    expect(Object.keys(questionsOf(h)).sort()).toEqual(["effort", "risky"]);
  });

  test("Service launch content", async () => {
    const h = harness();
    await h.launch({
      origin: { kind: "service" },
      agent: { name: "Plan", source: "builtin", description: "Planner" },
      prompt: "brief text",
      description: "probe",
    });
    const state = h.asks[0]!.state as { task: { brief: string; description: string } };
    expect(state).toMatchObject({ agent: { name: "Plan" } });
    expect(state.task).toMatchObject({ brief: "brief text", description: "probe" });
  });

  test("the request carries isBackground and the agent from the snapshot", async () => {
    const h = harness();
    await h.launch({ isBackground: true, agent: { name: "worker", source: "project" } });
    expect(h.asks[0]!.state).toMatchObject({
      agent: { name: "worker", source: "project", run_in_background: true },
    });
  });
});

describe("Target check before writing", () => {
  test("Unknown model", async () => {
    const h = harness({ reg: { "fx/fast": {}, "fx/balanced": {} } });
    h.setScript(() => ok(body("deep")));
    expect((await h.launch()).adjustment).toMatchObject({ model: "fx/balanced" });
  });

  test("Missing credentials", async () => {
    const h = harness({ reg: { "fx/fast": {}, "fx/balanced": {}, "fx/deep": { auth: false } } });
    h.setScript(() => ok(body("deep")));
    expect((await h.launch()).adjustment).toMatchObject({ model: "fx/balanced" });
  });

  test("Model-locked launch not checked", async () => {
    const h = harness({ reg: { "fx/fast": {}, "fx/balanced": {}, "fx/deep": { auth: false } } });
    h.setScript(() => ok(body("deep")));
    const { adjustment } = await h.launch({
      agent: { name: "locker", source: "project", model: "fx/x", locked: ["model"] },
      locked: ["model"],
    });
    expect(h.notes).toHaveLength(0);
    expect(adjustment).not.toHaveProperty("model");
  });

  test("Agent lock declaration is not read, only the request's locked", async () => {
    const h = harness({ reg: { "fx/fast": {}, "fx/balanced": {}, "fx/deep": {} } });
    h.setScript(() => ok(body("deep")));
    const { adjustment } = await h.launch({
      agent: { name: "locker", source: "project", model: "fx/x", locked: true },
      locked: [],
    });
    expect(h.lines[0]).not.toHaveProperty("locked");
    expect(adjustment).toMatchObject({ model: "fx/deep" });
  });

  test("Model id with a slash", async () => {
    const h = harness({
      tiers: { ...TIERS, fast: "openrouter/anthropic/claude" },
      reg: { "openrouter/anthropic/claude": {}, "fx/balanced": {}, "fx/deep": {} },
    });
    const { adjustment } = await h.launch();
    expect(h.finds).toContain("openrouter|anthropic/claude");
    expect(adjustment).toMatchObject({ model: "openrouter/anthropic/claude" });
  });
});

describe("Input mutation", () => {
  test("Caller model replaced", async () => {
    const h = harness();
    const { adjustment } = await h.launch({
      requested: { model: "fx/main", thinking: "high" },
      isBackground: true,
    });
    expect(adjustment).toEqual({ model: "fx/fast", thinking: "medium" });
  });

  test("a route that writes nothing returns no adjustment", async () => {
    const h = harness({ forkedLaunch: "untouched" });
    expect((await h.launch({ inheritContext: true })).adjustment).toBeUndefined();
  });

  test("Resume untouched", async () => {
    const h = harness();
    // The executor never consults the policy for a resume; only its outcome event arrives.
    h.resumed("ag-old");
    h.completed("ag-old");
    expect(h.asks).toHaveLength(0);
    expect(h.lines).toHaveLength(0);
  });

  test("Effective values recorded", async () => {
    const h = harness();
    await runToCompletion(h, {}, { effectiveModel: "fx/fast", effectiveThinking: "medium" });
    expect(h.lines[0]).toMatchObject({ effectiveModel: "fx/fast", effectiveThinking: "medium" });
    expect(validateLedgerEntry(h.lines[0]).ok).toBe(true);
  });
});

describe("Routing fails open", () => {
  test("Jev timeout", async () => {
    const fx = await startJevFixture({ "/hang": { hang: true } });
    try {
      const h = harness({ timeoutMs: 200 });
      h.setScript((req) => askJev({ ...req, url: fx.url("/hang") }));
      const started = performance.now();
      const { adjustment } = await h.launch({ requested: { model: "fx/main" } });
      const waited = performance.now() - started;
      expect(adjustment).toBeUndefined();
      expect(h.asks[0]!.timeoutMs).toBe(200);
      expect(waited).toBeLessThan(200 + 400);
    } finally {
      await fx.stop();
    }
  });

  test("Timeout changed after session start", async () => {
    let release: (v: unknown) => void = () => {};
    const answered = new Promise((r) => (release = r));
    const fx = await startJevFixture({
      "/slow": { held: answered.then(() => ({ json: body("fast") })) },
    });
    try {
      const h = harness({ timeoutMs: 1500 });
      h.setSnap({ timeoutMs: 1700 });
      h.setScript((req) => askJev({ ...req, url: fx.url("/slow") }));
      setTimeout(() => release(undefined), 1600);
      const { adjustment } = await h.launch();
      expect(h.asks[0]!.timeoutMs).toBe(1700);
      expect(adjustment).toEqual({ model: "fx/fast", thinking: "medium" });
    } finally {
      await fx.stop();
    }
  }, 10_000);

  test("Jev error", async () => {
    const h = harness();
    h.setScript(() => ({ kind: "miss", miss: "error", reason: "http 500", ms: 1 }));
    expect((await h.launch({ requested: { model: "m" } })).adjustment).toBeUndefined();
  });

  test("Unreadable answers", async () => {
    const h = harness();
    h.setScript(() => ok({ nope: 1 }));
    expect((await h.launch({ requested: { model: "m" } })).adjustment).toBeUndefined();
  });

  test("Turn cancelled", async () => {
    const h = harness();
    const turn = new AbortController();
    h.setScript(
      (req) =>
        new Promise<JevOutcome>((resolve) => {
          req.signal?.addEventListener("abort", () => resolve({ kind: "cancelled" }));
          turn.abort();
        }),
    );
    const { adjustment, request } = await h.launch({}, turn.signal);
    expect(adjustment).toBeUndefined();
    h.created(request.agentId);
    h.failed(request.agentId, { status: "stopped" });
    expect(h.lines).toHaveLength(0);
  });

  test("a cancelled answer records nothing", async () => {
    const h = harness();
    h.setScript(() => ({ kind: "cancelled" }));
    const { adjustment, request } = await runToCompletion(h);
    expect(adjustment).toBeUndefined();
    expect(request.agentId).toBeDefined();
    expect(h.lines).toHaveLength(0);
  });

  test("Internal error", async () => {
    const h = harness();
    const request = (await import("../worker-fakes.ts")).launchRequest();
    Object.defineProperty(request, "agent", {
      get() {
        throw new Error("boom");
      },
    });
    const policy = h.executor.policy()!;
    expect(await policy(request, new AbortController().signal)).toBeUndefined();
  });

  test("a throwing ask fails open", async () => {
    const h = harness();
    h.setScript(() => {
      throw new Error("boom");
    });
    expect((await h.launch()).adjustment).toBeUndefined();
  });

  test("off() makes the policy a no-op", async () => {
    const h = harness();
    const policy = h.executor.policy()!;
    h.routing.off();
    expect(h.executor.policy()).toBeUndefined();
    const request = (await import("../worker-fakes.ts")).launchRequest();
    expect(await policy(request, new AbortController().signal)).toBeUndefined();
    expect(h.asks).toHaveLength(0);
  });
});

describe("Fallback warning", () => {
  const noDeep = { "fx/fast": {}, "fx/balanced": {}, "fx/deep": { auth: false } };

  test("Warning text", async () => {
    const h = harness({ reg: noDeep });
    h.setScript(() => ok(body("deep")));
    await h.launch();
    expect(h.notes).toHaveLength(1);
    expect(h.notes[0]?.type).toBe("warning");
    for (const s of ["tier deep", "fx/deep", "no credentials", "using balanced", "tiers.deep"]) {
      expect(h.notes[0]?.text).toContain(s);
    }
  });

  test("Once per tier", async () => {
    const h = harness({ reg: noDeep });
    h.setScript(() => ok(body("deep")));
    for (let i = 0; i < 3; i++) await h.launch();
    expect(h.notes).toHaveLength(1);
  });

  test("Shown again after /jev", async () => {
    const h = harness({ reg: noDeep });
    h.setScript(() => ok(body("deep")));
    await h.launch();
    h.routing.clearWarnings();
    await h.launch();
    expect(h.notes).toHaveLength(2);
  });

  test("Nothing can run", async () => {
    const h = harness({ reg: { "fx/fast": { auth: false }, "fx/balanced": { auth: false } } });
    h.setScript(() => ok(body("balanced", "high")));
    const { adjustment } = await h.launch();
    expect(h.notes[0]?.text).toContain("launch left unchanged");
    expect(adjustment).toBeUndefined();
  });

  test("No UI", async () => {
    const h = harness({ reg: noDeep });
    h.setScript(() => ok(body("deep")));
    (h.ctx as { hasUI: boolean }).hasUI = false;
    const { adjustment } = await h.launch();
    expect(h.notes).toHaveLength(0);
    expect(adjustment).toMatchObject({ model: "fx/balanced" });
  });
});

describe("Mode of a launch", () => {
  const split = { fast: 0.05, balanced: 0.15, deep: 0.5, expert: 0.3 };
  // Score 2.175: expert in premium (cut 2.125), deep in standard (cut 2.345).
  const between = { fast: 0.05, balanced: 0.15, deep: 0.75, expert: 0.05 };

  test("Every mode sends the one worker rubric", async () => {
    const h = harness({ mode: "premium" });
    await h.launch();
    expect(tierCriteria(h)["deep"]).toBe(`deep. ${WORKER_TIER_CRITERIA.deep}`);
  });

  test("Mode changed between message end and launch", async () => {
    const h = harness({ tiers: TIERS_X, mode: "standard" });
    h.setScript(() => ok(bodyWith("deep", between, "xhigh")));
    const { adjustment, request } = await h.launch();
    h.setSnap({ tiers: TIERS_X, mode: "premium" });
    h.created(request.agentId);
    h.completed(request.agentId);
    expect(adjustment?.model).toBe("fx/deep");
    expect(h.lines[0]).toMatchObject({ mode: "standard", reason: "cut", score: 2.175 });
  });

  test("Premium at classification admits expert", async () => {
    const h = harness({ tiers: TIERS_X, mode: "premium" });
    h.setScript(() => ok(bodyWith("deep", split, "xhigh")));
    expect((await h.launch()).adjustment?.model).toBe("fx/expert");
  });

  test("Jev down in premium", async () => {
    const h = harness({ tiers: TIERS_X, mode: "premium" });
    h.setScript(() => ({ kind: "miss", miss: "timeout", reason: "t", ms: 1500 }));
    const { adjustment } = await runToCompletion(h, { requested: { model: "fx/main" } });
    expect(adjustment).toBeUndefined();
    expect(h.lines[0]).toMatchObject({ mode: "premium", reason: "miss" });
    expect(h.lines[0]).not.toHaveProperty("score");
  });
});

describe("Cut points of a launch", () => {
  // 100 medium-effort entries, scores 0.02 … 2.00: standard puts 1.25 on balanced, premium on deep.
  const spread: WindowEntry[] = Array.from({ length: 100 }, (_, i) => ({
    score: (i + 1) / 50,
    effort: "medium",
    decided: "balanced",
  }));

  test("Siblings share a window state", async () => {
    let window: readonly WindowEntry[] = spread;
    const h = harness({ mode: "premium", window: () => window });
    h.setScript(() => ok(body("balanced", "high")));
    const a = h.launch();
    const b = h.launch();
    window = []; // changes after both policy calls started, before either wrote a line
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.adjustment?.model).toBe("fx/deep");
    expect(rb.adjustment?.model).toBe("fx/deep");
  });

  test("Launch classified alone", async () => {
    let window: readonly WindowEntry[] = [];
    const h = harness({ mode: "premium", window: () => window });
    h.setScript(() => ok(body("balanced", "high")));
    expect((await h.launch()).adjustment?.model).toBe("fx/balanced"); // seed
    window = spread;
    expect((await h.launch()).adjustment?.model).toBe("fx/deep");
  });

  test("window is called detached from deps", async () => {
    let calls = 0;
    const deps = {
      ask: () => Promise.resolve(ok(body("fast"))),
      snapshot: () => snap(),
      service: () => executor.service,
      window(this: unknown) {
        if (this !== undefined) throw new Error("window must be called detached");
        calls++;
        return [];
      },
    };
    const executor = fakeService();
    const routing = registerWorkerRouting(
      { on: () => () => {}, events: { on: () => () => {} } } as never,
      deps,
    );
    routing.start(harness().ctx as never);
    const request = (await import("../worker-fakes.ts")).launchRequest();
    const adjustment = await executor.policy()!(request, new AbortController().signal);
    expect(calls).toBe(1);
    expect(adjustment).toEqual({ model: "fx/fast", thinking: "medium" });
  });
});

describe("Slots", () => {
  const REVIEWER = { name: "reviewer", model: "fx/review", when: "Code review." };
  const reg = { "fx/fast": {}, "fx/balanced": {}, "fx/deep": {}, "fx/review": {} };
  const slotAnswer = () =>
    ok({
      answers: {
        tier: {
          type: "choice",
          choice: "slot::reviewer",
          confidence: 0.92,
          probabilities: { fast: 0, balanced: 0, deep: 0, "slot::reviewer": 0.92 },
        },
        effort: effort("high"),
        risky: { type: "noul", noul: 0.1 },
      },
    });

  test("Usable slot routes", async () => {
    const h = harness({ slots: [REVIEWER], reg });
    h.setScript(slotAnswer);
    expect((await h.launch()).adjustment).toEqual({ model: "fx/review", thinking: "high" });
  });

  test("Unusable slot", async () => {
    const h = harness({ slots: [REVIEWER], reg: { ...reg, "fx/review": { auth: false } } });
    h.setScript(slotAnswer);
    expect((await h.launch()).adjustment).toMatchObject({ model: "fx/balanced" });
    expect(h.notes[0]?.text).toContain('crew.slots "reviewer" model');
  });

  test("Slot removed while the policy waits", async () => {
    const h = harness({ slots: [REVIEWER], reg });
    h.setScript(() => {
      h.setSnap({});
      return slotAnswer();
    });
    expect((await h.launch()).adjustment).toMatchObject({ model: "fx/review" });
  });
});
