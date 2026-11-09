import { describe, expect, test } from "bun:test";
import { createMain, type MainDeps } from "../../../src/host/main/create.ts";
import { buildSnapshot, type Snapshot } from "../../../src/host/platform/readiness.ts";
import type { JevOutcome, JevRequest } from "../../../src/jev/client.ts";
import type { ThinkingLevel } from "../../../src/policy/effort.ts";

// Regressions for when and through what the main handlers read their inputs: the receiver of
// dependency methods, values captured around the rich-input wait, lazy context reads, and the
// skill-delivery error boundary.

const MODEL = { provider: "p", id: "m", reasoning: true, thinkingLevelMap: { xhigh: "xhigh" } };
const SKILLS_OFF = { switches: { strategy: false, skills: false } };

function effortAnswer(choice: string, corrects = 0.05): JevOutcome {
  const probabilities = { low: 0.1, medium: 0.1, high: 0.1, xhigh: 0.1, max: 0.1, [choice]: 0.6 };
  return {
    kind: "ok",
    ms: 4,
    body: {
      answers: {
        effort: { type: "choice", choice, probabilities },
        risky: { type: "noul", noul: 0.1 },
        corrects: { type: "noul", noul: corrects },
      },
    },
  };
}

const snapshotOf = (state: object = SKILLS_OFF): Snapshot =>
  buildSnapshot({
    configRead: { kind: "ok", present: true, config: {} as never },
    stateRead: { kind: "ok", state: state as never },
    env: { TYPESAFE_API_KEY: "k" },
    toolNames: [],
  });

type Harness = {
  pi: { level: ThinkingLevel; entries: { type: string; data: unknown }[] };
  appended: Record<string, unknown>[];
  requests: JevRequest[];
};

/** Minimal Pi, context and deps; every piece can be replaced per test. */
function harness(over: { deps?: Partial<MainDeps>; ctx?: object } = {}) {
  const h: Harness = { pi: { level: "low", entries: [] }, appended: [], requests: [] };
  const pi = {
    getThinkingLevel: () => h.pi.level,
    setThinkingLevel: (level: ThinkingLevel) => (h.pi.level = level),
    appendEntry: (type: string, data: unknown) => h.pi.entries.push({ type, data }),
  };
  const deps: MainDeps = {
    load: () => snapshotOf(),
    ask: async (req) => {
      h.requests.push(req);
      return effortAnswer("high");
    },
    append: (entry) => {
      h.appended.push(entry as Record<string, unknown>);
      return { ok: true } as never;
    },
    now: () => 1000,
    newId: () => "turn-new",
    platforms: () => [],
    env: () => ({ TYPESAFE_API_KEY: "k" }),
    commands: () => [],
    readFile: () => "",
    rich: { groups: [], tools: () => [], agents: () => [] },
    ...over.deps,
  };
  const ctx = {
    sessionManager: {
      getSessionId: () => "s-1",
      getBranch: () => [],
      buildSessionProjection: () => ({ entries: [], messages: [] }),
    },
    model: MODEL,
    cwd: "/tmp/x",
    hasUI: false,
    mode: "rpc",
    signal: undefined,
    ui: { setWidget: () => {} },
  };
  // Copy descriptors, not values, so a getter on the override stays a getter.
  Object.defineProperties(ctx, Object.getOwnPropertyDescriptors(over.ctx ?? {}));
  const main = createMain(pi as never, deps);
  const prompt = (text = "do the thing") =>
    main.beforeAgentStart(
      { type: "before_agent_start", messageType: "user", prompt: text } as never,
      ctx as never,
    );
  const settle = () => main.agentSettled({ type: "agent_settled", aborted: false } as never);
  return { h, main, ctx, prompt, settle };
}

const mainLineOf = (h: Harness) => h.appended.find((line) => line["kind"] === "main");

