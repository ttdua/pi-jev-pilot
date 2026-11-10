import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CHILDREN_KEY } from "../../../src/host/platform/child.ts";
import type { Snapshot } from "../../../src/host/platform/readiness.ts";
import { TOOL_COUNTS_KEY, takeToolCounts } from "../../../src/host/tools/counts.ts";
import { createToolAssessment } from "../../../src/host/tools/assessment.ts";
import type { JevOutcome, JevRequest } from "../../../src/jev/client.ts";
import { resolveSettings } from "../../../src/store/settings.ts";
import { tempDir } from "../../helpers.ts";

const SESSION = "child-1";
const FILE = "/tmp/child-1.jsonl";

function snap(): Snapshot {
  const settings = resolveSettings({
    config: {
      classifier: { url: "https://jev.test/ask", model: "m-1", timeoutMs: 1234 },
      tools: { mode: "enforce" },
    } as never,
    state: { switches: { tools: true } } as never,
  });
  return {
    config: { valid: true },
    state: { kind: "ok", issues: [] },
    localMode: { kind: "missing", issues: [] },
    settings,
    keyVar: "PIN_ASSESSMENT_KEY",
    keySet: true,
    tuning: { kind: "missing", issues: [], record: {} },
    untunedTimeoutMs: settings.classifier.timeoutMs,
    executor: true,
  } as Snapshot;
}

const answered: JevOutcome = {
  kind: "ok",
  ms: 1,
  body: { answers: { "tool::edit": { type: "noul", noul: 0.9 } } },
};

function run(opts: { agentDir?: string; allTools?: () => unknown[] } = {}) {
  const log: string[] = [];
  const requests: JevRequest[] = [];
  (globalThis as Record<symbol, Set<string>>)[CHILDREN_KEY]!.add(SESSION);
  const handler = createToolAssessment(
    {
      getAllTools: (() => {
        log.push("getAllTools");
        return (opts.allTools ?? (() => []))();
      }) as never,
    },
    {
      ask: async (req) => {
        log.push("ask");
        requests.push(req);
        return answered;
      },
      snapshot: () => snap(),
      agentDir: opts.agentDir ?? tempDir("jev-req-agentdir-"),
      service: () => ({
        listAgents: () => [
          { id: "ag-1", type: "general-purpose", description: "probe", outputFile: FILE },
        ],
      }),
    },
  );
  const selected = ["read", "edit", "bash"];
  const event = {
    type: "before_agent_start",
    messageType: "user",
    prompt: "CHILD-TASK do it",
    systemPromptOptions: { selectedTools: selected },
  };
  const ctx = {
    cwd: tempDir("jev-req-cwd-"),
    sessionManager: { getSessionId: () => SESSION, getSessionFile: () => FILE },
  };
  return {
    log,
    requests,
    selected,
    go: () => handler.beforeAgentStart(event as never, ctx as never),
  };
}

beforeEach(() => {
  const g = globalThis as Record<symbol, unknown>;
  g[CHILDREN_KEY] = new Set<string>();
  g[TOOL_COUNTS_KEY] = new Map();
});
afterEach(() => {
  const g = globalThis as Record<symbol, unknown>;
  delete g[CHILDREN_KEY];
  delete g[TOOL_COUNTS_KEY];
  delete process.env["PIN_ASSESSMENT_KEY"];
});

describe("tool assessment request", () => {
  test("the request carries url, key, model, timeout, state and questions in this order", async () => {
    process.env["PIN_ASSESSMENT_KEY"] = "secret-key";
    const t = run();
    await t.go();
    const req = t.requests[0]!;
    expect(Object.keys(req)).toEqual(["url", "apiKey", "model", "timeoutMs", "state", "questions"]);
    expect(req.url).toBe("https://jev.test/ask");
    expect(req.apiKey).toBe("secret-key");
    expect(req.model).toBe("m-1");
    expect(req.timeoutMs).toBe(1234);
    expect(Object.keys(req.state as object)).toEqual(["task", "agent", "tools"]);
    expect(Object.keys((req.state as { tools: object }).tools)).toEqual(["read", "edit", "bash"]);
    expect(JSON.stringify(req.questions)).toContain("tool::edit");
    expect(JSON.stringify(req.questions)).toContain("tool::bash");
    expect(JSON.stringify(req.questions)).toContain("tool::read");
  });

  test("a missing key variable yields an empty apiKey", async () => {
    const t = run();
    await t.go();
    expect(t.requests[0]!.apiKey).toBe("");
  });

  test("tool metadata is read before the request is sent, once", async () => {
    const t = run();
    await t.go();
    expect(t.log).toEqual(["getAllTools", "ask"]);
  });

  test("the scored names define state and counts; only flagged ones are removed", async () => {
    const t = run();
    await t.go();
    expect(t.selected).toEqual(["read", "bash"]);
    expect(takeToolCounts("ag-1")).toEqual({ toolsScored: 3, toolsFlagged: 1 });
  });

  test("a throwing getAllTools leaves the request intact and the flow fail-open", async () => {
    const t = run({
      allTools: () => {
        throw new Error("x");
      },
    });
    await t.go();
    expect(t.requests).toHaveLength(1);
    expect(t.log).toEqual(["getAllTools", "ask"]);
  });
});
