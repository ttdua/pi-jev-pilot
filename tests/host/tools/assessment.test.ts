import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHILDREN_KEY } from "../../../src/host/platform/child.ts";
import type { Snapshot } from "../../../src/host/platform/readiness.ts";
import { TOOL_COUNTS_KEY, takeToolCounts } from "../../../src/host/tools/counts.ts";
import {
  MAIN_SERVICE_KEY,
  captureMainService,
  clearMainService,
} from "../../../src/host/tools/service.ts";
import { createToolAssessment } from "../../../src/host/tools/assessment.ts";
import type { JevOutcome, JevRequest } from "../../../src/jev/client.ts";
import { resolveSettings } from "../../../src/store/settings.ts";
import { tempDir } from "../../helpers.ts";

const EXECUTOR_KEY = Symbol.for("@gotgenes/pi-subagents:service");
const SESSION = "child-1";
const FILE = "/tmp/child-1.jsonl";

type Opts = {
  mode?: "observe" | "enforce";
  tools?: boolean;
  valid?: boolean;
  keySet?: boolean;
};

function snap(o: Opts = {}): Snapshot {
  const settings = resolveSettings({
    config: { tools: { mode: o.mode ?? "observe" } } as never,
    state: { switches: { tools: o.tools ?? true } } as never,
  });
  return {
    config: o.valid === false ? { valid: false, issues: [] } : { valid: true },
    state: { kind: "ok", issues: [] },
    localMode: { kind: "missing", issues: [] },
    settings,
    keyVar: "TYPESAFE_API_KEY",
    keySet: o.keySet ?? true,
    tuning: { kind: "missing", issues: [], record: {} },
    untunedTimeoutMs: settings.classifier.timeoutMs,
    executor: true,
  };
}

const answer = (names: Record<string, number>): JevOutcome => ({
  kind: "ok",
  ms: 1,
  body: {
    answers: Object.fromEntries(
      Object.entries(names).map(([n, v]) => [`tool::${n}`, { type: "noul", noul: v }]),
    ),
  },
});

type Record_ = Record<string, unknown>;
const rec = (over: Record_ = {}): Record_ => ({
  id: "ag-1",
  type: "general-purpose",
  description: "probe",
  outputFile: FILE,
  ...over,
});

type Setup = {
  opts?: Opts;
  records?: unknown[] | "throw";
  selected?: unknown;
  event?: Record_;
  file?: string | undefined;
  session?: string;
  child?: boolean;
  replies?: (() => Promise<JevOutcome>)[];
  allTools?: () => unknown[];
  agentDir?: string;
  noService?: boolean;
  snapshots?: Snapshot[];
};

function setup(s: Setup = {}) {
  if (s.child !== false) (globalThis as Record<symbol, Set<string>>)[CHILDREN_KEY]!.add(SESSION);
  const requests: JevRequest[] = [];
  const replies = [...(s.replies ?? [])];
  const ask = async (req: JevRequest): Promise<JevOutcome> => {
    requests.push(req);
    const next = replies.shift();
    return next ? next() : answer({ edit: 0.9 });
  };
  const service = {
    listAgents: () => {
      if (s.records === "throw") throw new Error("boom");
      return s.records ?? [rec()];
    },
  };
  const snaps = [...(s.snapshots ?? [snap(s.opts)])];
  const handler = createToolAssessment(
    {
      getAllTools: (s.allTools ??
        (() => [
          {
            name: "bash",
            description: "Run it",
            sourceInfo: { source: "builtin" },
            parameters: { properties: { command: { description: "Shell command" } } },
          },
        ])) as never,
    },
    {
      ask,
      snapshot: () => (snaps.length > 1 ? snaps.shift()! : snaps[0]!),
      agentDir: s.agentDir ?? tempDir("jev-tools-agentdir-"),
      ...(s.noService === true ? { service: () => undefined } : { service: () => service }),
    },
  );
  const selected = "selected" in s ? s.selected : ["read", "edit", "bash"];
  const event = {
    type: "before_agent_start",
    messageType: "user",
    prompt: "CHILD-TASK do it",
    systemPromptOptions: { selectedTools: selected },
    ...s.event,
  };
  const ctx = {
    cwd: tempDir("jev-tools-cwd-"),
    signal: undefined,
    sessionManager: {
      getSessionId: () => s.session ?? SESSION,
      getSessionFile: () => ("file" in s ? s.file : FILE),
    },
  };
  const run = () => handler.beforeAgentStart(event as never, ctx as never);
  return { run, requests, event, selected: selected as string[], handler, ctx };
}

