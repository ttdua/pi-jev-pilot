import { deliveryText } from "../../src/policy/skill.ts";
import { fingerprint, skillBlock } from "../../src/host/skills.ts";
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
    /** Per-prompt `tallyText` results, consumed in order. */
    tally?: (string | undefined | Error)[];
    skills?: { name: string; body: string; description?: string }[];
    inject?: "content" | "suggest";
    projection?: unknown[];
    batchOutcomes?: (JevOutcome | Promise<JevOutcome>)[];
    rich?: MainDeps["rich"];
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
      buildSessionProjection: () => ({ entries: o.projection ?? [], messages: [] }),
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
  const batchQueue = [...(o.batchOutcomes ?? [])];
  const reads: string[] = [];
  const snap = (state: State | undefined): Snapshot =>
    buildSnapshot({
      configRead: o.config ?? {
        kind: "ok",
        present: true,
        config: {
          ...(o.holdProviders === undefined ? {} : { effort: { holdProviders: o.holdProviders } }),
          ...(o.inject === undefined ? {} : { skills: { inject: o.inject } }),
        } as Config,
      },
      stateRead: { kind: "ok", state: state ?? {} },
      env: o.env ?? { TYPESAFE_API_KEY: "test-key" },
      toolNames: [],
    });
  let snapshot = snap(o.state);
  const tallyQueue = [...(o.tally ?? [])];
  const tallyCalls = { n: 0 };
  const deps: MainDeps = {
    tallyText: () => {
      tallyCalls.n++;
      const next = tallyQueue.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    load: () => snapshot,
    ask: async (req) => {
      requests.push(req);
      const keys = Object.keys(req.questions as object);
      const only = keys.length === 1 && keys[0] === "which";
      return (only ? batchQueue.shift() : queue.shift()) ?? answer("low");
    },
    commands: () =>
      (o.skills ?? []).map((s) => ({
        name: `skill:${s.name}`,
        source: "skill",
        ...(s.description === undefined ? {} : { description: s.description }),
        sourceInfo: { path: `/s/${s.name}/SKILL.md`, baseDir: `/s/${s.name}` },
      })),
    readFile: (path) => {
      reads.push(path);
      const name = path.split("/")[2]!;
      const skill = (o.skills ?? []).find((s) => s.name === name);
      if (skill === undefined) throw new Error("no such file");
      return `---\nname: ${name}\n---\n${skill.body}`;
    },
    append: (entry) => {
      appended.push(entry);
      return (o.appendResult ?? { ok: true }) as never;
    },
    now: () => clock.t,
    newId: () => "11111111-1111-1111-1111-111111111111",
    platforms: () => ["none found"],
    env: () => o.env ?? { TYPESAFE_API_KEY: "test-key" },
    ...(o.rich === undefined ? {} : { rich: o.rich }),
  };
  const main = createMain(pi as never, deps);
  const event = (prompt = "do the thing", messageType = "user") =>
    ({ type: "before_agent_start", messageType, prompt }) as never;
  return {
    main,
    deps,
    pi,
    ctx: ctx as never,
    ctxRaw: ctx,
    sets,
    appended,
    custom,
    clock,
    widgets,
    tallyCalls,
    requests,
    reads,
    event,
    setState: (state: State) => (snapshot = snap(state)),
    setBranch: (entries: unknown[]) => (branch = entries),
    setLevel: (l: ThinkingLevel) => (lvl = l),
    setSupported: (s: ThinkingLevel[]) => (supported = s),
    level: () => lvl,
  };
}

const run = (t: ReturnType<typeof setup>, prompt?: string) =>
  t.main.beforeAgentStart(t.event(prompt), t.ctx);

