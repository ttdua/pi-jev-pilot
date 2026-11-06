import { mkdirSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { validateLedgerEntry } from "../../src/store/ledger-schema.ts";
import { base, body, harness, ok } from "./worker-fakes.ts";

const saved = process.env.TYPESAFE_API_KEY;
beforeEach(() => {
  process.env.TYPESAFE_API_KEY = "k";
});
afterEach(() => {
  if (saved === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = saved;
});

type H = ReturnType<typeof harness>;
const done = (id: string, extra: object = {}) => ({
  id,
  type: "general-purpose",
  description: "SECRET-DESC",
  status: "completed",
  toolUses: 3,
  durationMs: 1200,
  tokens: { input: 5, output: 6, total: 11 },
  ...extra,
});

/** message_end + tool_call for one launch; returns the (mutated) input. */
async function launch(h: H, id: string, input: Record<string, unknown> = base()) {
  await h.fire("message_end", h.msg([id, input]));
  await h.fire("tool_call", h.call(id, input));
  return input;
}

async function foreground(h: H, id = "t1", input: Record<string, unknown> = base()) {
  await launch(h, id, input);
  await h.emit("subagents:completed", done(`ag-${id}`));
  await h.fire("tool_result", h.result(id, `ag-${id}`));
}

describe("One line per launch", () => {
  test("Routed launch recorded", async () => {
    const h = harness();
    await foreground(h);
    expect(h.lines).toHaveLength(1);
    expect(h.lines[0]).toMatchObject({ kind: "worker", v: 1, tier: "fast" });
    expect(validateLedgerEntry(h.lines[0]).ok).toBe(true);
  });

  test("Not running means no line", async () => {
    const h = harness({ switches: { subagents: false } });
    await foreground(h);
    expect(h.lines).toHaveLength(0);
  });

  test("Cancelled turn", async () => {
    const h = harness();
    h.setScript(() => ({ kind: "cancelled" }));
    await foreground(h);
    expect(h.lines).toHaveLength(0);
  });

  test("Unknown agent id ignored", async () => {
    const h = harness();
    await h.emit("subagents:completed", done("never-seen"));
    await h.emit("subagents:failed", done("never-seen-2", { status: "error" }));
    expect(h.lines).toHaveLength(0);
  });

  test("Two launches, two lines", async () => {
    const h = harness();
    h.setScript((req) => ok(body((req.state as { task: { brief: string } }).task.brief)));
    const a = { ...base(), prompt: "fast" };
    const b = { ...base(), prompt: "deep" };
    await h.fire("message_end", h.msg(["a", a], ["b", b]));
    await h.fire("tool_call", h.call("a", a));
    await h.fire("tool_call", h.call("b", b));
    await h.fire("tool_result", h.result("a", "ag-a"));
    await h.fire("tool_result", h.result("b", "ag-b"));
    await h.emit("subagents:completed", done("ag-b"));
    await h.emit("subagents:completed", done("ag-a"));
    expect(h.lines).toHaveLength(2);
    expect(h.lines.map((l) => l["tier"]).sort()).toEqual(["deep", "fast"]);
  });

  test("Line written once", async () => {
    const h = harness();
    await foreground(h);
    await h.emit("subagents:completed", done("ag-t1"));
    await h.fire("tool_result", h.result("t1", "ag-t1"));
    expect(h.lines).toHaveLength(1);
  });

  test("Drafts are bounded", async () => {
    const h = harness();
    h.setScript(() => ok(body("fast")));
    for (let i = 0; i < 300; i++) await h.fire("tool_call", h.call(`c${i}`, base()));
    expect(h.routing.pending()).toBe(256); // cache only
    for (let i = 0; i < 300; i++) await h.emit("subagents:completed", done(`x${i}`));
    expect(h.routing.pending()).toBe(256 + 256); // cache + outcomes
  });

  test("Launch drafts awaiting an outcome are bounded", async () => {
    const h = harness();
    h.setScript(() => ok(body("fast")));
    for (let i = 0; i < 300; i++) {
      await h.fire("tool_call", h.call(`c${i}`, base()));
      await h.fire("tool_result", h.result(`c${i}`, `ag-${i}`));
    }
    expect(h.routing.pending()).toBe(256); // byAgent only; cache emptied by each result
  });

  test("off() clears everything", async () => {
    const h = harness();
    await launch(h, "t1");
    await h.emit("subagents:completed", done("other"));
    h.routing.off();
    expect(h.routing.pending()).toBe(0);
    await h.emit("subagents:completed", done("ag-t1"));
    expect(h.lines).toHaveLength(0);
  });
});

describe("Outcome joined from the executor", () => {
  test("Foreground completion", async () => {
    const h = harness();
    await launch(h, "t1");
    await h.emit("subagents:completed", done("ag-t1"));
    expect(h.lines).toHaveLength(0);
    await h.fire("tool_result", h.result("t1", "ag-t1"));
    expect(h.lines).toHaveLength(1);
    expect(h.lines[0]).toMatchObject({
      status: "completed",
      toolUses: 3,
      durationMs: 1200,
      tokens: 11,
    });
  });

  test("Background completion", async () => {
    const h = harness();
    await launch(h, "t1");
    await h.fire("tool_result", h.result("t1", "ag-t1"));
    expect(h.lines).toHaveLength(0);
    await h.emit("subagents:completed", done("ag-t1"));
    expect(h.lines).toHaveLength(1);
    expect(h.lines[0]).toMatchObject({ status: "completed" });
  });

  test("Failed worker", async () => {
    const h = harness();
    await launch(h, "t1");
    await h.fire("tool_result", h.result("t1", "ag-t1"));
    await h.emit("subagents:failed", done("ag-t1", { status: "error" }));
    expect(h.lines[0]).toMatchObject({ status: "error" });
  });

  test("Stale outcome not joined to a resume", async () => {
    const h = harness();
    await launch(h, "t1"); // routed launch A
    await h.fire("tool_result", h.result("t1", "ag"));
    await h.emit("subagents:completed", done("ag", { durationMs: 111, toolUses: 1 }));
    expect(h.lines).toHaveLength(1);
    // Jev outage / cancel: the launch is skipped; its event arrives after its tool_result.
    h.setScript(() => ({ kind: "cancelled" }));
    await launch(h, "t2");
    await h.fire("tool_result", h.result("t2", "ag"));
    await h.emit("subagents:completed", done("ag", { durationMs: 222, toolUses: 2 }));
    expect(h.lines).toHaveLength(1);
    // A resume of the same id gets its own event, not the stale one.
    await h.fire("tool_call", h.call("t3", { ...base(), resume: "ag" }));
    await h.fire("tool_result", h.result("t3", "ag"));
    expect(h.lines).toHaveLength(1);
    const resumed = done("ag", { durationMs: 333, toolUses: 3, tokens: { total: 99 } });
    await h.emit("subagents:resumed", resumed);
    expect(h.lines).toHaveLength(2);
    expect(h.lines[1]).toMatchObject({
      reason: "untouched",
      durationMs: 333,
      toolUses: 3,
      tokens: 99,
    });
  });

  test("Unrouted launch outcome dropped", async () => {
    const h = harness({ switches: { subagents: false } });
    await h.fire("tool_call", h.call("t1", base()));
    await h.emit("subagents:completed", done("ag-t1")); // buffered: nothing waits for it
    expect(h.routing.pending()).toBeGreaterThan(0);
    await h.fire("tool_result", h.result("t1", "ag-t1"));
    expect(h.routing.pending()).toBe(0);
    expect(h.lines).toHaveLength(0);
  });

  test("Refused launch", async () => {
    const h = harness();
    await launch(h, "t1");
    await h.fire("tool_result", h.result("t1"));
    expect(h.lines).toHaveLength(1);
    expect(h.lines[0]).toMatchObject({ status: "error" });
    expect(h.lines[0]).not.toHaveProperty("toolUses");
    expect(h.lines[0]).not.toHaveProperty("durationMs");
  });
});

describe("Decision fields", () => {
  test("Routed fields", async () => {
    const h = harness();
    h.setScript(() => ok(body("balanced", "high")));
    await foreground(h, "t1", { ...base(), model: "fixture/fixture-main" });
    expect(h.lines[0]).toMatchObject({
      v: 1,
      at: 1_700_000_000_000,
      kind: "worker",
      session: "main-1",
      mode: "standard",
      answered: true,
      ms: 1,
      agent: "general-purpose",
      briefChars: 10,
      tier: "balanced",
      reason: "choice",
      model: "fx/balanced",
      effort: "high",
      callerModel: "fixture/fixture-main",
      risky: 0.1,
    });
    expect(h.lines[0]).toHaveProperty("tierP");
    expect(h.lines[0]).toHaveProperty("effortP");
    expect(h.lines[0]).not.toHaveProperty("expertNeeded");
    expect(h.lines[0]).not.toHaveProperty("fallback");
  });

  test("Fallback recorded", async () => {
    const h = harness({ reg: { "fx/fast": {}, "fx/balanced": {}, "fx/deep": { auth: false } } });
    h.setScript(() => ok(body("deep")));
    await foreground(h);
    expect(h.lines[0]).toMatchObject({ tier: "balanced", fallback: "deep" });
  });

  test("Nothing could run recorded", async () => {
    const h = harness({ reg: {} });
    h.setScript(() => ok(body("balanced")));
    await foreground(h);
    expect(h.lines[0]).toMatchObject({ tier: "balanced", reason: "choice", fallback: "balanced" });
    expect(h.lines[0]).not.toHaveProperty("model");
    expect(h.lines[0]).not.toHaveProperty("effort");
  });

  test("Thinking-only recorded", async () => {
    const h = harness({ forkedLaunch: "thinking" });
    h.setScript(() => ok(body("fast", "high")));
    await foreground(h, "t1", { ...base(), inherit_context: true });
    expect(h.lines[0]).toMatchObject({ answered: true, reason: "untouched", effort: "high" });
    expect(h.lines[0]).not.toHaveProperty("tier");
    expect(h.lines[0]).not.toHaveProperty("model");
    expect(h.lines[0]).not.toHaveProperty("tierP");
    expect(h.lines[0]).not.toHaveProperty("expertNeeded");
    expect(h.lines[0]).toHaveProperty("risky");
  });

  test("Miss recorded", async () => {
    const h = harness();
    h.setScript(() => ({ kind: "miss", miss: "timeout", reason: "t", ms: 5 }));
    await foreground(h);
    expect(h.lines[0]).toMatchObject({ answered: false, miss: "timeout", reason: "miss", ms: 5 });
    expect(h.lines[0]).not.toHaveProperty("tier");
    expect(validateLedgerEntry(h.lines[0]).ok).toBe(true);
  });

  test("Untouched recorded", async () => {
    const h = harness();
    const input = { ...base(), resume: "agent-1" };
    await h.fire("tool_call", h.call("t1", input));
    await h.fire("tool_result", h.result("t1", "agent-1"));
    await h.emit("subagents:resumed", done("agent-1"));
    expect(h.asks).toHaveLength(0);
    expect(h.lines).toHaveLength(1);
    expect(h.lines[0]).toMatchObject({ reason: "untouched", answered: false, status: "completed" });
    for (const k of ["tier", "model", "ms", "miss"]) expect(h.lines[0]).not.toHaveProperty(k);
  });

  test("Locked recorded", async () => {
    const h = harness();
    const { cwd } = h.ctx;
    mkdirSync(`${cwd}/.pi/agents`, { recursive: true });
    writeFileSync(`${cwd}/.pi/agents/locker.md`, "---\nmodel: fx/x\nlocked: model\n---\nbody\n");
    h.setScript(() => ok(body("deep")));
    await foreground(h, "t1", { ...base(), subagent_type: "locker" });
    expect(h.lines[0]).toMatchObject({ locked: true, agent: "locker" });
    expect(h.lines[0]).not.toHaveProperty("model");
  });

  test("Not locked", async () => {
    const h = harness();
    await foreground(h);
    expect(h.lines[0]).not.toHaveProperty("locked");
  });

  test("No prompt text", async () => {
    const h = harness();
    const marker = "UNIQUE-MARKER-42";
    await foreground(h, "t1", { ...base(), prompt: `go ${marker}`, description: marker });
    expect(h.lines).toHaveLength(1);
    expect(JSON.stringify(h.lines)).not.toContain(marker);
    expect(JSON.stringify(h.lines)).not.toContain("SECRET-DESC");
    expect(h.lines[0]).toMatchObject({ briefChars: 19 });
  });

  test("Brief length counts code points", async () => {
    const h = harness();
    await foreground(h, "t1", { ...base(), prompt: "a😀b" });
    expect(h.lines[0]).toMatchObject({ briefChars: 3 });
  });
});

describe("Caller model field", () => {
  test("Caller model outside the rule", async () => {
    const h = harness();
    await foreground(h, "t1", { ...base(), model: "a b" });
    expect(h.lines).toHaveLength(1);
    expect(h.lines[0]).not.toHaveProperty("callerModel");
  });

  test("No caller model", async () => {
    const h = harness();
    await foreground(h);
    expect(h.lines[0]).not.toHaveProperty("callerModel");
  });
});

describe("Ledger failures do not affect the launch", () => {
  test("Agent name outside the ledger rule", async () => {
    const h = harness();
    const { cwd } = h.ctx;
    mkdirSync(`${cwd}/.pi/agents`, { recursive: true });
    writeFileSync(`${cwd}/.pi/agents/my agent!.md`, "---\ndescription: x\n---\nbody\n");
    const input = await launch(h, "t1", { ...base(), subagent_type: "my agent!" });
    expect(input).toMatchObject({ model: "fx/fast" });
    await h.emit("subagents:completed", done("ag-t1"));
    await h.fire("tool_result", h.result("t1", "ag-t1"));
    // The real writer drops the invalid line; the fake validates as appendLedger does.
    expect(h.lines).toHaveLength(1);
    expect(validateLedgerEntry(h.lines[0]).ok).toBe(false);
  });

  test("Append throws", async () => {
    const h = harness();
    h.failAppend();
    const input = await launch(h, "t1");
    expect(input).toMatchObject({ model: "fx/fast" });
    await h.emit("subagents:completed", done("ag-t1"));
    await h.fire("tool_result", h.result("t1", "ag-t1"));
    expect(h.lines).toHaveLength(0);
  });
});
