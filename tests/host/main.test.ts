import { describe, expect, test } from "bun:test";
import { createMain, type MainDeps } from "../../src/host/main.ts";
import { buildSnapshot, type Snapshot } from "../../src/host/readiness.ts";
import { mainQuestions } from "../../src/jev/questions.ts";
import { mainState } from "../../src/jev/state.ts";
import type { JevOutcome, JevRequest } from "../../src/jev/client.ts";
import type { ThinkingLevel } from "../../src/policy/effort.ts";
import type { Config, ConfigRead } from "../../src/store/config.ts";
import type { State } from "../../src/store/state-file.ts";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

function answer(choice: string, risky = 0.1, corrects = 0.05): JevOutcome {
  const probabilities = Object.fromEntries(EFFORTS.map((l) => [l, l === choice ? 0.6 : 0.1]));
  return {
    kind: "ok",
    ms: 7,
    body: {
      answers: {
        effort: { type: "choice", choice, probabilities },
        risky: { type: "noul", noul: risky },
        corrects: { type: "noul", noul: corrects },
      },
    },
  };
}

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
  } = {},
) {
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
    appendEntry: () => {},
    getAllTools: () => [],
  };
  const widgets: unknown[] = [];
  const ctx = {
    sessionManager: {
      getSessionId: () => o.id ?? sessionId,
      getBranch: () => {
        if (o.branchThrows) throw new Error("boom");
        return [];
      },
    },
    model: "model" in o ? o.model : { reasoning: true, thinkingLevelMap: { xhigh: "xhigh" } },
    cwd: "/tmp/x",
    hasUI: true,
    mode: "rpc",
    signal: undefined as AbortSignal | undefined,
    ui: { setWidget: (_k: string, lines: unknown) => widgets.push(lines) },
  };
  const requests: JevRequest[] = [];
  const queue = [...(o.outcomes ?? [])];
  const snapshot: Snapshot = buildSnapshot({
    configRead: o.config ?? { kind: "ok", present: true, config: {} as Config },
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
    append: () => ({ ok: true }),
    now: () => 1000,
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
    widgets,
    requests,
    event,
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
  untouched("effort off", { state: { switches: { effort: false } } });
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
    expect(t.main.decision()).toEqual({ kind: "level", level: "xhigh" });
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
    const t = setup({ start: "off", model: { reasoning: false }, outcomes: [answer("high")] });
    await run(t);
    expect(Object.keys(t.requests[0]!.questions as object)).toEqual(["corrects"]);
    expect(t.sets).toEqual([]);
  });

  test("request matches builders and signal is ctx.signal", async () => {
    const t = setup({ outcomes: [answer("low")] });
    const ac = new AbortController();
    t.ctxRaw.signal = ac.signal;
    await run(t, "why does src/a.ts fail?");
    const req = t.requests[0]!;
    expect(req.questions).toEqual(mainQuestions({ askEffort: true }).wire);
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
    expect(t.main.decision()).toEqual({ kind: "level", level: "high" });
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