/** A full outcome for the main request; skill keys only when given. */
function answerWith(o: {
  effort?: string;
  which?: [string, number];
  gates?: [number, number, number];
}): JevOutcome {
  const answers: Record<string, unknown> = {
    corrects: { type: "noul", noul: 0.05 },
  };
  if (o.effort !== undefined) {
    answers["effort"] = {
      type: "choice",
      choice: o.effort,
      probabilities: Object.fromEntries(EFFORTS.map((l) => [l, l === o.effort ? 0.6 : 0.1])),
    };
    answers["risky"] = { type: "noul", noul: 0.1 };
  }
  if (o.which !== undefined) {
    answers["which"] = {
      type: "choice",
      choice: o.which[0],
      probabilities: { [o.which[0]]: o.which[1], "(none)": 1 - o.which[1] },
    };
  }
  if (o.gates !== undefined) {
    answers["gate::acts_on_user_system"] = { type: "noul", noul: o.gates[0] };
    answers["gate::would_follow_documented_procedure"] = { type: "noul", noul: o.gates[1] };
    answers["gate::prose_suffices"] = { type: "noul", noul: o.gates[2] };
  }
  return { kind: "ok", ms: 7, body: { answers } as never };
}

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
    const t = setup({ outcomes: [advised("delegate", 0.9), answer("high")] });
    await run(t);
    expect(t.main.decision()?.advice).toBe("delegate");
    await t.main.agentSettled(settled(false));
    t.setState({ switches: { strategy: false } });
    await run(t);
    expect("strategy" in (t.requests[1]!.questions as object)).toBe(false);
    expect(t.main.decision()).toEqual({
      effort: { kind: "level", level: "high" },
      advice: "delegate",
    });
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

  test("held with strategy off asks only corrects", async () => {
    const t = heldSetup({
      state: { switches: { strategy: false } },
      outcomes: [correctsOnly(0.1)],
    });
    expect(await run(t)).toBeUndefined();
    expect(Object.keys(t.requests[0]!.questions as object)).toEqual(["corrects"]);
  });

  test("held with strategy on asks tier, strategy and corrects and attaches advice", async () => {
    const t = heldSetup({ outcomes: [advised("delegate", 0.9)] });
    const result = await run(t);
    expect(Object.keys(t.requests[0]!.questions as object)).toEqual([
      "tier",
      "strategy",
      "corrects",
    ]);
    expect(result).toEqual({
      message: { customType: "jev-advice", content: strategyBlock("delegate"), display: false },
    });
    expect(t.sets).toEqual([]);
    expect(t.widgets.at(-1)).toEqual(["Jev · standard · high · delegate"]);
    await t.main.agentSettled(settled(false));
    const line = mainLine(t);
    expect(line).toMatchObject({
      held: true,
      effective: "high",
      strategy: "delegate",
      strategyP: 0.9,
      advised: true,
    });
    expect(line).not.toHaveProperty("effortP");
    expect(line).not.toHaveProperty("risky");
    expect(line).not.toHaveProperty("requested");
  });

  test("held turn that attaches no advice clears the advice suffix", async () => {
    const t = heldSetup({ outcomes: [advised("delegate", 0.9), advised("direct", 0.9)] });
    await run(t);
    expect(t.main.decision()?.advice).toBe("delegate");
    await t.main.agentSettled(settled(false));
    expect(await run(t)).toBeUndefined();
    expect(t.main.decision()).toEqual({ effort: { kind: "level", level: "high" } });
  });

  test("held miss clears the advice suffix and shows the level", async () => {
    const t = heldSetup({
      outcomes: [advised("delegate", 0.9), { kind: "miss", miss: "timeout", reason: "x", ms: 3 }],
    });
    await run(t);
    await t.main.agentSettled(settled(false));
    expect(await run(t)).toBeUndefined();
    expect(t.widgets.at(-1)).toEqual(["Jev · standard · high"]);
  });

  test("effort off is not held: no hold fields and the level is untouched", async () => {
    const t = heldSetup({
      state: { switches: { effort: false } },
      outcomes: [advised("delegate", 0.9)],
    });
    expect(await run(t)).toBeDefined();
    expect(Object.keys(t.requests[0]!.questions as object)).toEqual([
      "tier",
      "strategy",
      "corrects",
    ]);
    expect(t.sets).toEqual([]);
    await t.main.agentSettled(settled(false));
    expect(mainLine(t)).not.toHaveProperty("held");
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

describe("tally overlay", () => {
  const TALLY = "10 prompts · 2 workers · 1 fallbacks";
  const TALLY_LINE = [`Jev · standard · ${TALLY}`];
  const settled = (aborted: boolean) => ({ type: "agent_settled", aborted }) as never;
  const miss: JevOutcome = {
    kind: "miss",
    miss: "timeout",
    reason: "x",
    ms: 3,
  };

  test("Ninth prompt shows the level", async () => {
    const t = setup({ outcomes: [answer("high")], tally: [undefined] });
    await run(t);
    expect(t.widgets.at(-1)).toEqual(["Jev · standard · high"]);
    expect(t.main.overlay()).toBeUndefined();
  });

  test("Tally on the 10th prompt", async () => {
    const t = setup({ outcomes: [answer("high")], tally: [TALLY] });
    await run(t);
    expect(t.widgets.at(-1)).toEqual(TALLY_LINE);
    expect(t.main.overlay()).toBe(TALLY);
  });

  test("Eleventh prompt shows the level again", async () => {
    const t = setup({
      outcomes: [answer("high"), answer("medium")],
      tally: [TALLY, undefined],
    });
    await run(t);
    await t.main.agentSettled(settled(false));
    await run(t);
    expect(t.widgets.at(-1)).toEqual(["Jev · standard · medium"]);
    expect(t.main.overlay()).toBeUndefined();
  });

  test("Tally on a miss", async () => {
    const t = setup({ outcomes: [miss], tally: [TALLY] });
    await run(t);
    expect(t.widgets.at(-1)).toEqual(TALLY_LINE);
  });

  test("Tally on a held 10th prompt", async () => {
    const decided = {
      provider: "fixture",
      model: "fixture-main",
      level: "high",
    };
    const t = setup({
      branch: [
        {
          type: "custom",
          customType: "jev-turn",
          data: { turnId: "T1", decided },
        },
      ],
      holdProviders: ["fixture"],
      start: "high",
      outcomes: [answer("xhigh")],
      tally: [TALLY],
    });
    await run(t);
    expect(t.widgets.at(-1)).toEqual(TALLY_LINE);
  });

  test("Tally on a discarded 10th prompt", async () => {
    let release!: (o: JevOutcome) => void;
    const pendingAnswer = new Promise<JevOutcome>((r) => (release = r));
    const t = setup({
      outcomes: [answer("high"), pendingAnswer, answer("low")],
      tally: [undefined, TALLY, undefined],
    });
    await run(t);
    await t.main.agentSettled(settled(false));
    const pending = run(t);
    t.setLevel("medium");
    release(answer("xhigh"));
    await pending;
    expect(t.widgets.at(-1)).toEqual(TALLY_LINE);
    await t.main.agentSettled(settled(false));
    t.ctxRaw.model = { reasoning: false };
    await run(t);
    expect(t.widgets.at(-1)).toEqual(["Jev · standard · high"]);
    expect(t.main.overlay()).toBeUndefined();
  });

  test("cancelled 10th prompt shows no tally", async () => {
    const t = setup({ outcomes: [{ kind: "cancelled" }], tally: [TALLY] });
    await run(t);
    expect(t.tallyCalls.n).toBe(0);
    expect(t.main.overlay()).toBeUndefined();
    expect(JSON.stringify(t.widgets)).not.toContain(TALLY);
  });

  test("cancelled 11th prompt keeps the overlay", async () => {
    const t = setup({
      outcomes: [answer("high"), { kind: "cancelled" }],
      tally: [TALLY],
    });
    await run(t);
    await t.main.agentSettled(settled(false));
    const drawn = t.widgets.length;
    await run(t);
    expect(t.main.overlay()).toBe(TALLY);
    expect(t.widgets).toHaveLength(drawn);
  });

  test("Esc before the request restores the overlay", async () => {
    const t = setup({
      outcomes: [answer("high"), answer("xhigh")],
      tally: [undefined, TALLY],
    });
    await run(t);
    await t.main.agentSettled(settled(false));
    await run(t);
    expect(t.widgets.at(-1)).toEqual(TALLY_LINE);
    await t.main.agentSettled(settled(true));
    expect(t.widgets.at(-1)).toEqual(["Jev · standard · high"]);
    expect(t.main.overlay()).toBeUndefined();
  });

  test("a throwing tallyText keeps the old overlay and the turn", async () => {
    const t = setup({
      outcomes: [answer("high"), answer("medium")],
      tally: [TALLY, new Error("boom")],
    });
    await run(t);
    await t.main.agentSettled(settled(false));
    await run(t);
    expect(t.main.overlay()).toBe(TALLY);
    expect(t.widgets.at(-1)).toEqual(["Jev · standard · " + TALLY]);
    expect(t.main.decision()).toEqual({ effort: { kind: "level", level: "medium" } });
  });

  test("Nothing decided never shows the tally", async () => {
    const t = setup({
      state: { switches: { effort: false, strategy: false } },
      tally: [TALLY],
    });
    await run(t);
    expect(t.tallyCalls.n).toBe(0);
    expect(t.main.overlay()).toBeUndefined();
  });

  test("Strategy-only session shows the tally on the 10th prompt", async () => {
    const t = setup({
      state: { switches: { effort: false } },
      outcomes: [advised("direct", 0.9)],
      tally: [TALLY],
    });
    await run(t);
    expect(t.widgets.at(-1)).toEqual(TALLY_LINE);
  });

  test("Tally replaces both suffixes", async () => {
    const t = setup({
      outcomes: [
        advised("delegate", 0.9),
        advised("delegate", 0.9),
        answer("medium", 0.1, 0.05, { strategy: ["delegate", 0.9] }),
      ],
      tally: [undefined, TALLY, undefined],
    });
    await run(t);
    await t.main.agentSettled(settled(false));
    expect(t.widgets.at(-1)).toEqual(["Jev · standard · high · delegate"]);
    await run(t);
    expect(t.widgets.at(-1)).toEqual(TALLY_LINE);
    await t.main.agentSettled(settled(false));
    await run(t);
    expect(t.widgets.at(-1)).toEqual(["Jev · standard · medium · delegate"]);
  });

  test("session start clears overlay", async () => {
    const t = setup({ outcomes: [answer("high")], tally: [TALLY] });
    await run(t);
    t.main.sessionStart();
    expect(t.main.overlay()).toBeUndefined();
  });
});

/** Skill tests run with `strategy` off, so they check only skill and effort questions. */
const setupS = (o: Parameters<typeof setup>[0] = {}) =>
  setup({ ...o, state: { ...o.state, switches: { strategy: false, ...o.state?.switches } } });

describe("skill questions", () => {
  const GATES = [
    "gate::acts_on_user_system",
    "gate::would_follow_documented_procedure",
    "gate::prose_suffices",
  ];
  const keysOf = (t: ReturnType<typeof setup>, i = 0) =>
    Object.keys(t.requests[i]!.questions as object);
  const skills = [{ name: "debug", body: "Debug it." }];
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ name: `s${i}`, body: `Body ${i}` }));
  const effortOff = { switches: { effort: false, strategy: false } };
  const settled = (aborted: boolean) => ({ type: "agent_settled", aborted }) as never;

  test("effort off, skills apply", async () => {
    const t = setupS({ state: effortOff, skills, start: "medium" });
    await run(t);
    expect(t.requests).toHaveLength(1);
    expect(keysOf(t)).toEqual(["corrects", "which", ...GATES]);
    expect(t.sets).toEqual([]);
    expect(t.level()).toBe("medium");
  });

  test("effort off and empty catalog", async () => {
    const t = setupS({ state: effortOff });
    await run(t);
    expect(t.requests).toHaveLength(0);
  });

  test("effort off and explicit skill", async () => {
    const t = setupS({ state: effortOff, skills });
    const block = skillBlock({
      name: "debug",
      path: "/s/debug/SKILL.md",
      baseDir: "/s/debug",
      body: "x",
    });
    await run(t, `${block}\n\nx`);
    expect(t.requests).toHaveLength(0);
  });

  test("operator loads a skill with effort on", async () => {
    const t = setupS({ skills });
    const block = skillBlock({
      name: "debug",
      path: "/s/debug/SKILL.md",
      baseDir: "/s/debug",
      body: "x",
    });
    await run(t, `${block}\n\nx`);
    expect(t.requests).toHaveLength(1);
    expect(keysOf(t)).toEqual(["effort", "risky", "corrects"]);
  });

  test("effort and skills", async () => {
    const t = setupS({ skills });
    await run(t);
    expect(keysOf(t)).toEqual(["effort", "risky", "corrects", "which", ...GATES]);
  });

  test("held prompt with skills", async () => {
    const t = setupS({
      skills,
      branch: [
        {
          type: "custom",
          customType: "jev-turn",
          data: {
            turnId: "T1",
            decided: { provider: "fixture", model: "fixture-main", level: "high" },
          },
        },
      ],
      holdProviders: ["fixture"],
      start: "high",
    });
    await run(t);
    expect(keysOf(t)).toEqual(["corrects", "which", ...GATES]);
  });

  test("skills off", async () => {
    const t = setupS({ skills, state: { switches: { skills: false, strategy: false } } });
    await run(t);
    expect(keysOf(t)).toEqual(["effort", "risky", "corrects"]);
    expect(t.reads).toEqual([]);
  });

  test("ineligible prompts never read the catalog", async () => {
    const unset = setupS({ skills, env: {} });
    await run(unset);
    expect(unset.reads).toEqual([]);
    const child = setupS({ skills, id: "child-1" });
    await run(child);
    expect(child.reads).toEqual([]);
  });

  test("two batches go out together", async () => {
    let first!: (o: JevOutcome) => void;
    let second!: (o: JevOutcome) => void;
    const t = setupS({
      skills: many(300),
      outcomes: [new Promise<JevOutcome>((r) => (first = r))],
      batchOutcomes: [new Promise<JevOutcome>((r) => (second = r))],
    });
    const pending = run(t);
    await Promise.resolve();
    await Promise.resolve();
    expect(t.requests).toHaveLength(2);
    expect(keysOf(t, 1)).toEqual(["which"]);
    const which = (t.requests[1]!.questions as Record<string, { criteria: object }>)["which"]!;
    expect(Object.keys(which.criteria)).toHaveLength(151);
    expect(t.requests[1]!.state).toEqual(t.requests[0]!.state);
    expect(t.requests[1]!.timeoutMs).toBe(t.requests[0]!.timeoutMs);
    expect(t.requests[1]!.model).toBe(t.requests[0]!.model);
    expect(t.requests[1]!.apiKey).toBe(t.requests[0]!.apiKey);
    first(answer("low"));
    second(answer("low"));
    await pending;
  });

  for (const [name, second] of [
    ["fails", { kind: "miss", miss: "timeout", reason: "x", ms: 3 } as JevOutcome],
    ["cancelled", { kind: "cancelled" } as JevOutcome],
  ] as const) {
    test(`later batch ${name}`, async () => {
      const t = setupS({
        skills: many(300),
        outcomes: [answerWith({ effort: "high", which: ["s0", 0.9], gates: [0.9, 0.9, 0.1] })],
        batchOutcomes: [second],
      });
      expect(await run(t)).toBeUndefined();
      expect(t.level()).toBe("high");
      expect(t.custom.filter((c) => c.type !== "jev-turn")).toEqual([]);
      await t.main.agentSettled(settled(false));
      const main = t.appended.find((e) => (e as { kind?: string }).kind === "main")!;
      expect(main).not.toHaveProperty("skill");
      expect(main).not.toHaveProperty("skillP");
      expect(main).not.toHaveProperty("gate");
    });
  }
});