function agentFile(name: string, fm: string): string {
  const agentDir = tempDir("jev-tools-agentdir-");
  mkdirSync(join(agentDir, "agents"), { recursive: true });
  writeFileSync(join(agentDir, "agents", `${name}.md`), `---\ndescription: d\n${fm}---\nbody\n`);
  return agentDir;
}

beforeEach(() => {
  const g = globalThis as Record<symbol, unknown>;
  g[CHILDREN_KEY] = new Set<string>();
  g[TOOL_COUNTS_KEY] = new Map();
  delete g[MAIN_SERVICE_KEY];
  delete g[EXECUTOR_KEY];
});
afterEach(() => {
  const g = globalThis as Record<symbol, unknown>;
  delete g[CHILDREN_KEY];
  delete g[TOOL_COUNTS_KEY];
  delete g[MAIN_SERVICE_KEY];
  delete g[EXECUTOR_KEY];
});

describe("When assessment runs", () => {
  test("Switch off", async () => {
    const t = setup({ opts: { tools: false } });
    await t.run();
    expect(t.requests).toHaveLength(0);
    expect(t.selected).toEqual(["read", "edit", "bash"]);
  });
  test("No key", async () => {
    const t = setup({ opts: { keySet: false } });
    await t.run();
    expect(t.requests).toHaveLength(0);
  });
  test("Invalid config", async () => {
    const t = setup({ opts: { valid: false, mode: "enforce" } });
    await t.run();
    expect(t.requests).toHaveLength(0);
    expect(t.selected).toEqual(["read", "edit", "bash"]);
  });
  test("Main session", async () => {
    const t = setup({ child: false });
    await t.run();
    expect(t.requests).toHaveLength(0);
  });
  test("Executor absent", async () => {
    const u = setup({ noService: true });
    await u.run();
    expect(u.requests).toHaveLength(0);
  });
  test("Mode read once", async () => {
    const t = setup({ snapshots: [snap({ mode: "observe" }), snap({ mode: "enforce" })] });
    await t.run();
    await t.run();
    expect(t.selected).toEqual(["read", "edit", "bash"]);
    expect(t.requests).toHaveLength(1);
  });
});

describe("Worker finds its launch", () => {
  test("Record found", async () => {
    const t = setup();
    await t.run();
    expect(t.requests).toHaveLength(1);
    const state = t.requests[0]!.state as {
      agent: { name: string };
      task: { description: string; brief: string };
    };
    expect(state.agent.name).toBe("general-purpose");
    expect(state.task.description).toBe("probe");
    expect(state.task.brief).toBe("CHILD-TASK do it");
  });
  test("No record", async () => {
    const t = setup({ records: [rec({ outputFile: "/other" })] });
    await t.run();
    expect(t.requests).toHaveLength(0);
  });
  test("Lookup throws", async () => {
    const t = setup({ records: "throw", opts: { mode: "enforce" } });
    await t.run();
    expect(t.requests).toHaveLength(0);
    expect(t.selected).toEqual(["read", "edit", "bash"]);
  });
  test("Several records match", async () => {
    const t = setup({ records: [rec(), rec({ id: "ag-2" })] });
    await t.run();
    expect(t.requests).toHaveLength(0);
  });
  test("Undefined session file", async () => {
    const t = setup({ file: undefined, records: [rec({ outputFile: undefined })] });
    await t.run();
    expect(t.requests).toHaveLength(0);
  });
});

