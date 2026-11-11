import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { validateLedgerEntry } from "../../src/store/ledger-schema.ts";
import {
  body,
  effort,
  harness,
  isToolRequest,
  ok,
  runToCompletion,
  TIERS_X,
  toolBody,
  type LaunchOver,
} from "./worker-fakes.ts";

const saved = process.env.TYPESAFE_API_KEY;
beforeEach(() => {
  process.env.TYPESAFE_API_KEY = "k";
});
afterEach(() => {
  if (saved === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = saved;
});

type H = ReturnType<typeof harness>;

/** One launch through the policy, its session created and its run completed. */
async function foreground(h: H, over: LaunchOver = {}) {
  return runToCompletion(h, over);
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

  test("Resume writes no line", async () => {
    const h = harness();
    const { request } = await foreground(h);
    expect(h.lines).toHaveLength(1);
    // A resume never reaches the policy; its run ends on `subagents:resumed`.
    h.resumed(request.agentId);
    h.completed(request.agentId);
    expect(h.lines).toHaveLength(1);
  });

  test("Unknown agent id ignored", async () => {
    const h = harness();
    h.completed("never-seen");
    h.failed("never-seen-2");
    expect(h.lines).toHaveLength(0);
  });

  test("Line written once", async () => {
    const h = harness();
    const { request } = await foreground(h);
    h.completed(request.agentId);
    h.failed(request.agentId);
    expect(h.lines).toHaveLength(1);
  });

  test("Launches awaiting an outcome are bounded", async () => {
    const h = harness();
    for (let i = 0; i < 300; i++) await h.launch({ agentId: `ag-${i}` });
    expect(h.routing.pending()).toBe(256);
    h.completed("ag-0");
    expect(h.lines).toHaveLength(0);
    h.completed("ag-299");
    expect(h.lines).toHaveLength(1);
  });

  test("off() clears everything", async () => {
    const h = harness();
    const { request } = await h.launch();
    h.routing.off();
    expect(h.routing.pending()).toBe(0);
    h.completed(request.agentId);
    expect(h.lines).toHaveLength(0);
  });
});

describe("Outcome joined from the executor", () => {
  test("Foreground completion", async () => {
    const h = harness();
    await foreground(h);
    expect(h.lines[0]).toMatchObject({
      status: "completed",
      toolUses: 3,
      durationMs: 1200,
      tokens: 11,
    });
  });

  test("Background completion", async () => {
    const h = harness();
    const { request } = await h.launch({ isBackground: true });
    h.created(request.agentId);
    expect(h.lines).toHaveLength(0);
    h.completed(request.agentId);
    expect(h.lines[0]).toMatchObject({ status: "completed" });
  });

  test("Failed worker", async () => {
    const h = harness();
    const { request } = await h.launch();
    h.created(request.agentId);
    h.failed(request.agentId);
    expect(h.lines[0]).toMatchObject({ status: "error" });
  });

  test("Refused launch", async () => {
    const h = harness();
    // Session creation failed after the policy ran: no session-created, then failed.
    const { request } = await h.launch();
    h.failed(request.agentId, { toolUses: 0, durationMs: 5 });
    expect(h.lines).toHaveLength(1);
    expect(h.lines[0]).toMatchObject({ status: "error" });
    expect(h.lines[0]).not.toHaveProperty("effectiveModel");
    // A launch refused before its policy call never reached routing: no line.
    h.failed("ag-refused-early");
    expect(h.lines).toHaveLength(1);
  });

  test("Effective values joined", async () => {
    const h = harness();
    const { request } = await h.launch();
    h.created(request.agentId, {
      effectiveModel: "fixture/fixture-deep",
      effectiveThinking: "high",
    });
    h.completed(request.agentId);
    expect(h.lines[0]).toMatchObject({
      effectiveModel: "fixture/fixture-deep",
      effectiveThinking: "high",
    });
    expect(validateLedgerEntry(h.lines[0]).ok).toBe(true);
  });

  test("Concurrent workers joined correctly", async () => {
    const h = harness();
    h.setScript((req) => ok(body((req.state as { task: { brief: string } }).task.brief)));
    const a = await h.launch({ prompt: "fast", agent: { name: "alpha", source: "project" } });
    const b = await h.launch({ prompt: "deep", agent: { name: "beta", source: "project" } });
    h.created(a.request.agentId, { effectiveModel: "fx/fast" });
    h.created(b.request.agentId, { effectiveModel: "fx/deep" });
    h.completed(b.request.agentId, { toolUses: 9 });
    h.completed(a.request.agentId, { toolUses: 1 });
    expect(h.lines.map((l) => [l["agent"], l["tier"], l["toolUses"], l["effectiveModel"]])).toEqual(
      [
        ["beta", "deep", 9, "fx/deep"],
        ["alpha", "fast", 1, "fx/fast"],
      ],
    );
  });

  test("Service launch recorded", async () => {
    const h = harness();
    await foreground(h, { origin: { kind: "service" } });
    expect(h.lines).toHaveLength(1);
    expect(h.lines[0]).toMatchObject({ status: "completed", tier: "fast" });
  });
});