describe("skill message", () => {
  const skills = [{ name: "debug", body: "Debug it." }];
  const print = fingerprint("Debug it.");
  const sk = { name: "debug", path: "/s/debug/SKILL.md", baseDir: "/s/debug", body: "Debug it." };
  const effortOff = { switches: { effort: false, strategy: false } };
  const strong = answerWith({ effort: "high", which: ["debug", 0.6], gates: [0.9, 0.9, 0.1] });
  const settled = (aborted: boolean) => ({ type: "agent_settled", aborted }) as never;
  const delivered = (form: string, fp: string) => ({
    sourceEntry: {
      type: "custom_message",
      customType: "jev-skill",
      content: "x",
      details: { name: "debug", fingerprint: fp, form },
    },
    messages: [{ content: "x" }],
  });
  const expected = (form: "content" | "suggest" | "reference") => ({
    message: {
      customType: "jev-skill",
      display: false,
      content: deliveryText(form, sk),
      details: { name: "debug", fingerprint: print, form },
    },
  });

  test("content form", async () => {
    const t = setupS({ skills, outcomes: [strong] });
    expect(await run(t)).toEqual(expected("content"));
  });

  test("skill and advice share one message, skill first", async () => {
    const both = answerWith({ effort: "high", which: ["debug", 0.6], gates: [0.9, 0.9, 0.1] });
    const answers = (both as { body: { answers: Record<string, unknown> } }).body.answers;
    answers["strategy"] = {
      type: "choice",
      choice: "delegate",
      probabilities: { direct: 0.025, delegate: 0.9, parallel: 0.05, graph: 0.025 },
    };
    answers["tier"] = {
      type: "choice",
      choice: "balanced",
      probabilities: { fast: 0.1, balanced: 0.8, deep: 0.1 },
    };
    const t = setup({ skills, outcomes: [both] });
    const result = (await run(t)) as {
      message: { customType: string; content: string; details: unknown };
    };
    expect(result.message.customType).toBe("jev-skill");
    expect(result.message.details).toEqual({ name: "debug", fingerprint: print, form: "content" });
    expect(result.message.content).toBe(
      `${deliveryText("content", sk)}\n\n${strategyBlock("delegate")}`,
    );
    await t.main.agentSettled(settled(false));
    const line = t.appended.find((e) => (e as { kind: string }).kind === "main") as Record<
      string,
      unknown
    >;
    expect(line["skill"]).toBe("debug");
    expect(line["advised"]).toBe(true);
  });

  test("suggest form", async () => {
    const t = setupS({ skills, inject: "suggest", outcomes: [strong] });
    const result = (await run(t)) as { message: { content: string; details: { form: string } } };
    expect(result).toEqual(expected("suggest"));
    expect(result.message.content).toContain("/s/debug/SKILL.md");
    expect(result.message.content).not.toContain("Debug it.");
  });

  test("none leads", async () => {
    const t = setupS({
      skills,
      outcomes: [answerWith({ effort: "high", which: ["(none)", 0.9], gates: [0.9, 0.9, 0.1] })],
    });
    expect(await run(t)).toBeUndefined();
  });

  test("gate too low", async () => {
    const t = setupS({
      skills,
      outcomes: [answerWith({ effort: "high", which: ["debug", 0.4], gates: [0.2, 0.2, 0.8] })],
    });
    expect(await run(t)).toBeUndefined();
  });

  test("reference", async () => {
    const t = setupS({ skills, outcomes: [strong], projection: [delivered("content", print)] });
    expect(await run(t)).toEqual(expected("reference"));
  });

  test("skill edited since", async () => {
    const t = setupS({ skills, outcomes: [strong], projection: [delivered("content", "old")] });
    expect(await run(t)).toEqual(expected("content"));
  });

  test("other branch", async () => {
    const t = setupS({
      skills,
      outcomes: [strong],
      branch: [delivered("content", print).sourceEntry],
      projection: [],
    });
    expect(await run(t)).toEqual(expected("content"));
  });

  describe("survives effort paths", () => {
    test("held", async () => {
      const t = setupS({
        skills,
        outcomes: [strong],
        holdProviders: ["fixture"],
        start: "high",
        branch: [
          {
            type: "custom",
            customType: "jev-turn",
            data: {
              turnId: "T1",
              decided: { provider: "fixture", model: "fixture-main", level: "high" },
            },
          },
        ],
      });
      expect(await run(t)).toEqual(expected("content"));
      expect(t.sets).toEqual([]);
    });

    test("discarded", async () => {
      let resolve!: (o: JevOutcome) => void;
      const t = setupS({ skills, outcomes: [new Promise<JevOutcome>((r) => (resolve = r))] });
      const pending = run(t);
      t.setLevel("high");
      resolve(answerWith({ effort: "xhigh", which: ["debug", 0.6], gates: [0.9, 0.9, 0.1] }));
      expect(await pending).toEqual(expected("content"));
      expect(t.sets).toEqual([]);
    });

    test("max", async () => {
      const t = setupS({ skills, start: "max", outcomes: [strong] });
      expect(await run(t)).toEqual(expected("content"));
    });

    test("effort unanswered", async () => {
      const t = setupS({
        skills,
        outcomes: [answerWith({ effort: "bogus", which: ["debug", 0.6], gates: [0.9, 0.9, 0.1] })],
      });
      expect(await run(t)).toEqual(expected("content"));
      expect(t.main.decision()).toEqual({ effort: { kind: "no-answer" } });
    });
  });

  test("skills only", async () => {
    const t = setupS({
      skills,
      state: effortOff,
      start: "medium",
      outcomes: [answerWith({ which: ["debug", 0.6], gates: [0.9, 0.9, 0.1] })],
    });
    expect(await run(t)).toEqual(expected("content"));
    expect(t.widgets).toEqual([]);
    expect(t.main.decision()).toBeUndefined();
    await t.main.agentSettled(settled(false));
    expect(t.custom.find((c) => c.type === "jev-turn")?.data).toEqual({
      turnId: "11111111-1111-1111-1111-111111111111",
    });
  });

  test("skills only, Jev miss", async () => {
    const t = setupS({
      skills,
      state: effortOff,
      outcomes: [{ kind: "miss", miss: "timeout", reason: "x", ms: 3 }],
    });
    expect(await run(t)).toBeUndefined();
    expect(t.widgets).toEqual([]);
    expect(t.main.decision()).toBeUndefined();
  });

  test("skills only, schema miss", async () => {
    const t = setupS({
      skills,
      state: effortOff,
      outcomes: [{ kind: "ok", ms: 1, body: {} }],
    });
    expect(await run(t)).toBeUndefined();
    expect(t.widgets).toEqual([]);
    expect(t.main.decision()).toBeUndefined();
  });

  test("main miss", async () => {
    const t = setupS({
      skills,
      outcomes: [{ kind: "miss", miss: "timeout", reason: "x", ms: 3 }],
    });
    expect(await run(t)).toBeUndefined();
    expect(t.main.decision()).toEqual({ effort: { kind: "no-answer" } });
  });

  test("cancelled", async () => {
    const t = setupS({ skills, outcomes: [{ kind: "cancelled" }] });
    expect(await run(t)).toBeUndefined();
  });

  test("throwing projection", async () => {
    const t = setupS({ skills, outcomes: [strong] });
    t.ctxRaw.sessionManager.buildSessionProjection = () => {
      throw new Error("boom");
    };
    expect(await run(t)).toBeUndefined();
    expect(t.level()).toBe("high");
  });

  test("unreadable which", async () => {
    const t = setupS({
      skills,
      outcomes: [answerWith({ effort: "high", which: ["zzz", 0.9], gates: [0.9, 0.9, 0.1] })],
    });
    expect(await run(t)).toBeUndefined();
    expect(t.level()).toBe("high");
  });

  test("esc after the pick", async () => {
    const t = setupS({ skills, outcomes: [strong] });
    expect(await run(t)).toEqual(expected("content"));
    await t.main.agentSettled(settled(true));
    expect(t.appended).toEqual([]);
    expect(t.custom.filter((c) => c.type === "jev-turn")).toEqual([]);
  });
});

