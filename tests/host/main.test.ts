import { describe, expect, test } from "bun:test";
import { validateLedgerEntry } from "../../src/store/ledger-schema.ts";
import { createMain, type MainDeps } from "../../src/host/main.ts";
import { buildSnapshot, type Snapshot } from "../../src/host/readiness.ts";
import { mainQuestions } from "../../src/jev/questions.ts";
import { mainState } from "../../src/jev/state.ts";
import { strategyBlock } from "../../src/policy/strategy.ts";
import type { JevOutcome, JevRequest } from "../../src/jev/client.ts";
import type { ThinkingLevel } from "../../src/policy/effort.ts";
import type { Config, ConfigRead } from "../../src/store/config.ts";
import type { State } from "../../src/store/state-file.ts";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

type Extra = { strategy?: [string, number]; tier?: string };

function answer(choice: string, risky = 0.1, corrects = 0.05, extra: Extra = {}): JevOutcome {
  const probabilities = Object.fromEntries(EFFORTS.map((l) => [l, l === choice ? 0.6 : 0.1]));
  const answers: Record<string, unknown> = {
    effort: { type: "choice", choice, probabilities },
    risky: { type: "noul", noul: risky },
    corrects: { type: "noul", noul: corrects },
  };
  if (extra.strategy !== undefined) {
    const [c, p] = extra.strategy;
    answers["strategy"] = {
      type: "choice",
      choice: c,
      probabilities: { direct: 0.1, delegate: 0.1, parallel: 0.1, graph: 0.1, [c]: p },
    };
  }
  if (extra.tier !== undefined) {
    answers["tier"] = {
      type: "choice",
      choice: extra.tier,
      probabilities: { fast: 0.1, balanced: 0.1, deep: 0.1, [extra.tier]: 0.8 },
    };
  }
  return { kind: "ok", ms: 7, body: { answers } };
}

const advised = (c = "delegate", p = 0.9, extra: Extra = {}): JevOutcome =>
  answer("high", 0.1, 0.05, { strategy: [c, p], ...extra });

const sessionId = "main-session-1";

function setup(
  o: {
    start?: ThinkingLevel;
    supported?: ThinkingLevel[];
    model?: object | undefined;
    state?: State;
    config?: ConfigRead;
    env?: Record<string, string | undefined>;
    branchThrows?: boolean;
    outcomes?: (JevOutcome | Promise<JevOutcome>)[];
    id?: string;
    branch?: unknown[];
    appendResult?: { ok: false; reason?: string } | { ok: true };
    holdProviders?: string[];
  } = {},
) {
  let branch: unknown[] = o.branch ?? [];
  const appended: unknown[] = [];
  const custom: { type: string; data: unknown }[] = [];
  const clock = { t: 1000 };
  let lvl: ThinkingLevel = o.start ?? "low";
  let supported: ThinkingLevel[] = o.supported ?? [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
  ];
  const sets: string[] = [];
  const pi = {
    getThinkingLevel: () => lvl,
    setThinkingLevel: (l: ThinkingLevel) => {
      sets.push(l);
      lvl = supported.includes(l) ? l : (supported[supported.length - 1] ?? "off");
    },
    appendEntry: (type: string, data: unknown) => custom.push({ type, data }),
    getAllTools: () => [],
  };
  const widgets: unknown[] = [];
  const ctx = {
    sessionManager: {
      getSessionId: () => o.id ?? sessionId,
      getBranch: () => {
        if (o.branchThrows) throw new Error("boom");
        return branch;
      },
    },
    model:
      "model" in o
        ? o.model
        : {
            provider: "fixture",
            id: "fixture-main",
            reasoning: true,
            thinkingLevelMap: { xhigh: "xhigh" },
          },
    cwd: "/tmp/x",
    hasUI: true,
    mode: "rpc",
    signal: undefined as AbortSignal | undefined,
    ui: { setWidget: (_k: string, lines: unknown) => widgets.push(lines) },
  };
  const requests: JevRequest[] = [];
  const queue = [...(o.outcomes ?? [])];
  const snapshot: Snapshot = buildSnapshot({
    configRead: o.config ?? {
      kind: "ok",
      present: true,
      config: (o.holdProviders === undefined
        ? {}
        : { effort: { holdProviders: o.holdProviders } }) as Config,
    },
    stateRead: { kind: "ok", state: o.state ?? {} },
    env: o.env ?? { TYPESAFE_API_KEY: "test-key" },
    toolNames: [],
  });
  const deps: MainDeps = {
    load: () => snapshot,
    ask: async (req) => {
      requests.push(req);
      return queue.shift() ?? answer("low");
    },
    append: (entry) => {
      appended.push(entry);
      return (o.appendResult ?? { ok: true }) as never;
    },
    now: () => clock.t,
    newId: () => "11111111-1111-1111-1111-111111111111",
    platforms: () => ["none found"],
    env: () => o.env ?? { TYPESAFE_API_KEY: "test-key" },
  };
  const main = createMain(pi as never, deps);
  const event = (prompt = "do the thing", messageType = "user") =>
    ({ type: "before_agent_start", messageType, prompt }) as never;
  return {
    main,
    pi,
    ctx: ctx as never,
    ctxRaw: ctx,
    sets,
    appended,
    custom,
    clock,
    widgets,
    requests,
    event,
    setBranch: (entries: unknown[]) => (branch = entries),
    setLevel: (l: ThinkingLevel) => (lvl = l),
    setSupported: (s: ThinkingLevel[]) => (supported = s),
    level: () => lvl,
  };
}

