import { describe, expect, test } from "bun:test";
import { MainSession } from "../../src/host/main-session.ts";
import { addTurnEnd, type TurnRecord } from "../../src/host/main-record.ts";

const record = (turnId = "t-1"): TurnRecord => ({
  turnId,
  at: 0,
  sessionId: "s",
  mode: "balanced",
  from: "low",
  answered: false,
  ms: 0,
  sawRequest: false,
  toolCalls: 0,
  failures: 0,
  inputTokens: 0,
  outputTokens: 0,
});
const session = () => new MainSession<string, string>();

describe("MainSession: turn lifecycle", () => {
  test("begin makes the record current", () => {
    const s = session();
    const rec = record();
    s.begin(rec, "ctx", "snap");
    expect(s.record).toBe(rec);
  });

  test("drop clears only its own record", () => {
    const s = session();
    const old = record("old");
    const newer = record("new");
    s.begin(old, "ctx", "snap");
    s.begin(newer, "ctx", "snap");
    s.drop(old);
    expect(s.record).toBe(newer);
    s.drop(newer);
    expect(s.record).toBeUndefined();
  });

  test("dropUnapplied keeps a record whose level was applied", () => {
    const s = session();
    const rec = { ...record(), applied: "high" as const };
    s.begin(rec, "ctx", "snap");
    s.dropUnapplied(rec);
    expect(s.record).toBe(rec);
    s.dropUnapplied(undefined);
    expect(s.record).toBe(rec);
  });

  test("dropUnapplied clears a record that applied nothing", () => {
    const s = session();
    const rec = record();
    s.begin(rec, "ctx", "snap");
    s.dropUnapplied(rec);
    expect(s.record).toBeUndefined();
  });

  test("settle hands over the record with its context and clears it", () => {
    const s = session();
    const rec = record();
    s.begin(rec, "ctx", "snap");
    expect(s.settle()).toEqual({ rec, ctx: "ctx" });
    expect(s.record).toBeUndefined();
    expect(s.settle()).toBeUndefined();
  });
});

describe("MainSession: decision and overlay", () => {
  test("decide sets the current decision and marks the record as having drawn", () => {
    const s = session();
    const rec = record();
    s.begin(rec, "ctx", "snap");
    s.decide(rec, { advice: "delegate" });
    expect(s.current).toEqual({ advice: "delegate" });
    expect(s.hasDrawn(rec)).toBe(true);
  });

  test("updateOverlay reports whether the text changed", () => {
    const s = session();
    expect(s.updateOverlay("10 prompts")).toBe(true);
    expect(s.updateOverlay("10 prompts")).toBe(false);
    expect(s.overlay).toBe("10 prompts");
    expect(s.updateOverlay(undefined)).toBe(true);
  });
});

describe("MainSession: abort restore", () => {
  test("restores the decision and overlay from before a turn that drew", () => {
    const s = session();
    s.updateOverlay("before");
    s.decide(record("prev"), { advice: "graph" });
    const rec = record();
    s.begin(rec, "ctx", "snap");
    s.updateOverlay("during");
    s.decide(rec, { effort: { kind: "no-answer" } });
    expect(s.restoreBefore(rec)).toEqual({ ctx: "ctx", snapshot: "snap" });
    expect(s.current).toEqual({ advice: "graph" });
    expect(s.overlay).toBe("before");
  });

  test("keeps the turn in flight until clearTurn, so the redraw sees it", () => {
    const s = session();
    const rec = record();
    s.begin(rec, "ctx", "snap");
    s.decide(rec, { advice: "graph" });
    s.restoreBefore(rec);
    expect(s.record).toBe(rec);
    s.clearTurn();
    expect(s.record).toBeUndefined();
  });

  test("restores nothing for a turn that never drew", () => {
    const s = session();
    const rec = record();
    s.begin(rec, "ctx", "snap");
    s.decide(record("other"), { advice: "graph" });
    expect(s.restoreBefore(rec)).toBeUndefined();
    expect(s.current).toEqual({ advice: "graph" });
  });
});

describe("MainSession: carry and reset", () => {
  test("carry keeps the last answered summary when the next one is undefined", () => {
    const s = session();
    s.carry({ effort: "high" });
    s.carry(undefined);
    expect(s.lastDecided).toEqual({ effort: "high" });
  });

  test("reset forgets every piece of state", () => {
    const s = session();
    s.begin(record(), "ctx", "snap");
    s.decide(record(), { advice: "graph" });
    s.updateOverlay("x");
    s.carry({ effort: "low" });
    s.reset();
    expect([s.record, s.current, s.overlay, s.lastDecided]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("addTurnEnd", () => {
  test("adds tool calls, failures and token usage, and keeps the last stop reason", () => {
    const rec = record();
    addTurnEnd(rec, {
      toolResults: [{ isError: true }, { isError: false }],
      message: { usage: { input: 10, output: 4 }, stopReason: "toolUse" },
    });
    addTurnEnd(rec, { toolResults: [], message: { usage: { input: 1 }, stopReason: "stop" } });
    expect(rec).toMatchObject({
      toolCalls: 2,
      failures: 1,
      inputTokens: 11,
      outputTokens: 4,
      lastStop: "stop",
    });
  });

  test("ignores missing results, non-numeric usage and a non-string stop reason", () => {
    const rec = record();
    addTurnEnd(rec, { message: { usage: { input: "10" }, stopReason: 3 } });
    expect(rec).toMatchObject({ toolCalls: 0, inputTokens: 0 });
    expect(rec).not.toHaveProperty("lastStop");
  });
});