describe("skill fields on the main line", () => {
  const skills = [{ name: "debug", body: "Debug it." }];
  const settled = { type: "agent_settled", aborted: false } as never;
  const mainLine = async (t: ReturnType<typeof setup>, prompt?: string) => {
    await run(t, prompt);
    await t.main.agentSettled(settled);
    const line = t.appended.find((e) => (e as { kind?: string }).kind === "main") as Record<
      string,
      unknown
    >;
    expect(validateLedgerEntry(line).ok).toBe(true);
    return line;
  };
  /** A reply whose `which` probabilities are given outright. */
  const withWhich = (probabilities: Record<string, number>, gates: [number, number, number]) => {
    const out = answerWith({ effort: "high", gates }) as { body: { answers: object } };
    (out.body.answers as Record<string, unknown>)["which"] = {
      type: "choice",
      choice: "debug",
      probabilities,
    };
    return out as unknown as JevOutcome;
  };
  const none = (line: Record<string, unknown>) => {
    for (const k of ["skill", "skillP", "gate"]) expect(line).not.toHaveProperty(k);
  };

  test("skill picked", async () => {
    const t = setupS({
      skills,
      outcomes: [answerWith({ effort: "high", which: ["debug", 0.6], gates: [0.4, 0.4, 0.6] })],
    });
    const line = await mainLine(t);
    expect(line["skill"]).toBe("debug");
    expect(line["skillP"]).toBe(0.6);
    expect(line["gate"] as number).toBeCloseTo(0.4, 5);
  });

  test("skill picked again as a reference", async () => {
    const t = setupS({
      skills,
      outcomes: [answerWith({ effort: "high", which: ["debug", 0.6], gates: [0.9, 0.9, 0.1] })],
      projection: [
        {
          sourceEntry: {
            type: "custom_message",
            customType: "jev-skill",
            content: "x",
            details: { name: "debug", fingerprint: fingerprint("Debug it."), form: "content" },
          },
          messages: [{ content: "x" }],
        },
      ],
    });
    expect((await mainLine(t))["skill"]).toBe("debug");
  });

  test("below the threshold", async () => {
    const t = setupS({
      skills,
      outcomes: [withWhich({ debug: 0.45, "(none)": 0.35 }, [0.3, 0.3, 0.75])],
    });
    const line = await mainLine(t);
    expect(line).not.toHaveProperty("skill");
    expect(line["skillP"]).toBe(0.45);
    expect(line["gate"] as number).toBeCloseTo(0.29, 1);
  });

  test("none leads", async () => {
    const t = setupS({
      skills,
      outcomes: [withWhich({ debug: 0.1, "(none)": 0.9 }, [0.1, 0.1, 0.9])],
    });
    const line = await mainLine(t);
    expect(line).not.toHaveProperty("skill");
    expect(line).not.toHaveProperty("skillP");
    expect(line["gate"] as number).toBeCloseTo(0.1, 5);
  });

  test("skills not asked", async () => {
    none(
      await mainLine(setupS({ skills, state: { switches: { skills: false, strategy: false } } })),
    );
    const block = skillBlock({
      name: "debug",
      path: "/s/debug/SKILL.md",
      baseDir: "/s/debug",
      body: "x",
    });
    none(await mainLine(setupS({ skills }), `${block}\n\nx`));
    const failed = setupS({
      skills: Array.from({ length: 300 }, (_, i) => ({ name: `s${i}`, body: "b" })),
      outcomes: [answerWith({ effort: "high", which: ["s0", 0.9], gates: [0.9, 0.9, 0.1] })],
      batchOutcomes: [{ kind: "miss", miss: "timeout", reason: "x", ms: 3 }],
    });
    none(await mainLine(failed));
  });

  test("skills only", async () => {
    const t = setupS({
      skills,
      state: { switches: { effort: false, strategy: false } },
      outcomes: [answerWith({ which: ["debug", 0.6], gates: [0.9, 0.9, 0.1] })],
    });
    const line = await mainLine(t);
    expect(line["skill"]).toBe("debug");
    expect(line).not.toHaveProperty("requested");
    expect(line).not.toHaveProperty("effective");
  });

  test("held prompt with a pick", async () => {
    const t = setupS({
      skills,
      outcomes: [answerWith({ effort: "high", which: ["debug", 0.6], gates: [0.9, 0.9, 0.1] })],
      holdProviders: ["fixture"],
      start: "high",
      branch: [
        {
          type: "custom",
          customType: "jev-turn",
          data: {
            turnId: "T1",
            decided: { provider: "fixture", model: "fixture-main", level: "high" },
          },
        },
      ],
    });
    const line = await mainLine(t);
    expect(line["held"]).toBe(true);
    expect(line["effective"]).toBe("high");
    expect(line["skill"]).toBe("debug");
    for (const k of ["effortP", "risky", "requested"]) expect(line).not.toHaveProperty(k);
  });

  test("a throw while building later batches fails open", async () => {
    const t = setupS({
      skills: Array.from({ length: 300 }, (_, i) => ({ name: `s${i}`, body: "b" })),
      outcomes: [answerWith({ effort: "high", which: ["s0", 0.9], gates: [0.9, 0.9, 0.1] })],
    });
    const ask = t.deps.ask;
    t.deps.ask = (req) => {
      const keys = Object.keys(req.questions as object);
      if (keys.length === 1 && keys[0] === "which") throw new Error("sync boom");
      return ask(req);
    };
    expect(await run(t)).toBeUndefined();
    expect(t.level()).toBe("high");
    await t.main.agentSettled(settled);
    const main = t.appended.find((e) => (e as { kind?: string }).kind === "main")!;
    expect(main).not.toHaveProperty("skill");
    expect(main).not.toHaveProperty("skillP");
    expect(main).not.toHaveProperty("gate");
  });

  test("a throw while picking fails open", async () => {
    const t = setupS({
      skills: Array.from({ length: 300 }, (_, i) => ({ name: `s${i}`, body: "b" })),
      outcomes: [answerWith({ effort: "high", which: ["s0", 0.9], gates: [0.9, 0.9, 0.1] })],
      batchOutcomes: [
        {
          kind: "ok",
          ms: 1,
          get body(): never {
            throw new Error("boom");
          },
        } as unknown as JevOutcome,
      ],
    });
    expect(await run(t)).toBeUndefined();
    expect(t.level()).toBe("high");
    await t.main.agentSettled(settled);
    none(
      t.appended.find((e) => (e as { kind?: string }).kind === "main") as Record<string, unknown>,
    );
  });
});