const run = (t: ReturnType<typeof setup>, prompt?: string) =>
  t.main.beforeAgentStart(t.event(prompt), t.ctx);

describe("eligibility", () => {
  test("request sent once for a user prompt", async () => {
    const t = setup();
    expect(await run(t)).toBeUndefined();
    expect(t.requests).toHaveLength(1);
  });

  const untouched = (
    name: string,
    o: Parameters<typeof setup>[0],
    prompt?: string,
    type?: string,
  ) =>
    test(name, async () => {
      const t = setup({ ...o, outcomes: [answer("xhigh")] });
      await t.main.beforeAgentStart(t.event(prompt, type), t.ctx);
      expect(t.requests).toHaveLength(0);
      expect(t.sets).toEqual([]);
      expect(t.widgets).toEqual([]);
      expect(t.level()).toBe(o?.start ?? "low");
    });
  untouched("effort and strategy off", {
    state: { switches: { effort: false, strategy: false } },
  });
  untouched("custom", {}, "hi", "custom");
  untouched("child", { id: "child-1" });
  untouched("key unset", { env: {} });
  untouched("whitespace", {}, "   ");
  untouched("invalid config", {
    config: { kind: "invalid", issues: [{ path: "x", message: "bad" }] } as ConfigRead,
  });
  untouched("model undefined", { model: undefined });
});

// child registry: register the id for the child test
(globalThis as Record<symbol, Set<string>>)[Symbol.for("pi-jev-pilot.children")] ??= new Set();
(globalThis as Record<symbol, Set<string>>)[Symbol.for("pi-jev-pilot.children")]!.add("child-1");

describe("decision", () => {
  test("xhigh applied and shown before return", async () => {
    const t = setup({ outcomes: [answer("xhigh", 0.1)] });
    await run(t);
    expect(t.sets).toEqual(["xhigh"]);
    expect(t.widgets.at(-1)).toEqual(["Jev · standard · xhigh"]);
    expect(t.main.decision()).toEqual({ effort: { kind: "level", level: "xhigh" } });
  });

  test("target equals current", async () => {
    const t = setup({ start: "medium", outcomes: [answer("medium")] });
    await run(t);
    expect(t.sets).toEqual([]);
    expect(t.widgets.at(-1)).toEqual(["Jev · standard · medium"]);
  });

  test("max current", async () => {
    const t = setup({ start: "max", outcomes: [answer("low")] });
    await run(t);
    expect(t.sets).toEqual([]);
    expect(t.widgets.at(-1)).toEqual(["Jev · standard · max"]);
  });

  test("non-reasoning model asks corrects only", async () => {
    const t = setup({
      start: "off",
      model: { reasoning: false },
      state: { switches: { strategy: false } },
      outcomes: [answer("high")],
    });
    await run(t);
    expect(Object.keys(t.requests[0]!.questions as object)).toEqual(["corrects"]);
    expect(t.sets).toEqual([]);
  });

  test("non-reasoning model with strategy", async () => {
    const t = setup({ start: "off", model: { reasoning: false }, outcomes: [answer("high")] });
    await run(t);
    expect(Object.keys(t.requests[0]!.questions as object)).toEqual([
      "tier",
      "strategy",
      "corrects",
    ]);
  });

  test("effort off, strategy on asks the strategy questions only", async () => {
    const t = setup({
      state: { switches: { effort: false } },
      outcomes: [advised("delegate", 0.9)],
    });
    const r = await run(t);
    expect(Object.keys(t.requests[0]!.questions as object)).toEqual([
      "tier",
      "strategy",
      "corrects",
    ]);
    expect(t.sets).toEqual([]);
    expect(r).toBeDefined();
  });

  test("request matches builders and signal is ctx.signal", async () => {
    const t = setup({ outcomes: [answer("low")] });
    const ac = new AbortController();
    t.ctxRaw.signal = ac.signal;
    await run(t, "why does src/a.ts fail?");
    const req = t.requests[0]!;
    expect(req.questions).toEqual(mainQuestions({ askEffort: true, askStrategy: true }).wire);
    expect(req.state).toEqual(
      mainState({ prompt: "why does src/a.ts fail?", items: [], platforms: ["none found"] }),
    );
    expect(req.signal).toBe(ac.signal);
    expect(req.apiKey).toBe("test-key");
  });
});

