import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { askJev, type JevOutcome, type JevRequest } from "../../../src/jev/client.ts";
import { CHILDREN_KEY } from "../../../src/host/platform/child.ts";
import { planTools } from "../../../src/host/tools/plan.ts";
import { resolveSettings } from "../../../src/store/settings.ts";
import { startJevFixture } from "../../jev/fixture.ts";
import {
  body,
  DEFAULT_TOOLS,
  harness,
  isToolRequest,
  launchRequest,
  ok,
  runToCompletion,
  toolBody,
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
const toolAsks = (h: H): JevRequest[] => h.asks.filter(isToolRequest);
const workerAsks = (h: H): JevRequest[] => h.asks.filter((r) => !isToolRequest(r));
const keysOf = (req: JevRequest | undefined) => Object.keys((req?.questions ?? {}) as object);

/** Tools on with routing as given; the default script answers both requests. */
function tools(o: Opts & { tools?: unknown[] } = {}) {
  return harness({ ...o, switches: { tools: true, subagents: false, ...o.switches } });
}

const BASH = {
  name: "bash",
  description: "Run a shell command",
  sourceInfo: { source: "builtin" },
  parameters: { properties: { command: { description: "The command to run" } } },
};

describe("When assessment runs", () => {
  const gated: [string, Opts][] = [
    ["Switch off", { switches: { tools: false } }],
    ["No key", { keySet: false }],
    ["Invalid config", { valid: false }],
    ["Duplicate executor", { executor: "duplicate" }],
  ];
  for (const [name, o] of gated) {
    test(name, async () => {
      const h = tools(o);
      const { adjustment } = await h.launch();
      expect(toolAsks(h)).toHaveLength(0);
      expect(adjustment).toBeUndefined();
    });
  }

  test("Executor absent", async () => {
    const h = tools({ executor: false });
    expect(h.executor.policy()).toBeUndefined();
    expect(h.asks).toHaveLength(0);
  });

  test("Main session", () => {
    // A prompt that launches no worker never reaches the policy: nothing is asked.
    const h = tools();
    expect(h.handlers).toEqual([]);
    expect(h.asks).toHaveLength(0);
  });

  test("a launch from a worker is not assessed", async () => {
    const h = tools();
    (globalThis as Record<symbol, unknown>)[CHILDREN_KEY] = new Set(["child-1"]);
    await h.launch({ parentSessionId: "child-1" });
    expect(h.asks).toHaveLength(0);
  });

  test("Routing off, assessment on", async () => {
    const h = tools();
    await h.launch();
    expect(toolAsks(h)).toHaveLength(1);
    expect(workerAsks(h)).toHaveLength(0);
  });

  test("Mode read once", async () => {
    const h = tools({ toolsMode: "observe" });
    h.setScript(() => {
      h.setSnap({ switches: { tools: true, subagents: false }, toolsMode: "enforce" });
      return ok(toolBody({ "tool::edit": 0.9 }));
    });
    const { adjustment } = await h.launch();
    expect(adjustment).toBeUndefined();
  });
});

describe("Candidates and request", () => {
  test("planTools is empty with the switch off or an empty prompt", () => {
    const on = resolveSettings({ config: {}, state: {} } as never);
    const off = resolveSettings({
      config: {},
      state: { switches: { tools: false } },
    } as never);
    const request = launchRequest();
    expect(planTools(request, on)).toEqual({ block: DEFAULT_TOOLS, grant: [] });
    expect(planTools(request, off)).toEqual({ block: [], grant: [] });
    expect(planTools(launchRequest({ prompt: "" }), on)).toEqual({ block: [], grant: [] });
  });

  test("One noul per candidate", async () => {
    const h = tools();
    await h.launch({
      toolSet: { defaults: ["read", "edit", "bash"], parentTools: ["read", "web_search"] },
    });
    const req = toolAsks(h)[0]!;
    expect(keysOf(req)).toEqual(["tool::read", "tool::edit", "tool::bash", "grant::web_search"]);
    for (const q of Object.values(req.questions as Record<string, { type: string }>)) {
      expect(q.type).toBe("noul");
    }
  });

  test("Review tool never a candidate", async () => {
    const h = tools();
    await h.launch({ toolSet: { parentTools: [...DEFAULT_TOOLS, "jev_review"] } });
    expect(keysOf(toolAsks(h)[0])).not.toContain("grant::jev_review");
  });

  test("Tool metadata from Pi", async () => {
    const h = tools({ tools: [BASH] });
    await h.launch({ toolSet: { defaults: ["bash"], parentTools: ["bash"] } });
    const state = toolAsks(h)[0]!.state as { tools: Record<string, unknown> };
    expect(state.tools["bash"]).toEqual({
      description: "Run a shell command",
      source: "builtin",
      parameters: { command: "The command to run" },
    });
  });

  test("Long tool description", async () => {
    const h = tools({ tools: [{ ...BASH, description: "é".repeat(900) }] });
    await h.launch({ toolSet: { defaults: ["bash"], parentTools: ["bash"] } });
    const state = toolAsks(h)[0]!.state as { tools: { bash: { description: string } } };
    expect(state.tools.bash.description).toBe("é".repeat(500));
  });

  test("Long brief", async () => {
    const h = tools();
    const prompt = `${"a".repeat(1000)}${"b".repeat(4000)}`;
    await h.launch({ prompt });
    const state = toolAsks(h)[0]!.state as { task: { brief: string } };
    expect(state.task.brief).toBe("b".repeat(4000));
  });

  test("Forked worker", async () => {
    const h = tools();
    await h.launch({ inheritContext: true, prompt: "own prompt" });
    const state = toolAsks(h)[0]!.state as { task: { brief: string } };
    expect(state.task.brief).toBe("own prompt");
  });

  test("Empty prompt", async () => {
    const h = tools({ toolsMode: "enforce" });
    const { adjustment } = await h.launch({ prompt: "" });
    expect(toolAsks(h)).toHaveLength(0);
    expect(adjustment).toBeUndefined();
  });

  test("the request carries no model or thinking setting", async () => {
    const h = tools();
    await h.launch({ requested: { model: "fx/main", thinking: "high" } });
    const json = JSON.stringify(toolAsks(h)[0]!.state);
    expect(json).not.toContain("fx/main");
    expect(json).not.toContain('"thinking"');
  });
});

describe("Concurrency and deadline", () => {
  test("Concurrent with routing", async () => {
    const h = tools({ switches: { subagents: true } });
    const started: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    h.setScript(async (req) => {
      started.push(isToolRequest(req) ? "tools" : "worker");
      if (started.length === 2) release();
      await gate;
      return isToolRequest(req) ? ok(toolBody({})) : ok(body("fast"));
    });
    const { adjustment } = await h.launch();
    expect(started.sort()).toEqual(["tools", "worker"]);
    expect(adjustment).toEqual({ model: "fx/fast", thinking: "medium" });
  });

  test("both requests share one deadline from the fresh classifier timeout", async () => {
    const h = tools({ switches: { subagents: true }, timeoutMs: 1500 });
    h.setSnap({ switches: { tools: true, subagents: true }, timeoutMs: 1700 });
    h.setScript((req) => {
      h.tick(300);
      return isToolRequest(req) ? ok(toolBody({})) : ok(body("fast"));
    });
    await h.launch();
    const [first, second] = h.asks;
    expect(first!.timeoutMs).toBe(1700);
    expect(second!.timeoutMs).toBe(1400);
    expect(first!.signal).toBe(second!.signal);
  });

  test("Timeout", async () => {
    const fx = await startJevFixture({ "/hang": { hang: true } });
    try {
      const h = tools({ toolsMode: "enforce", timeoutMs: 200 });
      h.setScript((req) => askJev({ ...req, url: fx.url("/hang") }));
      const started = performance.now();
      const { adjustment, request } = await h.launch();
      expect(performance.now() - started).toBeLessThan(600);
      expect(adjustment).toBeUndefined();
      h.created(request.agentId);
      h.completed(request.agentId);
      expect(h.lines).toHaveLength(0);
    } finally {
      await fx.stop();
    }
  });
});

describe("Observe and enforce", () => {
  const answer = () => ok(toolBody({ "tool::edit": 0.9, "grant::web_search": 0.85 }));
  const withWeb = { toolSet: { parentTools: [...DEFAULT_TOOLS, "web_search"] } };

  test("Observe keeps tools", async () => {
    const h = tools({ toolsMode: "observe" });
    h.setScript(answer);
    expect((await h.launch(withWeb)).adjustment).toBeUndefined();
  });

  test("enforce removes flagged and adds granted tools", async () => {
    const h = tools({ toolsMode: "enforce" });
    h.setScript(answer);
    expect((await h.launch(withWeb)).adjustment).toEqual({
      removeTools: ["edit"],
      addTools: ["web_search"],
    });
  });

  test("enforce merges tools with the route", async () => {
    const h = tools({ toolsMode: "enforce", switches: { subagents: true } });
    h.setScript((req) => (isToolRequest(req) ? answer() : ok(body("fast"))));
    expect((await h.launch(withWeb)).adjustment).toEqual({
      model: "fx/fast",
      thinking: "medium",
      removeTools: ["edit"],
      addTools: ["web_search"],
    });
  });

  test("Never adds", async () => {
    const h = tools({ toolsMode: "enforce" });
    h.setScript(() => ok(toolBody({ "grant::ghost": 1, "tool::ghost": 1 })));
    expect((await h.launch()).adjustment).toBeUndefined();
  });

  test("Enforce grant the child cannot take", async () => {
    const h = tools({ toolsMode: "enforce", switches: { subagents: true } });
    h.setScript((req) => (isToolRequest(req) ? answer() : ok(body("fast"))));
    const { request } = await h.launch(withWeb);
    h.created(request.agentId);
    h.bound(request.agentId, []);
    h.completed(request.agentId);
    expect(h.lines[0]).toMatchObject({ toolsScored: 8, toolsFlagged: 1, toolsGranted: 0 });
  });

  test("Failed first call not retried", async () => {
    const h = tools({ toolsMode: "enforce" });
    h.setScript(() => ({ kind: "miss", miss: "timeout", reason: "t", ms: 1 }));
    const { adjustment, request } = await h.launch();
    expect(adjustment).toBeUndefined();
    // Resume: the executor sends only outcome events; the policy is not called again.
    h.resumed(request.agentId);
    expect(toolAsks(h)).toHaveLength(1);
  });

  test("Malformed response", async () => {
    const h = tools({ toolsMode: "enforce", switches: { subagents: true } });
    h.setScript((req) => (isToolRequest(req) ? ok({ nope: 1 }) : ok(body("fast"))));
    const { adjustment } = await runToCompletion(h);
    expect(adjustment).toEqual({ model: "fx/fast", thinking: "medium" });
    expect(h.lines[0]).not.toHaveProperty("toolsScored");
  });

  test("a throwing getAllTools still asks with empty metadata", async () => {
    const h = tools({ toolsMode: "enforce" });
    h.setTools(
      new Proxy([], {
        get() {
          throw new Error("boom");
        },
      }) as never,
    );
    h.setScript(() => ok(toolBody({ "tool::edit": 0.9 })));
    expect((await h.launch()).adjustment).toEqual({ removeTools: ["edit"] });
  });
});

describe("Counts handed to the worker line", () => {
  const sixCandidates = {
    toolSet: { defaults: ["read", "bash", "edit", "write"], parentTools: ["web", "codemode"] },
  };
  const answer = (req: JevRequest): JevOutcome =>
    isToolRequest(req)
      ? ok(toolBody({ "tool::edit": 0.9, "grant::web": 0.9, "grant::codemode": 0.95 }))
      : ok(body("fast"));

  test("Counts on the line", async () => {
    const h = tools({ switches: { subagents: true } });
    h.setScript(answer);
    await runToCompletion(h, sixCandidates);
    expect(h.lines[0]).toMatchObject({ toolsScored: 6, toolsFlagged: 1, toolsGranted: 2 });
  });

  test("enforce counts only grants that took effect", async () => {
    const h = tools({ switches: { subagents: true }, toolsMode: "enforce" });
    h.setScript(answer);
    const { request } = await h.launch(sixCandidates);
    h.created(request.agentId);
    h.bound(request.agentId, ["web", "other"]);
    h.completed(request.agentId);
    expect(h.lines[0]).toMatchObject({ toolsScored: 6, toolsFlagged: 1, toolsGranted: 1 });
  });

  test("counts are joined by agent id across concurrent launches", async () => {
    const h = tools({ switches: { subagents: true } });
    h.setScript(answer);
    const a = await h.launch({ ...sixCandidates, agentId: "ag-a" });
    const b = await h.launch({ agentId: "ag-b", toolSet: { defaults: ["read"], parentTools: [] } });
    h.completed(b.request.agentId);
    h.completed(a.request.agentId);
    expect(h.lines.map((l) => l["toolsScored"])).toEqual([1, 6]);
  });

  test("No worker line", async () => {
    const h = tools({ toolsMode: "enforce" });
    h.setScript(() => ok(toolBody({ "tool::edit": 0.9, "grant::web": 0.9 })));
    const { adjustment } = await runToCompletion(h, {
      toolSet: { parentTools: [...DEFAULT_TOOLS, "web"] },
    });
    expect(adjustment).toEqual({ removeTools: ["edit"], addTools: ["web"] });
    expect(h.lines).toHaveLength(0);
  });

  test("Brief not stored", async () => {
    const h = tools({ switches: { subagents: true } });
    const marker = "UNIQUE-TOOL-MARKER-7";
    await runToCompletion(h, { prompt: `go ${marker}`, description: marker });
    expect(h.lines).toHaveLength(1);
    expect(JSON.stringify(h.lines)).not.toContain(marker);
  });
});