describe("rich state inputs", () => {
  const noRich = { git: async () => undefined, tools: () => [], agents: () => [] };
  const stateOf = (t: ReturnType<typeof setup>, i: number) =>
    t.requests[i]!.state as { conversation: Record<string, unknown>; workspace: object };

  test("last decision carried to the next prompt", async () => {
    const t = setup({
      outcomes: [advised("delegate", 0.9, { tier: "balanced" }), answer("low")],
      rich: { ...noRich, groups: ["last_decision"] },
    });
    await run(t);
    await t.main.agentSettled({ aborted: false } as never);
    await run(t);
    expect(stateOf(t, 0).conversation["last_decision"]).toBeUndefined();
    expect(stateOf(t, 1).conversation["last_decision"]).toEqual({
      effort: "high",
      strategy: "delegate",
    });
  });

  test("last decision cleared on session start", async () => {
    const t = setup({ rich: { ...noRich, groups: ["last_decision"] } });
    await run(t);
    await t.main.agentSettled({ aborted: false } as never);
    t.main.sessionStart();
    await run(t);
    expect(stateOf(t, 1).conversation["last_decision"]).toBeUndefined();
  });

  test("shipped git sent", async () => {
    const seen: string[] = [];
    const t = setup({
      rich: {
        ...noRich,
        groups: ["git"],
        git: async (cwd) => (seen.push(cwd), { changed_files: 3, diff_lines: 9 }),
      },
    });
    await run(t);
    expect(seen).toEqual(["/tmp/x"]);
    expect(stateOf(t, 0).workspace).toMatchObject({ git: { changed_files: 3, diff_lines: 9 } });
  });

  test("a rejecting git count neither throws nor stops the decision", async () => {
    const seen: unknown[] = [];
    const onUnhandled = (e: unknown) => seen.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      const t = setup({
        rich: {
          ...noRich,
          groups: ["git"],
          git: () => Promise.reject(new Error("git down")),
        },
      });
      await run(t);
      await new Promise((r) => setTimeout(r, 10));
      expect(t.requests).toHaveLength(1);
      expect(t.level()).toBe("low");
      expect(seen).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  test("git count not started when a gate rejects the turn", async () => {
    let calls = 0;
    const t = setup({
      env: {},
      rich: { ...noRich, groups: ["git"], git: async () => (calls++, undefined) },
    });
    await run(t);
    expect(calls).toBe(0);
  });

  test("a failing group does not stop the decision", async () => {
    const t = setup({
      rich: {
        ...noRich,
        groups: ["capabilities"],
        tools: () => {
          throw new Error("boom");
        },
      },
    });
    await run(t);
    expect(t.requests).toHaveLength(1);
    expect(t.level()).toBe("low");
  });
});