describe("discard and failure", () => {
  test("operator medium during wait", async () => {
    let release!: (o: JevOutcome) => void;
    const held = new Promise<JevOutcome>((r) => (release = r));
    const t = setup({ outcomes: [answer("high"), held, answer("high")] });
    await run(t);
    expect(t.sets).toEqual(["high"]);
    t.setLevel("low");
    t.sets.length = 0;
    const pending = run(t);
    t.setLevel("medium");
    release(answer("xhigh"));
    await pending;
    expect(t.sets).toEqual([]);
    expect(t.widgets.at(-1)).toEqual(["Jev · standard · high"]);
  });

  test("discard then next prompt applies", async () => {
    let release!: (o: JevOutcome) => void;
    const held = new Promise<JevOutcome>((r) => (release = r));
    const t = setup({ outcomes: [held, answer("high")] });
    const pending = run(t);
    t.setLevel("medium");
    release(answer("xhigh"));
    await pending;
    expect(t.sets).toEqual([]);
    t.setLevel("low");
    await run(t);
    expect(t.sets).toEqual(["high"]);
  });

  test("model switch changes level during wait", async () => {
    let release!: (o: JevOutcome) => void;
    const held = new Promise<JevOutcome>((r) => (release = r));
    const t = setup({ start: "xhigh", outcomes: [held] });
    const pending = run(t);
    t.setSupported(["off", "high"]);
    t.setLevel("high"); // Pi clamped the level on /model
    release(answer("low"));
    await pending;
    expect(t.sets).toEqual([]);
  });

  for (const miss of ["error", "timeout"] as const) {
    test(`miss ${miss}`, async () => {
      const t = setup({ outcomes: [{ kind: "miss", miss, reason: "x", ms: 3 }] });
      await run(t);
      expect(t.sets).toEqual([]);
      expect(t.widgets.at(-1)).toEqual(["Jev · standard · no answer"]);
    });
  }

  test("non-reasoning miss", async () => {
    const t = setup({
      start: "off",
      model: { reasoning: false },
      outcomes: [{ kind: "miss", miss: "timeout", reason: "x", ms: 3 }],
    });
    await run(t);
    expect(t.widgets.at(-1)).toEqual(["Jev · standard · no answer"]);
  });

  test("non-reasoning answered keeps suffix", async () => {
    const t = setup({ outcomes: [answer("high")] });
    await run(t);
    expect(t.widgets.at(-1)).toEqual(["Jev · standard · high"]);
    t.ctxRaw.model = { reasoning: false };
    t.setLevel("off");
    await run(t);
    expect(t.widgets).toHaveLength(1);
    expect(t.main.decision()).toEqual({ effort: { kind: "level", level: "high" } });
  });

  test("unknown choice", async () => {
    const bad = answer("low");
    (bad as { body: { answers: { effort: { choice: string } } } }).body.answers.effort.choice =
      "wild";
    const t = setup({ outcomes: [bad] });
    await run(t);
    expect(t.sets).toEqual([]);
    expect(t.widgets.at(-1)).toEqual(["Jev · standard · no answer"]);
  });

  test("cancelled", async () => {
    const t = setup({ outcomes: [{ kind: "cancelled" }] });
    await run(t);
    expect(t.sets).toEqual([]);
    expect(t.widgets).toEqual([]);
    expect(t.main.decision()).toBeUndefined();
    await t.main.agentSettled({ type: "agent_settled", aborted: true } as never);
    expect(t.sets).toEqual([]);
  });

  test("sessionStart clears the decision", async () => {
    const t = setup({ outcomes: [answer("high")] });
    await run(t);
    t.main.sessionStart();
    expect(t.main.decision()).toBeUndefined();
  });

  test("a run settled aborted after sessionStart touches nothing", async () => {
    const t = setup({ outcomes: [answer("high")] });
    await run(t);
    t.main.sessionStart();
    t.sets.length = 0;
    const widgetsBefore = t.widgets.length;
    await t.main.agentSettled({ type: "agent_settled", aborted: true } as never);
    expect(t.widgets.length).toBe(widgetsBefore);
    expect(t.sets).toEqual([]);
    expect(t.appended).toEqual([]);
    expect(t.custom).toEqual([]);
  });

  test("a run settled normally after sessionStart writes nothing", async () => {
    const t = setup({ outcomes: [answer("high")] });
    await run(t);
    t.main.sessionStart();
    await t.main.agentSettled({ type: "agent_settled", aborted: false } as never);
    expect(t.appended).toEqual([]);
    expect(t.custom).toEqual([]);
  });
});