describe("dependency methods keep their receiver", () => {
  test("load may read other deps through this", async () => {
    const deps = {
      env() {
        return { TYPESAFE_API_KEY: "k" };
      },
      load(this: { env: () => Record<string, string> }) {
        if (this?.env === undefined) throw new Error("load lost its receiver");
        return snapshotOf();
      },
    };
    const { h, prompt } = harness({ deps: deps as never });

    await prompt();

    expect(h.requests).toHaveLength(1);
    expect(h.pi.level).toBe("high");
  });

  test("ask for later skill batches may read other deps through this", async () => {
    const names = Array.from({ length: 300 }, (_, i) => `skill-${i}`);
    const asked: JevRequest[] = [];
    const deps = {
      load: () => snapshotOf({ switches: { strategy: false, skills: true } }),
      commands: () =>
        names.map((name) => ({
          name: `skill:${name}`,
          source: "skill",
          sourceInfo: { path: `/s/${name}/SKILL.md`, baseDir: `/s/${name}` },
        })),
      readFile: (path: string) => `---\nname: ${path.split("/")[2]}\n---\nBody.`,
      marker: "deps",
      async ask(this: { marker?: string }, req: JevRequest): Promise<JevOutcome> {
        if (this?.marker !== "deps") throw new Error("ask lost its receiver");
        asked.push(req);
        return effortAnswer("high");
      },
    };
    const { prompt } = harness({ deps: deps as never });

    await prompt();

    expect(asked).toHaveLength(2);
  });
});

describe("turn identity is captured around the rich-input wait as before", () => {
  test("the ledger line carries the session id read at the child gate", async () => {
    const ids = ["initial", "later"];
    const ctx = {
      sessionManager: {
        getSessionId: () => ids.shift() ?? "later",
        getBranch: () => [],
        buildSessionProjection: () => ({ entries: [], messages: [] }),
      },
    };
    const { h, prompt, settle } = harness({ ctx });

    await prompt();
    await settle();

    expect(mainLineOf(h)?.["session"]).toBe("initial");
  });

  test("the correction line targets the previous turn as seen after the rich inputs", async () => {
    const turn = (turnId: string) => ({ type: "custom", customType: "jev-turn", data: { turnId } });
    const branch: unknown[] = [turn("before-rich")];
    const ctx = {
      sessionManager: {
        getSessionId: () => "s-1",
        getBranch: () => branch,
        buildSessionProjection: () => ({ entries: [], messages: [] }),
      },
    };
    const deps: Partial<MainDeps> = {
      ask: async () => effortAnswer("high", 0.9),
      rich: {
        groups: ["capabilities"],
        tools: () => {
          branch.push(turn("during-rich"));
          return [];
        },
        agents: () => [],
      },
    };
    const { h, prompt, settle } = harness({ deps, ctx });

    await prompt();
    await settle();

    const correction = h.appended.find((line) => line["kind"] === "correction");
    expect(correction?.["turnId"]).toBe("during-rich");
  });
});

describe("the model is read lazily, after the config and key gates", () => {
  const countingCtx = (models: (object | undefined)[]) => {
    const reads = { n: 0 };
    const ctx = {
      get model() {
        reads.n++;
        return models.length > 1 ? models.shift() : models[0];
      },
    };
    return { reads, ctx };
  };

  test("a run started by a custom message never reads the model", async () => {
    const { reads, ctx } = countingCtx([MODEL]);
    const { main, ctx: started } = harness({ ctx });

    await main.beforeAgentStart(
      { type: "before_agent_start", messageType: "custom", message: {} } as never,
      started as never,
    );

    expect(reads.n).toBe(0);
  });

  test("a model selected while the snapshot loads is the one the turn uses", async () => {
    let selected: object | undefined;
    const ctx = {
      get model() {
        return selected;
      },
    };
    const deps: Partial<MainDeps> = {
      load: () => {
        selected = MODEL;
        return snapshotOf();
      },
    };
    const { h, prompt } = harness({ deps, ctx });

    await prompt();

    expect(h.requests).toHaveLength(1);
    expect(h.pi.level).toBe("high");
  });
});

describe("skill delivery fails on its own", () => {
  test("a failing skills setting read does not stop the effort decision", async () => {
    const snapshot = snapshotOf();
    Object.defineProperty(snapshot.settings, "skills", {
      get() {
        throw new Error("skills setting unreadable");
      },
    });
    const { h, prompt, settle } = harness({ deps: { load: () => snapshot } });

    await prompt();
    await settle();

    expect(h.pi.level).toBe("high");
    expect(mainLineOf(h)).toMatchObject({ answered: true, effective: "high" });
  });
});