describe("Captured executor service", () => {
  const real = { implementation: "@ttdua/pi-subagents", listAgents: () => [rec()] };
  function withDefaultService(records: unknown[]) {
    (globalThis as Record<symbol, unknown>)[MAIN_SERVICE_KEY] = {
      implementation: "@ttdua/pi-subagents",
      listAgents: () => records,
    };
  }
  async function runDefault(): Promise<JevRequest[]> {
    (globalThis as Record<symbol, Set<string>>)[CHILDREN_KEY]!.add(SESSION);
    const requests: JevRequest[] = [];
    const h = createToolAssessment(
      { getAllTools: () => [] },
      {
        ask: async (r) => {
          requests.push(r);
          return answer({});
        },
        snapshot: () => snap(),
        agentDir: tempDir("jev-tools-agentdir-"),
      },
    );
    await h.beforeAgentStart(
      {
        messageType: "user",
        prompt: "p",
        systemPromptOptions: { selectedTools: ["read"] },
      } as never,
      {
        cwd: tempDir("jev-tools-cwd-"),
        sessionManager: { getSessionId: () => SESSION, getSessionFile: () => FILE },
      } as never,
    );
    return requests;
  }
  test("Child's own service ignored", async () => {
    (globalThis as Record<symbol, unknown>)[EXECUTOR_KEY] = real;
    captureMainService();
    (globalThis as Record<symbol, unknown>)[EXECUTOR_KEY] = {
      implementation: "@ttdua/pi-subagents",
      listAgents: () => [],
    };
    expect(await runDefault()).toHaveLength(1);
  });
  test("New main session", async () => {
    (globalThis as Record<symbol, unknown>)[EXECUTOR_KEY] = {
      implementation: "@ttdua/pi-subagents",
      listAgents: () => [],
    };
    captureMainService();
    (globalThis as Record<symbol, unknown>)[EXECUTOR_KEY] = real;
    captureMainService();
    expect(await runDefault()).toHaveLength(1);
  });
  test("Main session shut down", async () => {
    withDefaultService([rec()]);
    clearMainService();
    expect(await runDefault()).toHaveLength(0);
  });
});

describe("Only agents that declare no tools", () => {
  test("Declared tools", async () => {
    const t = setup({ records: [rec({ type: "Explore" })] });
    await t.run();
    expect(t.requests).toHaveLength(0);
  });
  test("Agent file without tools", async () => {
    const t = setup({
      records: [rec({ type: "probe-open" })],
      agentDir: agentFile("probe-open", ""),
    });
    await t.run();
    expect(t.requests).toHaveLength(1);
    expect((t.requests[0]!.state as { agent: { name: string } }).agent.name).toBe("probe-open");
  });
  test("Empty tools list", async () => {
    const t = setup({
      records: [rec({ type: "probe-empty" })],
      agentDir: agentFile("probe-empty", "tools: []\n"),
    });
    await t.run();
    expect(t.requests).toHaveLength(0);
  });
});

describe("Candidates", () => {
  test("Protocol tools never candidates", async () => {
    const t = setup({ selected: ["read", "bash", "ask_parent", "notify_parent"] });
    await t.run();
    expect(Object.keys(t.requests[0]!.questions as object)).toEqual(["tool::read", "tool::bash"]);
  });
  // hideReviewInChild runs first in setup, so the handler never sees jev_review (the setup test covers the ordering).
  test("Review tool never a candidate", async () => {
    const t = setup({ selected: ["read", "jev_review"] });
    t.selected.splice(1, 1);
    await t.run();
    expect(Object.keys(t.requests[0]!.questions as object)).toEqual(["tool::read"]);
  });
  test("Cap at 32", async () => {
    const names = Array.from({ length: 40 }, (_, i) => `t${i}`);
    const t = setup({
      opts: { mode: "enforce" },
      selected: [...names],
      replies: [async () => answer(Object.fromEntries(names.map((n) => [n, 0.9])))],
    });
    await t.run();
    expect(Object.keys(t.requests[0]!.questions as object)).toHaveLength(32);
    expect(t.selected).toEqual(names.slice(32));
  });
});

describe("Brief", () => {
  test("Empty prompt", async () => {
    const t = setup({ event: { prompt: "" } });
    await t.run();
    expect(t.requests).toHaveLength(0);
  });
  test("Non-user message type", async () => {
    const t = setup({ event: { messageType: "custom" } });
    await t.run();
    expect(t.requests).toHaveLength(0);
  });
});

describe("The worker waits for the answer", () => {
  for (const mode of ["observe", "enforce"] as const) {
    test(`Slow answer in ${mode}`, async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const t = setup({
        opts: { mode },
        replies: [
          async () => {
            await gate;
            return answer({ edit: 0.9 });
          },
        ],
      });
      let done = false;
      const p = t.run().then(() => (done = true));
      await new Promise((r) => setTimeout(r, 30));
      expect(done).toBe(false);
      expect(t.selected).toEqual(["read", "edit", "bash"]);
      release();
      await p;
      expect(t.selected).toEqual(mode === "enforce" ? ["read", "bash"] : ["read", "edit", "bash"]);
    });
  }
  test("No signal is passed", async () => {
    const t = setup();
    await t.run();
    expect("signal" in t.requests[0]!).toBe(false);
    expect(t.requests[0]!.timeoutMs).toBe(snap().settings.classifier.timeoutMs);
  });
});