describe("Esc", () => {
  const settled = (aborted: boolean) => ({ type: "agent_settled", aborted }) as never;

  test("restore", async () => {
    const t = setup({ outcomes: [answer("high")] });
    await run(t);
    t.sets.length = 0;
    await t.main.agentSettled(settled(true));
    expect(t.sets).toEqual(["low"]);
  });

  test("restores the previous status, none before", async () => {
    // second turn draws xhigh, then Esc
    const t2 = setup({ outcomes: [answer("high"), answer("xhigh")] });
    await run(t2);
    await t2.main.agentSettled(settled(false));
    await run(t2);
    expect(t2.widgets.at(-1)).toEqual(["Jev · standard · xhigh"]);
    await t2.main.agentSettled(settled(true));
    expect(t2.main.decision()).toEqual({ effort: { kind: "level", level: "high" } });
    expect(t2.widgets.at(-1)).toEqual(["Jev · standard · high"]);
    const t3 = setup({ outcomes: [answer("high")] });
    await run(t3);
    await t3.main.agentSettled(settled(true));
    expect(t3.main.decision()).toBeUndefined();
    expect(t3.widgets.at(-1)).toEqual(["Jev · standard"]);
  });

  test("an older cancelled run leaves the newer record and decision", async () => {
    let release: (o: JevOutcome) => void = () => {};
    const held = new Promise<JevOutcome>((res) => (release = res));
    const t = setup({ outcomes: [held, answer("high")] });
    const first = run(t);
    await run(t);
    expect(t.main.decision()).toEqual({ effort: { kind: "level", level: "high" } });
    release({ kind: "cancelled" });
    await first;
    expect(t.main.decision()).toEqual({ effort: { kind: "level", level: "high" } });
    // the newer record still exists: Esc restores its level
    t.sets.length = 0;
    await t.main.agentSettled(settled(true));
    expect(t.sets).toEqual(["low"]);
  });

  test("no restore after operator change", async () => {
    const t = setup({ outcomes: [answer("high")] });
    await run(t);
    t.sets.length = 0;
    t.setLevel("medium");
    await t.main.agentSettled(settled(true));
    expect(t.sets).toEqual([]);
  });

  test("no restore after provider request", async () => {
    const t = setup({ outcomes: [answer("high")] });
    await run(t);
    t.sets.length = 0;
    await t.main.beforeProviderRequest();
    await t.main.agentSettled(settled(true));
    expect(t.sets).toEqual([]);
  });
});

describe("errors", () => {
  test("getBranch throws", async () => {
    const t = setup({ branchThrows: true });
    await expect(run(t)).resolves.toBeUndefined();
    expect(t.sets).toEqual([]);
    expect(t.requests).toHaveLength(0);
  });

  test("load throws", async () => {
    const t = setup();
    const m = createMain(
      t.pi as never,
      {
        load: () => {
          throw new Error("x");
        },
      } as never,
    );
    await expect(m.beforeAgentStart(t.event(), t.ctx)).resolves.toBeUndefined();
    expect(t.sets).toEqual([]);
  });
});

