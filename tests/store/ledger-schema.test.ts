import { describe, expect, test } from "bun:test";
import {
  LEDGER_FIELDS,
  LEDGER_MAX_LINE_BYTES,
  validateLedgerEntry,
} from "../../src/store/ledger-schema.ts";

type Obj = Record<string, unknown>;

function base(kind: string): Obj {
  const common = { v: 1, at: 1762400000000, kind, session: "s-1" };
  if (kind === "main")
    return { ...common, mode: "standard", answered: true, turnId: "t-1", outcome: "ok" };
  if (kind === "worker")
    return {
      ...common,
      mode: "standard",
      answered: true,
      agent: "worker",
      briefChars: 812,
      reason: "untouched",
      status: "completed",
    };
  return { ...common, turnId: "t-1", corrects: 0.82 };
}

function issues(value: unknown, opts?: { maxLineBytes?: number }) {
  const r = validateLedgerEntry(value, opts);
  return r.ok ? [] : r.issues;
}

function paths(value: unknown): string[] {
  return issues(value).map((i) => i.path);
}

describe("ledger schema", () => {
  test("valid main line accepted", () => {
    const entry = {
      ...base("main"),
      effortP: { low: 0.1, high: 0.9 },
      requested: "high",
      effective: "high",
    };
    expect(validateLedgerEntry(entry).ok).toBe(true);
  });

  test("valid worker line accepted", () => {
    const entry = {
      ...base("worker"),
      tier: "slot::reviewer",
      model: "anthropic/claude-sonnet-4-6",
      reason: "slot",
      status: "completed",
      briefChars: 812,
    };
    const r = validateLedgerEntry(entry);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.line).toBe(`${JSON.stringify(r.entry)}\n`);
  });

  test("Expert admitted accepted", () => {
    const entry = { ...base("worker"), reason: "expert-admitted", tier: "expert" };
    expect(validateLedgerEntry(entry).ok).toBe(true);
  });

  test("score above 3.5 rejected", () => {
    expect(paths({ ...base("worker"), score: 3.6 })).toEqual(["score"]);
    expect(validateLedgerEntry({ ...base("worker"), score: 3.5 }).ok).toBe(true);
  });

  test("fractional rubric rejected", () => {
    expect(paths({ ...base("worker"), rubric: 2.5 })).toEqual(["rubric"]);
    expect(paths({ ...base("worker"), rubric: 0 })).toEqual(["rubric"]);
    expect(paths({ ...base("worker"), rubric: 100 })).toEqual(["rubric"]);
  });

  test("cut-point line and older choice line accepted", () => {
    const cut = {
      ...base("worker"),
      reason: "cut",
      tier: "fast",
      score: 1.5,
      rubric: 1,
      expertOffered: false,
    };
    expect(validateLedgerEntry(cut).ok).toBe(true);
    const old = { ...base("worker"), reason: "choice", tier: "fast", expertNeeded: 0.4 };
    expect(validateLedgerEntry(old).ok).toBe(true);
  });

  test("cut and choice without a tier rejected", () => {
    expect(paths({ ...base("worker"), reason: "cut" })).toEqual(["tier"]);
    expect(paths({ ...base("worker"), reason: "choice" })).toEqual(["tier"]);
  });

  test("expert and expert-admitted with a tier accepted", () => {
    for (const reason of ["expert", "expert-admitted"])
      expect(validateLedgerEntry({ ...base("worker"), reason, tier: "expert" }).ok).toBe(true);
  });

  test("Old reason name rejected", () => {
    expect(paths({ ...base("worker"), reason: "fable", tier: "expert" })).toEqual(["reason"]);
  });

  test("valid correction line accepted", () => {
    expect(validateLedgerEntry({ ...base("correction"), corrects: 0.82 }).ok).toBe(true);
  });

  test("unknown kind rejected", () => {
    expect(paths({ ...base("main"), kind: "tool" })).toEqual(["kind"]);
    expect(paths({ ...base("main"), kind: 3 })).toEqual(["kind"]);
  });

  test("field from another kind rejected", () => {
    expect(issues({ ...base("correction"), agent: "x" })).toEqual([
      { path: "agent", message: "unknown key" },
    ]);
  });

  test("missing required field rejected", () => {
    const entry = base("main");
    delete entry["outcome"];
    expect(paths(entry)).toContain("outcome");
  });

  test("exported field sets match the table", () => {
    const common = ["at", "kind", "session", "v"];
    const measured = ["answered", "durationMs", "effortP", "miss", "mode", "ms", "risky"];
    expect([...LEDGER_FIELDS.main].sort()).toEqual(
      [
        ...common,
        ...measured,
        "advised",
        "effective",
        "failures",
        "from",
        "gate",
        "held",
        "inputTokens",
        "corrects",
        "outcome",
        "outputTokens",
        "requested",
        "skill",
        "skillP",
        "strategy",
        "strategyP",
        "toolCalls",
        "turnId",
      ].sort(),
    );
    expect([...LEDGER_FIELDS.worker].sort()).toEqual(
      [
        ...common,
        ...measured,
        "agent",
        "briefChars",
        "callerModel",
        "effort",
        "expertNeeded",
        "expertOffered",
        "fallback",
        "locked",
        "model",
        "reason",
        "rubric",
        "score",
        "status",
        "tier",
        "tierP",
        "tokens",
        "toolUses",
        "toolsFlagged",
        "toolsScored",
        "toolsGranted",
        "effectiveModel",
        "effectiveThinking",
      ].sort(),
    );
    expect([...LEDGER_FIELDS.correction].sort()).toEqual([...common, "corrects", "turnId"].sort());
  });

  test("Worker line with effective launch fields accepted", () => {
    const entry = {
      ...base("worker"),
      effectiveModel: "fixture/fixture-fast",
      effectiveThinking: "medium",
      toolsScored: 6,
      toolsFlagged: 1,
      toolsGranted: 2,
    };
    expect(issues(entry)).toEqual([]);
  });

  test("Bad effective thinking rejected", () => {
    expect(paths({ ...base("worker"), effectiveThinking: "huge" })).toEqual(["effectiveThinking"]);
  });

  test("Bad effective model and granted count rejected", () => {
    expect(paths({ ...base("worker"), effectiveModel: "no-provider" })).toEqual(["effectiveModel"]);
    expect(paths({ ...base("worker"), toolsGranted: -1 })).toEqual(["toolsGranted"]);
  });

  test("Effective fields rejected on a main line", () => {
    expect(paths({ ...base("main"), effectiveModel: "fixture/fixture-fast" })).toEqual([
      "effectiveModel",
    ]);
  });

  test("unknown agent value is still an identifier", () => {
    expect(validateLedgerEntry({ ...base("worker"), agent: "unknown" }).ok).toBe(true);
  });

  test("deciding worker without a tier rejected", () => {
    expect(paths({ ...base("worker"), reason: "choice" })).toEqual(["tier"]);
  });

  test("untouched worker without a tier accepted", () => {
    expect(validateLedgerEntry({ ...base("worker"), reason: "untouched" }).ok).toBe(true);
  });

  test("miss with an answer rejected", () => {
    expect(paths({ ...base("main"), answered: true, miss: "timeout" })).toEqual(["miss"]);
    expect(validateLedgerEntry({ ...base("main"), answered: false, miss: "timeout" }).ok).toBe(
      true,
    );
  });

  test("long text field rejected", () => {
    const sentence = "this is a long sentence with spaces ".repeat(9).slice(0, 300);
    const r = issues({ ...base("worker"), agent: sentence });
    expect(r.map((i) => i.path)).toEqual(["agent"]);
    expect(JSON.stringify(r)).not.toContain(sentence);
    expect(JSON.stringify(r)).not.toContain("long sentence");
  });

  test("prompt field rejected", () => {
    expect(issues({ ...base("main"), prompt: "hello" })).toEqual([
      { path: "prompt", message: "unknown key" },
    ]);
  });

  test("probability out of range rejected", () => {
    expect(paths({ ...base("main"), effortP: { high: 1.2 } })).toEqual(["effortP.high"]);
  });

  test("NaN probability rejected", () => {
    expect(paths({ ...base("main"), risky: Number.NaN })).toEqual(["risky"]);
  });

  test("target distribution capped at 12", () => {
    const tierP: Obj = {};
    for (let i = 0; i < 13; i++) tierP[`slot::s${i}`] = 0.01;
    expect(paths({ ...base("worker"), tierP })).toContain("tierP");
  });

  test("slot target accepted", () => {
    const entry = {
      ...base("worker"),
      tier: "slot::reviewer",
      tierP: { balanced: 0.3, "slot::reviewer": 0.7 },
    };
    expect(validateLedgerEntry(entry).ok).toBe(true);
  });

  test("malformed target rejected", () => {
    expect(paths({ ...base("worker"), fallback: "slot::Code Reviewer" })).toEqual(["fallback"]);
  });

  test("widest valid entry fits", () => {
    const id = "a".repeat(64);
    const p = 0.1234567890123456;
    const count = 1000000000;
    const at = 8640000000000000;
    const effortP = { low: p, medium: p, high: p, xhigh: p, max: p };
    const main = {
      v: 1,
      at,
      kind: "main",
      session: id,
      mode: "premium",
      answered: false,
      ms: count,
      miss: "schema",
      effortP,
      risky: p,
      durationMs: count,
      turnId: id,
      requested: "xhigh",
      effective: "xhigh",
      from: "minimal",
      held: false,
      advised: false,
      strategy: "parallel",
      strategyP: p,
      skillP: p,
      gate: p,
      corrects: p,
      skill: "a".repeat(64),
      toolCalls: count,
      failures: count,
      inputTokens: count,
      outputTokens: count,
      outcome: "aborted",
    };
    const tierP: Obj = {};
    for (let i = 0; i < 12; i++) tierP[`slot::${String.fromCharCode(97 + i)}${"b".repeat(23)}`] = p;
    const worker = {
      v: 1,
      at,
      kind: "worker",
      session: id,
      mode: "premium",
      answered: false,
      ms: count,
      miss: "schema",
      effortP,
      risky: p,
      durationMs: count,
      agent: id,
      briefChars: count,
      tierP,
      expertNeeded: p,
      tier: `slot::${"c".repeat(24)}`,
      fallback: `slot::${"d".repeat(24)}`,
      model: `a/${"m".repeat(126)}`,
      effort: "xhigh",
      reason: "expert-denied",
      callerModel: "c".repeat(128),
      locked: false,
      toolsScored: count,
      toolsFlagged: count,
      toolsGranted: count,
      effectiveModel: `a/${"e".repeat(126)}`,
      effectiveThinking: "minimal",
      tokens: count,
      toolUses: count,
      status: "completed",
    };
    for (const entry of [main, worker]) {
      const r = validateLedgerEntry(entry);
      expect(r.ok).toBe(true);
      if (r.ok) expect(Buffer.byteLength(r.line)).toBeLessThanOrEqual(LEDGER_MAX_LINE_BYTES);
    }
  });

  test("size guard counts bytes", () => {
    const entry = { ...base("worker"), model: "a/é" };
    const ok = validateLedgerEntry(entry);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(issues(entry, { maxLineBytes: ok.line.length })).toEqual([
      { path: "", message: "line exceeds the size limit" },
    ]);
    expect(validateLedgerEntry(entry, { maxLineBytes: Buffer.byteLength(ok.line) }).ok).toBe(true);
  });

  test("non-object entry rejected", () => {
    for (const v of [null, "x", []]) expect(paths(v)).toEqual([""]);
  });

  test("non-ASCII identifier rejected", () => {
    expect(paths({ ...base("worker"), agent: "wörker" })).toEqual(["agent"]);
  });

  test("__proto__ and constructor keys rejected", () => {
    const withProto = JSON.parse('{"effortP":{"__proto__":0.5}}') as Obj;
    expect(paths({ ...base("main"), ...withProto })).toEqual(["effortP.__proto__"]);
    const withCtor = JSON.parse('{"constructor":1}') as Obj;
    expect(issues({ ...base("main"), ...withCtor })).toEqual([
      { path: "constructor", message: "unknown key" },
    ]);
    expect(({} as Obj)["high"]).toBeUndefined();
  });
});