describe("Decision fields", () => {
  test("Routed fields", async () => {
    const h = harness();
    h.setScript(() => ok(body("balanced", "high")));
    await foreground(h, { requested: { model: "fixture/fixture-main" } });
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
      reason: "cut",
      score: 1.25,
      rubric: 2,
      expertOffered: false,
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

  test("Expert offered recorded", async () => {
    const h = harness({ tiers: TIERS_X });
    await foreground(h);
    expect(h.lines[0]).toMatchObject({ expertOffered: true, rubric: 2 });
  });

  test("Expert switched off recorded", async () => {
    const h = harness({ tiers: TIERS_X, switches: { expert: false } });
    await foreground(h);
    expect(h.lines[0]).toMatchObject({ expertOffered: false, rubric: 2 });
  });

  test("Tier asked, nothing decided", async () => {
    const h = harness({ tiers: TIERS_X });
    h.setScript(() =>
      ok({ answers: { effort: effort("medium"), risky: { type: "noul", noul: 0.1 } } }),
    );
    await foreground(h);
    expect(h.lines[0]).toMatchObject({ reason: "untouched", rubric: 2, expertOffered: true });
    expect(h.lines[0]).not.toHaveProperty("tier");
    expect(h.lines[0]).not.toHaveProperty("score");
  });

  test("No expert needed field", async () => {
    const h = harness({ tiers: TIERS_X });
    h.setScript(() =>
      ok({
        ...body("deep"),
        answers: { ...body("deep").answers, expert_needed: { type: "noul", noul: 0.4 } },
      }),
    );
    await foreground(h);
    expect(h.lines[0]).not.toHaveProperty("expertNeeded");
  });

  test("Fallback recorded", async () => {
    const h = harness({ reg: { "fx/fast": {}, "fx/balanced": {}, "fx/deep": { auth: false } } });
    h.setScript(() => ok(body("deep")));
    await foreground(h);
    expect(h.lines[0]).toMatchObject({ tier: "balanced", fallback: "deep" });
  });

  test("Nothing could run recorded", async () => {
    const h = harness({ reg: {} });
    h.setScript(() => ok(body("balanced", "high")));
    await foreground(h);
    expect(h.lines[0]).toMatchObject({ tier: "balanced", reason: "cut", fallback: "balanced" });
    expect(h.lines[0]).not.toHaveProperty("model");
    expect(h.lines[0]).not.toHaveProperty("effort");
  });

  test("Thinking-only recorded", async () => {
    const h = harness({ forkedLaunch: "thinking" });
    h.setScript(() => ok(body("fast", "high")));
    await foreground(h, { inheritContext: true });
    expect(h.lines[0]).toMatchObject({ answered: true, reason: "untouched", effort: "high" });
    expect(h.lines[0]).not.toHaveProperty("tier");
    expect(h.lines[0]).not.toHaveProperty("model");
    expect(h.lines[0]).not.toHaveProperty("tierP");
    expect(h.lines[0]).not.toHaveProperty("expertNeeded");
    expect(h.lines[0]).toHaveProperty("risky");
    expect(h.lines[0]).not.toHaveProperty("score");
    expect(h.lines[0]).not.toHaveProperty("rubric");
  });

  test("Miss recorded", async () => {
    const h = harness();
    h.setScript(() => ({ kind: "miss", miss: "timeout", reason: "t", ms: 5 }));
    await foreground(h);
    expect(h.lines[0]).toMatchObject({ answered: false, miss: "timeout", reason: "miss", ms: 5 });
    expect(h.lines[0]).toMatchObject({ rubric: 2, expertOffered: false });
    expect(h.lines[0]).not.toHaveProperty("tier");
    expect(h.lines[0]).not.toHaveProperty("score");
    expect(validateLedgerEntry(h.lines[0]).ok).toBe(true);
  });

  test("Untouched recorded", async () => {
    const h = harness();
    await foreground(h, {
      agent: { model: "fx/x", thinking: "high", locked: ["model", "thinking"] },
      locked: ["model", "thinking"],
    });
    expect(h.asks).toHaveLength(0);
    expect(h.lines).toHaveLength(1);
    expect(h.lines[0]).toMatchObject({
      reason: "untouched",
      answered: false,
      status: "completed",
      locked: true,
    });
    for (const k of ["tier", "model", "ms", "miss", "score", "rubric"])
      expect(h.lines[0]).not.toHaveProperty(k);
  });

  test("Locked recorded", async () => {
    const h = harness();
    h.setScript(() => ok(body("deep")));
    await foreground(h, {
      agent: { name: "locker", source: "project", model: "fx/x", locked: ["model"] },
      locked: ["model"],
    });
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
    await foreground(h, { prompt: `go ${marker}`, description: marker });
    expect(h.lines).toHaveLength(1);
    expect(JSON.stringify(h.lines)).not.toContain(marker);
    expect(JSON.stringify(h.lines)).not.toContain("SECRET-DESC");
    expect(h.lines[0]).toMatchObject({ briefChars: 19 });
  });

  test("Brief length counts code points", async () => {
    const h = harness();
    await foreground(h, { prompt: "a😀b" });
    expect(h.lines[0]).toMatchObject({ briefChars: 3 });
  });
});

describe("Caller model field", () => {
  test("Caller model outside the rule", async () => {
    const h = harness();
    await foreground(h, { requested: { model: "a b" } });
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
    const { adjustment } = await foreground(h, { agent: { name: "my agent!", source: "project" } });
    expect(adjustment).toMatchObject({ model: "fx/fast" });
    // The real writer drops the invalid line; the fake validates as appendLedger does.
    expect(h.lines).toHaveLength(1);
    expect(validateLedgerEntry(h.lines[0]).ok).toBe(false);
  });

  test("Append throws", async () => {
    const h = harness();
    h.failAppend();
    const { adjustment } = await foreground(h);
    expect(adjustment).toMatchObject({ model: "fx/fast" });
    expect(h.lines).toHaveLength(0);
  });
});

describe("Mode recorded", () => {
  test("Classified in budget", async () => {
    const h = harness({ mode: "budget" });
    await foreground(h);
    expect(h.lines[0]).toMatchObject({ mode: "budget" });
  });
});

describe("Tool counts on the worker line", () => {
  const assessed = { switches: { tools: true } };
  const answer = (req: Parameters<Parameters<H["setScript"]>[0]>[0]) =>
    isToolRequest(req)
      ? ok(toolBody({ "tool::edit": 0.9, "grant::web": 0.9, "grant::codemode": 0.9 }))
      : ok(body("fast"));
  const six = {
    toolSet: { defaults: ["read", "bash", "edit", "write"], parentTools: ["web", "codemode"] },
  };

  test("Tool counts recorded", async () => {
    const h = harness(assessed);
    h.setScript(answer);
    await foreground(h, six);
    expect(h.lines[0]).toMatchObject({ toolsScored: 6, toolsFlagged: 1, toolsGranted: 2 });
    expect(validateLedgerEntry(h.lines[0]).ok).toBe(true);
  });

  test("No assessment, no counts", async () => {
    for (const o of [{}, assessed]) {
      const h = harness(o);
      if (o === assessed) {
        h.setScript((req) =>
          isToolRequest(req)
            ? { kind: "miss", miss: "error", reason: "x", ms: 1 }
            : ok(body("fast")),
        );
      }
      await foreground(h, o === assessed ? six : { toolSet: { defaults: [], parentTools: [] } });
      for (const k of ["toolsScored", "toolsFlagged", "toolsGranted"]) {
        expect(h.lines[0]).not.toHaveProperty(k);
      }
    }
  });

  test("Resumed launch carries no counts", async () => {
    const h = harness(assessed);
    h.setScript(answer);
    const { request } = await foreground(h, six);
    h.resumed(request.agentId);
    expect(h.lines).toHaveLength(1);
  });
});

describe("Slot lines", () => {
  const slots = [{ name: "reviewer", model: "fx/review", when: "Code review." }];
  const answer = ok({
    answers: {
      tier: {
        type: "choice",
        choice: "slot::reviewer",
        confidence: 0.9,
        probabilities: { fast: 0, balanced: 0, deep: 0, "slot::reviewer": 0.9 },
      },
      effort: effort("high"),
      risky: { type: "noul", noul: 0.1 },
    },
  });

  test("Slot decision recorded", async () => {
    const h = harness({
      slots,
      reg: { "fx/fast": {}, "fx/balanced": {}, "fx/deep": {}, "fx/review": {} },
    });
    h.setScript(() => answer);
    await foreground(h);
    expect(h.lines[0]).toMatchObject({ tier: "slot::reviewer", model: "fx/review" });
    expect(validateLedgerEntry(h.lines[0]).ok).toBe(true);
  });

  test("Slot fallback recorded", async () => {
    const h = harness({
      slots,
      reg: { "fx/fast": {}, "fx/balanced": {}, "fx/deep": {}, "fx/review": { auth: false } },
    });
    h.setScript(() => answer);
    await foreground(h);
    expect(h.lines[0]).toMatchObject({ tier: "balanced", fallback: "slot::reviewer" });
    expect(validateLedgerEntry(h.lines[0]).ok).toBe(true);
  });
});