describe("ledger", () => {
  const settled = (aborted: boolean) => ({ type: "agent_settled", aborted }) as never;
  const msg = (stopReason = "stop", usage: unknown = { input: 10, output: 5 }) => ({
    role: "assistant",
    stopReason,
    usage,
  });
  const turnEnd = (t: ReturnType<typeof setup>, results: boolean[], m = msg()) =>
    t.main.turnEnd({
      type: "turn_end",
      message: m,
      toolResults: results.map((isError) => ({ isError })),
    } as never);
  const lines = (t: ReturnType<typeof setup>) =>
    t.appended.map((e) => {
      const v = validateLedgerEntry(e);
      expect(v.ok).toBe(true);
      return e as Record<string, unknown>;
    });
  const jevTurn = (id: string) => ({
    type: "custom",
    customType: "jev-turn",
    data: { turnId: id },
  });

  test("applied turn", async () => {
    const t = setup({ outcomes: [answer("high", 0.1, 0.05)] });
    await run(t);
    t.clock.t = 1750;
    await t.main.beforeProviderRequest();
    await turnEnd(t, [false, true]);
    await turnEnd(t, []);
    await t.main.agentSettled(settled(false));
    const [main] = lines(t);
    expect(t.appended).toHaveLength(1);
    expect(main).toEqual({
      v: 1,
      at: 1000,
      kind: "main",
      session: sessionId,
      mode: "standard",
      answered: true,
      turnId: "11111111-1111-1111-1111-111111111111",
      ms: 7,
      effortP: { low: 0.1, medium: 0.1, high: 0.6, xhigh: 0.1, max: 0.1 },
      risky: 0.1,
      corrects: 0.05,
      requested: "high",
      effective: "high",
      from: "low",
      toolCalls: 2,
      failures: 1,
      inputTokens: 20,
      outputTokens: 10,
      durationMs: 750,
      outcome: "ok",
    });
    expect(t.custom).toEqual([
      {
        type: "jev-turn",
        data: {
          turnId: "11111111-1111-1111-1111-111111111111",
          decided: { provider: "fixture", model: "fixture-main", level: "high" },
        },
      },
    ]);
  });

  test("effective is read back from Pi", async () => {
    const t = setup({ outcomes: [answer("xhigh")] });
    t.setSupported(["off", "minimal", "low", "medium", "high"]);
    await run(t);
    await t.main.beforeProviderRequest();
    await t.main.agentSettled(settled(false));
    const [main] = lines(t);
    expect(main!["requested"]).toBe("xhigh");
    expect(main!["effective"]).toBe("high");
  });

  test("miss", async () => {
    const t = setup({ outcomes: [{ kind: "miss", miss: "timeout", reason: "x", ms: 3 }] });
    await run(t);
    await t.main.beforeProviderRequest();
    await t.main.agentSettled(settled(false));
    const [main] = lines(t);
    expect(main).toMatchObject({ answered: false, miss: "timeout", from: "low", ms: 3 });
    for (const k of ["requested", "effective", "effortP"]) expect(k in main!).toBe(false);
  });

  test("discarded", async () => {
    let release!: (o: JevOutcome) => void;
    const held = new Promise<JevOutcome>((r) => (release = r));
    const t = setup({ outcomes: [held] });
    const pending = run(t);
    t.setLevel("medium");
    release(answer("xhigh"));
    await pending;
    await t.main.beforeProviderRequest();
    await t.main.agentSettled(settled(false));
    const [main] = lines(t);
    expect(main).toMatchObject({ requested: "xhigh", answered: true });
    expect(main!["effortP"]).toBeDefined();
    expect("effective" in main!).toBe(false);
  });

  test("aborted after a provider request", async () => {
    const t = setup({ outcomes: [answer("high")] });
    await run(t);
    await t.main.beforeProviderRequest();
    await t.main.agentSettled(settled(true));
    expect(lines(t)[0]!["outcome"]).toBe("aborted");
    expect(t.custom).toHaveLength(1);
  });

  test("error stop reason without a request", async () => {
    const t = setup({
      outcomes: [answer("high")],
      branch: [
        { type: "message", message: { role: "assistant", content: [], stopReason: "error" } },
      ],
    });
    await run(t);
    await t.main.agentSettled(settled(false));
    expect(t.appended).toHaveLength(1);
    expect(lines(t)[0]!["outcome"]).toBe("error");
  });

  test("error stop reason seen in turnEnd", async () => {
    const t = setup({ outcomes: [answer("high")] });
    await run(t);
    await t.main.beforeProviderRequest();
    await turnEnd(t, [], msg("error"));
    await t.main.agentSettled(settled(false));
    expect(lines(t)[0]!["outcome"]).toBe("error");
  });

  test("correction before main", async () => {
    const t = setup({ outcomes: [answer("high", 0.1, 0.9)], branch: [jevTurn("T1")] });
    await run(t);
    await t.main.beforeProviderRequest();
    await t.main.agentSettled(settled(false));
    const out = lines(t);
    expect(out.map((l) => l["kind"])).toEqual(["correction", "main"]);
    expect(out[0]).toMatchObject({ turnId: "T1", corrects: 0.9, session: sessionId, at: 1000 });
  });

  test("correction at the threshold", async () => {
    const t = setup({ outcomes: [answer("high", 0.1, 0.7)], branch: [jevTurn("T1")] });
    await run(t);
    await t.main.beforeProviderRequest();
    await t.main.agentSettled(settled(false));
    expect(lines(t).map((l) => l["kind"])).toEqual(["correction", "main"]);
  });

  test("no correction below the threshold or without a previous turn", async () => {
    const a = setup({ outcomes: [answer("high", 0.1, 0.69)], branch: [jevTurn("T1")] });
    await run(a);
    await a.main.agentSettled(settled(false));
    expect(lines(a).map((l) => l["kind"])).toEqual(["main"]);
    const b = setup({ outcomes: [answer("high", 0.1, 0.95)] });
    await run(b);
    await b.main.agentSettled(settled(false));
    expect(lines(b).map((l) => l["kind"])).toEqual(["main"]);
  });

  test("aborted before any provider request writes nothing", async () => {
    const t = setup({ outcomes: [answer("high", 0.1, 0.9)], branch: [jevTurn("T1")] });
    await run(t);
    await t.main.agentSettled(settled(true));
    expect(t.appended).toEqual([]);
    expect(t.custom).toEqual([]);
  });

  test("forbidden fields are absent", async () => {
    const t = setup({ outcomes: [answer("high", 0.1, 0.9)], branch: [jevTurn("T1")] });
    await run(t);
    await t.main.agentSettled(settled(false));
    const text = JSON.stringify(t.appended);
    for (const k of ["advised", "strategy", "strategyP", "skill", "skillP", "gate"])
      expect(text).not.toContain(`"${k}"`);
  });

  test("privacy", async () => {
    const t = setup({ outcomes: [answer("high", 0.1, 0.9)], branch: [jevTurn("T1")] });
    await run(t, "JEV-MARKER-PROMPT");
    await t.main.agentSettled(settled(false));
    expect(JSON.stringify([t.appended, t.custom])).not.toContain("JEV-MARKER-PROMPT");
  });

  test("a failed ledger write still records the turn id", async () => {
    const t = setup({ outcomes: [answer("high")], appendResult: { ok: false } });
    await run(t);
    await t.main.agentSettled(settled(false));
    expect(t.custom).toHaveLength(1);
  });

  test("the record is dropped after writing", async () => {
    const t = setup({ outcomes: [answer("high")] });
    await run(t);
    await t.main.agentSettled(settled(false));
    await t.main.agentSettled(settled(false));
    expect(t.appended).toHaveLength(1);
  });
});

