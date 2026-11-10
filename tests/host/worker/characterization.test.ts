import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { putToolCounts, takeToolCounts } from "../../../src/host/tools/counts.ts";
import { tempDir } from "../../helpers.ts";
import { registerWorkerRouting, type WorkerDeps } from "../../../src/host/worker/routing.ts";
import { base, body, harness, ok, snap, type Handler } from "../worker-fakes.ts";

// Pins behaviour of registerWorkerRouting that the split must keep: the worker ledger line's
// key order, dependency methods keeping their receiver, and when tool counts are consumed.

const saved = process.env.TYPESAFE_API_KEY;
beforeEach(() => {
  process.env.TYPESAFE_API_KEY = "k";
});
afterEach(() => {
  if (saved === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = saved;
});

type H = ReturnType<typeof harness>;

const done = (id: string) => ({
  id,
  status: "completed",
  toolUses: 3,
  durationMs: 1200,
  tokens: { input: 5, output: 6, total: 11 },
});

async function foreground(h: H, id: string, input: Record<string, unknown> = base()) {
  await h.fire("message_end", h.msg([id, input]));
  await h.fire("tool_call", h.call(id, input));
  await h.emit("subagents:completed", done(`ag-${id}`));
  await h.fire("tool_result", h.result(id, `ag-${id}`));
}

describe("worker ledger line", () => {
  test("writes every key of a routed, answered launch in ledger order", async () => {
    const h = harness();
    putToolCounts("ag-t1", { toolsScored: 4, toolsFlagged: 1 });

    await foreground(h, "t1", { ...base(), model: "caller/model" });

    expect(Object.keys(h.lines[0] ?? {})).toEqual([
      "v",
      "at",
      "kind",
      "session",
      "mode",
      "answered",
      "agent",
      "briefChars",
      "ms",
      "risky",
      "tierP",
      "effortP",
      "rubric",
      "expertOffered",
      "score",
      "reason",
      "tier",
      "effort",
      "model",
      "callerModel",
      "toolsScored",
      "toolsFlagged",
      "status",
      "durationMs",
      "toolUses",
      "tokens",
    ]);
  });

  test("writes the error status without executor fields when the tool result names no agent", async () => {
    const h = harness();
    const input = base();

    await h.fire("message_end", h.msg(["t1", input]));
    await h.fire("tool_call", h.call("t1", input));
    await h.fire("tool_result", h.result("t1"));

    expect(h.lines[0]).toMatchObject({ status: "error" });
    expect(h.lines[0]).not.toHaveProperty("durationMs");
    expect(h.lines[0]).not.toHaveProperty("toolsScored");
  });
});

describe("tool counts", () => {
  test("a resumed launch leaves the agent's tool counts in place", async () => {
    const h = harness();
    putToolCounts("ag-r1", { toolsScored: 2, toolsFlagged: 0 });
    const input = { ...base(), resume: "ag-r1" };

    await h.fire("tool_call", h.call("r1", input));
    await h.fire("tool_result", h.result("r1", "ag-r1"));
    await h.emit("subagents:resumed", done("ag-r1"));

    expect(takeToolCounts("ag-r1")).toEqual({ toolsScored: 2, toolsFlagged: 0 });
  });
});

/** The deps object itself, with a fresh agent dir so readAgent finds no files. */
function depsWithAgentDir<T extends object>(deps: T): T {
  return Object.assign(deps, { agentDir: tempDir("jev-worker-agents-") });
}

// Today every dependency is called detached from `deps` (`const snapshot = deps.snapshot; snapshot()`).
// A method that needs its receiver therefore fails, and routing fails open. The split keeps this.
describe("dependency methods are called detached from deps", () => {
  test("a snapshot method that reads this fails open: the launch is left as sent", async () => {
    const h = harness();
    const lines: unknown[] = [];
    const deps = {
      marker: "deps",
      ask: () => Promise.resolve(ok(body("fast"))),
      append: (entry: unknown) => void lines.push(entry),
      snapshot(this: { marker?: string }) {
        if (this?.marker !== "deps") throw new Error("lost receiver");
        return snap();
      },
    };
    const handlers = new Map<string, Handler>();
    const pi = {
      on: (name: string, handler: Handler) => (handlers.set(name, handler), () => {}),
      events: { on: () => () => {} },
    };
    registerWorkerRouting(pi as never, depsWithAgentDir(deps) as unknown as WorkerDeps);
    const input = base();
    const fire = (name: string, event: unknown) => handlers.get(name)?.(event, h.ctx);

    await fire("message_end", h.msg(["t1", input]));
    await fire("tool_call", h.call("t1", input));
    await fire("tool_result", h.result("t1"));

    expect(input).not.toHaveProperty("model");
    expect(lines).toHaveLength(0);
  });
});