describe("Observe and enforce", () => {
  test("Observe keeps tools", async () => {
    const t = setup();
    await t.run();
    expect(t.selected).toEqual(["read", "edit", "bash"]);
  });
  test("Enforce removes", async () => {
    const t = setup({ opts: { mode: "enforce" } });
    await t.run();
    expect(t.selected).toEqual(["read", "bash"]);
  });
  test("Never adds", async () => {
    const t = setup({
      opts: { mode: "enforce" },
      replies: [async () => answer({ ghost: 0.9, edit: 0.1 })],
    });
    await t.run();
    expect(t.selected).toEqual(["read", "edit", "bash"]);
  });
});

describe("Once per worker", () => {
  test("Resumed worker", async () => {
    const t = setup({ opts: { mode: "enforce" } });
    await t.run();
    t.event.systemPromptOptions.selectedTools = ["read", "edit", "bash"];
    await t.run();
    expect(t.requests).toHaveLength(1);
    expect(t.event.systemPromptOptions.selectedTools).toEqual(["read", "bash"]);
  });
  test("Failed first call not retried", async () => {
    const t = setup({
      opts: { mode: "enforce" },
      replies: [async () => ({ kind: "miss", miss: "timeout", reason: "t", ms: 1 })],
    });
    await t.run();
    await t.run();
    expect(t.requests).toHaveLength(1);
    expect(t.selected).toEqual(["read", "edit", "bash"]);
  });
  test("Gate failure at first call is not retried", async () => {
    const t = setup({ snapshots: [snap({ tools: false }), snap({ mode: "enforce" })] });
    await t.run();
    await t.run();
    expect(t.requests).toHaveLength(0);
  });
});

describe("Fail open", () => {
  const cases: [string, () => Promise<JevOutcome>][] = [
    ["Jev down in enforce", async () => ({ kind: "miss", miss: "error", reason: "r", ms: 1 })],
    ["Timeout", async () => ({ kind: "miss", miss: "timeout", reason: "r", ms: 1 })],
    ["Malformed response", async () => ({ kind: "ok", body: {}, ms: 1 })],
    [
      "Ask throws",
      async () => {
        throw new Error("x");
      },
    ],
  ];
  for (const [name, reply] of cases) {
    test(name, async () => {
      const t = setup({ opts: { mode: "enforce" }, replies: [reply] });
      await t.run();
      expect(t.selected).toEqual(["read", "edit", "bash"]);
      expect(takeToolCounts("ag-1")).toBeUndefined();
    });
  }
});

describe("Counts handed to the worker line", () => {
  test("Counts on the line", async () => {
    const t = setup({
      selected: ["a", "b", "c", "d", "e"],
      replies: [async () => answer({ a: 0.9, b: 0.5, c: 0.1, d: 0.2, e: 0.3 })],
    });
    await t.run();
    expect(takeToolCounts("ag-1")).toEqual({ toolsScored: 5, toolsFlagged: 2 });
  });
  test("No worker line", async () => {
    const t = setup({ opts: { mode: "enforce" } });
    await t.run();
    expect(t.selected).toEqual(["read", "bash"]);
    expect(
      (
        (globalThis as Record<symbol, Map<string, unknown>>)[TOOL_COUNTS_KEY] as Map<
          string,
          unknown
        >
      ).size,
    ).toBe(1);
  });
});

describe("Defensive paths", () => {
  test("selectedTools not an array", async () => {
    const t = setup({ selected: undefined });
    await t.run();
    expect(t.requests).toHaveLength(0);
  });
  test("getAllTools throws", async () => {
    const t = setup({
      allTools: () => {
        throw new Error("x");
      },
    });
    await t.run();
    const state = t.requests[0]!.state as {
      tools: Record<string, { description: string; source: string; parameters: object }>;
    };
    expect(state.tools["edit"]).toEqual({ description: "", source: "unknown", parameters: {} });
  });
  test("Tool missing from getAllTools", async () => {
    const t = setup();
    await t.run();
    const state = t.requests[0]!.state as { tools: Record<string, { source: string }> };
    expect(state.tools["bash"]!.source).toBe("builtin");
    expect(state.tools["read"]!.source).toBe("unknown");
  });
});