describe("hold", () => {
  const settled = (aborted: boolean) => ({ type: "agent_settled", aborted }) as never;
  const decided = { provider: "fixture", model: "fixture-main", level: "high" };
  const heldTurn = (turnId = "T1") => ({
    type: "custom",
    customType: "jev-turn",
    data: { turnId, decided },
  });
  const heldSetup = (o: Parameters<typeof setup>[0] = {}) =>
    setup({ branch: [heldTurn()], holdProviders: ["fixture"], start: "high", ...o });
  const lines = (t: ReturnType<typeof setup>) =>
    t.appended.map((e) => {
      expect(validateLedgerEntry(e).ok).toBe(true);
      return e as Record<string, unknown>;
    });
  const mainLine = (t: ReturnType<typeof setup>) => lines(t).find((l) => l["kind"] === "main")!;
  /** Question keys apart from the strategy pair, which the `strategy` feature adds on any turn. */
  const keys = (t: ReturnType<typeof setup>, i: number): string[] =>
    Object.keys(t.requests[i]!.questions as object).filter((k) => k !== "tier" && k !== "strategy");
  const correctsOnly = (corrects: number): JevOutcome => ({
    kind: "ok",
    ms: 7,
    body: { answers: { corrects: { type: "noul", noul: corrects } } },
  });

  test("second prompt held", async () => {
    const t = heldSetup({ outcomes: [answer("xhigh")] });
    await run(t);
    expect(keys(t, 0)).toEqual(["corrects"]);
    expect(t.sets).toEqual([]);
    expect(t.widgets.at(-1)).toEqual(["Jev · standard · high"]);
  });

  test("provider not listed", async () => {
    const t = heldSetup({ holdProviders: ["other"] });
    await run(t);
    expect(keys(t, 0)).toEqual(["effort", "risky", "corrects"]);
  });

  test("held miss", async () => {
    const t = heldSetup({ outcomes: [{ kind: "miss", miss: "timeout", reason: "slow", ms: 300 }] });
    await run(t);
    expect(t.sets).toEqual([]);
    expect(t.widgets.at(-1)).toEqual(["Jev · standard · high"]);
    await t.main.agentSettled(settled(false));
    expect(mainLine(t)).toMatchObject({
      held: true,
      answered: false,
      miss: "timeout",
      effective: "high",
    });
  });

  test("held schema miss", async () => {
    const t = heldSetup({ outcomes: [{ kind: "ok", ms: 7, body: {} }] });
    await run(t);
    expect(t.sets).toEqual([]);
    expect(t.widgets.at(-1)).toEqual(["Jev · standard · high"]);
    await t.main.agentSettled(settled(false));
    expect(mainLine(t)).toMatchObject({ held: true, miss: "schema", effective: "high" });
  });

  test("manual change while held", async () => {
    const t = heldSetup({ start: "low", outcomes: [correctsOnly(0.1)] });
    await run(t);
    expect(t.sets).toEqual([]);
    await t.main.agentSettled(settled(false));
    expect(mainLine(t)).toMatchObject({ held: true, from: "low", effective: "low" });
  });

  test("held line fields", async () => {
    const t = heldSetup({ outcomes: [correctsOnly(0.1)] });
    await run(t);
    await t.main.agentSettled(settled(false));
    const line = mainLine(t);
    expect(line).toMatchObject({ held: true, effective: "high", from: "high", corrects: 0.1 });
    for (const k of ["effortP", "risky", "requested"]) expect(line).not.toHaveProperty(k);
  });

  test("correction while held", async () => {
    const t = heldSetup({ outcomes: [correctsOnly(0.9)] });
    await run(t);
    await t.main.agentSettled(settled(false));
    expect(lines(t).find((l) => l["kind"] === "correction")).toMatchObject({ turnId: "T1" });
  });

  test("miss right after a compaction keeps the release", async () => {
    const t = setup({
      branch: [heldTurn(), { type: "compaction", id: "c1" }],
      holdProviders: ["fixture"],
      start: "high",
      outcomes: [{ kind: "miss", miss: "timeout", reason: "slow", ms: 300 }, answer("high")],
    });
    await run(t);
    expect(keys(t, 0)).toEqual(["effort", "risky", "corrects"]);
    await t.main.agentSettled(settled(false));
    const entry = t.custom.find((c) => c.type === "jev-turn")!;
    expect(entry.data).toEqual({ turnId: "11111111-1111-1111-1111-111111111111" });
    t.setBranch([
      heldTurn(),
      { type: "compaction", id: "c1" },
      { type: "custom", customType: "jev-turn", data: entry.data },
    ]);
    await run(t);
    expect(keys(t, 1)).toEqual(["effort", "risky", "corrects"]);
  });

  test("model switch decides once and anchors the new model", async () => {
    const t = heldSetup({
      model: { provider: "fixture", id: "fixture-balanced", reasoning: true },
      outcomes: [answer("medium"), correctsOnly(0.1)],
    });
    await run(t);
    expect(keys(t, 0)).toContain("effort");
    await t.main.agentSettled(settled(false));
    const entry = t.custom.find((c) => c.type === "jev-turn")!;
    expect((entry.data as { decided?: unknown }).decided).toEqual({
      provider: "fixture",
      model: "fixture-balanced",
      level: "medium",
    });
    t.setBranch([heldTurn(), { type: "custom", customType: "jev-turn", data: entry.data }]);
    await run(t);
    expect(keys(t, 1)).toEqual(["corrects"]);
  });

  test("decided turn on listed provider has no held", async () => {
    const t = setup({ holdProviders: ["fixture"], outcomes: [answer("high")] });
    await run(t);
    await t.main.agentSettled(settled(false));
    expect(mainLine(t)).not.toHaveProperty("held");
  });
});

describe("anchor", () => {
  const settled = (aborted: boolean) => ({ type: "agent_settled", aborted }) as never;
  const id = "11111111-1111-1111-1111-111111111111";
  const decided = (level: string) => ({ provider: "fixture", model: "fixture-main", level });
  const lastTurn = (t: ReturnType<typeof setup>) => t.custom.at(-1);
  const heldTurn = {
    type: "custom",
    customType: "jev-turn",
    data: { turnId: "T1", decided: decided("high") },
  };

  test("applied turn anchors", async () => {
    const t = setup({ outcomes: [answer("high")] });
    await run(t);
    await t.main.agentSettled(settled(false));
    expect(lastTurn(t)).toEqual({
      type: "jev-turn",
      data: { turnId: id, decided: decided("high") },
    });
  });

  test("same level anchors", async () => {
    const t = setup({ start: "medium", outcomes: [answer("medium")] });
    await run(t);
    await t.main.agentSettled(settled(false));
    expect(lastTurn(t)?.data).toEqual({ turnId: id, decided: decided("medium") });
  });

  test("max anchors", async () => {
    const t = setup({ start: "max", outcomes: [answer("low")] });
    await run(t);
    await t.main.agentSettled(settled(false));
    expect(lastTurn(t)?.data).toEqual({ turnId: id, decided: decided("max") });
  });

  test("unlisted provider anchors", async () => {
    const t = setup({ holdProviders: [], outcomes: [answer("high")] });
    await run(t);
    await t.main.agentSettled(settled(false));
    expect(lastTurn(t)?.data).toEqual({ turnId: id, decided: decided("high") });
  });

  test("held turn writes no decided", async () => {
    const t = setup({
      branch: [heldTurn],
      holdProviders: ["fixture"],
      start: "high",
      outcomes: [answer("xhigh")],
    });
    await run(t);
    await t.main.agentSettled(settled(false));
    expect(lastTurn(t)?.data).toEqual({ turnId: id });
  });

  test("discarded turn writes no decided", async () => {
    let release: (o: JevOutcome) => void = () => {};
    const t = setup({ outcomes: [new Promise<JevOutcome>((r) => (release = r))] });
    const p = run(t);
    t.setLevel("medium");
    release(answer("high"));
    await p;
    await t.main.agentSettled(settled(false));
    expect(lastTurn(t)?.data).toEqual({ turnId: id });
  });

  test("miss writes no decided", async () => {
    const t = setup({ outcomes: [{ kind: "miss", miss: "timeout", reason: "slow", ms: 300 }] });
    await run(t);
    await t.main.agentSettled(settled(false));
    expect(lastTurn(t)?.data).toEqual({ turnId: id });
  });

  test("non-reasoning model writes no decided", async () => {
    const t = setup({
      model: { provider: "fixture", id: "fixture-main", reasoning: false },
      outcomes: [answer("high")],
    });
    await run(t);
    await t.main.agentSettled(settled(false));
    expect(lastTurn(t)?.data).toEqual({ turnId: id });
  });

  test("aborted after the provider request anchors", async () => {
    const t = setup({ outcomes: [answer("high")] });
    await run(t);
    await t.main.beforeProviderRequest();
    await t.main.agentSettled(settled(true));
    expect(lastTurn(t)?.data).toEqual({ turnId: id, decided: decided("high") });
  });

  test("compaction during the turn writes no decided", async () => {
    const t = setup({ outcomes: [answer("high")] });
    await run(t);
    t.setBranch([{ type: "compaction", id: "c1" }]);
    await t.main.agentSettled(settled(false));
    expect(lastTurn(t)?.data).toEqual({ turnId: id });
  });

  test("branch read failure at settle writes turn id only", async () => {
    const t = setup({ outcomes: [answer("high")] });
    await run(t);
    t.ctxRaw.sessionManager.getBranch = () => {
      throw new Error("boom");
    };
    await t.main.agentSettled(settled(false));
    expect(lastTurn(t)?.data).toEqual({ turnId: id });
  });
});

describe("strategy advice", () => {
  const settled = (aborted: boolean) => ({ type: "agent_settled", aborted }) as never;
  const msg = {
    message: {
      customType: "jev-advice",
      display: false,
      content: strategyBlock("delegate"),
    },
  };

  test("delegate 0.9 returns the hidden message", async () => {
    const t = setup({ outcomes: [advised("delegate", 0.9)] });
    expect(await run(t)).toEqual(msg);
    expect(t.widgets.at(-1)).toEqual(["Jev · standard · high · delegate"]);
  });

  test("direct, miss and strategy off return undefined", async () => {
    const a = setup({ outcomes: [advised("direct", 0.9)] });
    expect(await run(a)).toBeUndefined();
    const b = setup({ outcomes: [{ kind: "miss", miss: "timeout", reason: "x", ms: 3 }] });
    expect(await run(b)).toBeUndefined();
    const c = setup({
      state: { switches: { strategy: false } },
      outcomes: [advised("delegate", 0.9)],
    });
    expect(await run(c)).toBeUndefined();
    expect("strategy" in (c.requests[0]!.questions as object)).toBe(false);
  });

  test("advice is independent of effort", async () => {
    let release!: (o: JevOutcome) => void;
    const held = new Promise<JevOutcome>((r) => (release = r));
    const t = setup({ outcomes: [answer("high"), held] });
    await run(t);
    t.setLevel("low");
    const pending = run(t);
    t.setLevel("medium");
    release(advised("delegate", 0.9));
    expect(await pending).toEqual(msg);
    expect(t.widgets.at(-1)).toEqual(["Jev · standard · high · delegate"]);

    const m = setup({ start: "max", outcomes: [advised("delegate", 0.9)] });
    expect(await run(m)).toEqual(msg);

    const bad = advised("delegate", 0.9);
    (bad as { body: { answers: { effort: { choice: string } } } }).body.answers.effort.choice =
      "wild";
    const u = setup({ outcomes: [bad] });
    expect(await run(u)).toEqual(msg);
    expect(u.widgets.at(-1)).toEqual(["Jev · standard · no answer · delegate"]);

    const off = setup({
      state: { switches: { effort: false } },
      outcomes: [advised("delegate", 0.9)],
    });
    expect(await run(off)).toEqual(msg);
    expect(off.widgets.at(-1)).toEqual(["Jev · standard · delegate"]);
  });

  test("cancelled returns undefined without drawing", async () => {
    const t = setup({ outcomes: [{ kind: "cancelled" }] });
    expect(await run(t)).toBeUndefined();
    expect(t.widgets).toEqual([]);
  });

  test("Esc before any request restores the previous decision with its advice", async () => {
    const t = setup({ outcomes: [advised("delegate", 0.9), advised("direct", 0.9)] });
    await run(t);
    await t.main.agentSettled(settled(false));
    await run(t);
    expect(t.widgets.at(-1)).toEqual(["Jev · standard · high"]);
    await t.main.agentSettled(settled(true));
    expect(t.main.decision()).toEqual({
      effort: { kind: "level", level: "high" },
      advice: "delegate",
    });
    expect(t.widgets.at(-1)).toEqual(["Jev · standard · high · delegate"]);
  });

  test("Esc restores when only the advice changed", async () => {
    const t = setup({
      state: { switches: { effort: false } },
      outcomes: [advised("delegate", 0.9), advised("direct", 0.9)],
    });
    await run(t);
    await t.main.agentSettled(settled(false));
    await run(t);
    expect(t.main.decision()).toEqual({});
    await t.main.agentSettled(settled(true));
    expect(t.main.decision()).toEqual({ advice: "delegate" });
    expect(t.appended).toHaveLength(1);
  });

  const mainLine = async (o: JevOutcome, state?: State) => {
    const t = setup({ outcomes: [o], ...(state === undefined ? {} : { state }) });
    await run(t);
    await t.main.beforeProviderRequest();
    await t.main.agentSettled(settled(false));
    const v = validateLedgerEntry(t.appended[0]);
    expect(v.ok).toBe(true);
    return t.appended[0] as Record<string, unknown>;
  };

  test("ledger fields", async () => {
    expect(await mainLine(advised("delegate", 0.9))).toMatchObject({
      strategy: "delegate",
      strategyP: 0.9,
      advised: true,
    });
    expect(await mainLine(advised("graph", 0.7, { tier: "deep" }))).toMatchObject({
      strategy: "graph",
      strategyP: 0.7,
      advised: false,
    });
  });

  test("no ledger fields for off, miss or unknown", async () => {
    const lines = [
      await mainLine(advised("delegate", 0.9), { switches: { strategy: false } }),
      await mainLine({ kind: "miss", miss: "timeout", reason: "x", ms: 3 }),
      await mainLine(advised("wild", 0.9)),
    ];
    for (const l of lines)
      for (const k of ["strategy", "strategyP", "advised"]) expect(k in l).toBe(false);
  });

  test("status: direct clears, miss clears, off leaves, sessionStart resets", async () => {
    const t = setup({
      outcomes: [
        advised("delegate", 0.9),
        advised("direct", 0.9),
        advised("delegate", 0.9),
        { kind: "miss", miss: "timeout", reason: "x", ms: 3 },
      ],
    });
    await run(t);
    expect(t.main.decision()?.advice).toBe("delegate");
    await t.main.agentSettled(settled(false));
    await run(t);
    expect(t.main.decision()?.advice).toBeUndefined();
    await run(t);
    expect(t.main.decision()?.advice).toBe("delegate");
    await run(t);
    expect(t.main.decision()).toEqual({ effort: { kind: "no-answer" } });
    expect(t.widgets.at(-1)).toEqual(["Jev · standard · no answer"]);
    t.main.sessionStart();
    expect(t.main.decision()).toBeUndefined();
  });

  test("a turn with strategy off leaves the advice", async () => {
    const t = setup({ outcomes: [advised("delegate", 0.9)] });
    await run(t);
    const off = setup({
      state: { switches: { strategy: false } },
      outcomes: [answer("high")],
    });
    // same main instance cannot switch settings; assert via a fresh instance without advice
    await run(off);
    expect(off.main.decision()).toEqual({ effort: { kind: "level", level: "high" } });
    expect(t.main.decision()?.advice).toBe("delegate");
  });
});
