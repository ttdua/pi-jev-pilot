import { describe, expect, test } from "bun:test";
import {
  correctionLine,
  decidedAnchor,
  decidedSummary,
  lastAssistantStop,
  mainLine,
} from "../../src/host/main-line.ts";
import type { TurnRecord } from "../../src/host/main-record.ts";

const record = (over: Partial<TurnRecord> = {}): TurnRecord => ({
  turnId: "t-1",
  at: 1000,
  sessionId: "s-1",
  mode: "balanced",
  from: "low",
  answered: false,
  ms: 0,
  sawRequest: true,
  toolCalls: 0,
  failures: 0,
  inputTokens: 0,
  outputTokens: 0,
  ...over,
});

describe("correctionLine", () => {
  test("returns a correction line for the previous turn at the threshold", () => {
    const rec = record({ corrects: 0.7, previousTurnId: "t-0" });
    expect(correctionLine(rec)).toEqual({
      v: 1,
      at: 1000,
      session: "s-1",
      kind: "correction",
      turnId: "t-0",
      corrects: 0.7,
    });
  });

  test("writes its keys in ledger order", () => {
    const line = correctionLine(record({ corrects: 0.9, previousTurnId: "t-0" }));
    expect(Object.keys(line!)).toEqual(["v", "at", "session", "kind", "turnId", "corrects"]);
  });

  test("returns undefined below the threshold", () => {
    expect(correctionLine(record({ corrects: 0.69, previousTurnId: "t-0" }))).toBeUndefined();
  });

  test("returns undefined without a previous turn", () => {
    expect(correctionLine(record({ corrects: 0.9 }))).toBeUndefined();
  });

  test("returns undefined when corrects was not read", () => {
    expect(correctionLine(record({ previousTurnId: "t-0" }))).toBeUndefined();
  });
});

describe("mainLine", () => {
  const facts = { stop: undefined, aborted: false, now: 1500 };

  test("writes the minimal line for an unanswered turn without a miss", () => {
    expect(mainLine(record(), facts)).toEqual({
      v: 1,
      at: 1000,
      session: "s-1",
      kind: "main",
      mode: "balanced",
      answered: false,
      turnId: "t-1",
      from: "low",
      toolCalls: 0,
      failures: 0,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 500,
      outcome: "ok",
    });
  });

  test("writes every key of a full line in ledger order", () => {
    const full = record({
      answered: true,
      held: true,
      ms: 12,
      miss: "schema",
      effortP: { low: 0.8 },
      risky: 0.1,
      corrects: 0.2,
      strategy: "delegate",
      strategyP: 0.6,
      advised: true,
      skill: "tdd",
      skillP: 0.9,
      gate: 0.5,
      requested: "low",
      effective: "low",
    });
    expect(Object.keys(mainLine(full, facts))).toEqual([
      "v",
      "at",
      "session",
      "kind",
      "mode",
      "answered",
      "turnId",
      "held",
      "ms",
      "miss",
      "effortP",
      "risky",
      "corrects",
      "strategy",
      "strategyP",
      "advised",
      "skill",
      "skillP",
      "gate",
      "requested",
      "effective",
      "from",
      "toolCalls",
      "failures",
      "inputTokens",
      "outputTokens",
      "durationMs",
      "outcome",
    ]);
  });

  test("writes only the always-present keys for an unanswered turn", () => {
    expect(Object.keys(mainLine(record(), facts))).toEqual([
      "v",
      "at",
      "session",
      "kind",
      "mode",
      "answered",
      "turnId",
      "from",
      "toolCalls",
      "failures",
      "inputTokens",
      "outputTokens",
      "durationMs",
      "outcome",
    ]);
  });

  test("includes ms and miss for a missed turn", () => {
    const line = mainLine(record({ miss: "timeout", ms: 30 }), facts);
    expect(line).toMatchObject({ ms: 30, miss: "timeout" });
  });

  test("includes every answered field that is set", () => {
    const rec = record({
      answered: true,
      ms: 12,
      held: true,
      effortP: { low: 0.8 },
      risky: 0.1,
      corrects: 0.2,
      strategy: "delegate",
      strategyP: 0.6,
      advised: true,
      skill: "tdd",
      skillP: 0.9,
      gate: 0.5,
      requested: "low",
      effective: "low",
    });
    expect(mainLine(rec, facts)).toMatchObject({
      answered: true,
      held: true,
      ms: 12,
      effortP: { low: 0.8 },
      risky: 0.1,
      corrects: 0.2,
      strategy: "delegate",
      strategyP: 0.6,
      advised: true,
      skill: "tdd",
      skillP: 0.9,
      gate: 0.5,
      requested: "low",
      effective: "low",
    });
  });

  const trio = { strategy: "delegate", strategyP: 0.6, advised: false } as const;
  const strategyKeys = ["strategy", "strategyP", "advised"];
  for (const missing of strategyKeys) {
    test(`omits the whole strategy group when ${missing} is missing`, () => {
      const { [missing as keyof typeof trio]: _dropped, ...partial } = trio;
      const keys = Object.keys(mainLine(record({ answered: true, ...partial }), facts));
      expect(keys.filter((key) => strategyKeys.includes(key))).toEqual([]);
    });
  }

  test("keeps the strategy group when advised is false", () => {
    expect(mainLine(record({ answered: true, ...trio }), facts)).toMatchObject(trio);
  });

  test("reports aborted before the stop reason", () => {
    expect(mainLine(record(), { ...facts, stop: "error", aborted: true }).outcome).toBe("aborted");
  });

  test("reports error when the last stop was an error", () => {
    expect(mainLine(record(), { ...facts, stop: "error" }).outcome).toBe("error");
  });

  test("clamps a negative duration to zero", () => {
    expect(mainLine(record(), { ...facts, now: 900 }).durationMs).toBe(0);
  });
});

describe("decidedAnchor", () => {
  const decided = record({ effective: "high", provider: "p", model: "m", compactionId: "c-1" });

  test("returns the decided level on an unchanged compaction", () => {
    expect(decidedAnchor(decided, "c-1")).toEqual({ provider: "p", model: "m", level: "high" });
  });

  test("returns undefined when the compaction changed", () => {
    expect(decidedAnchor(decided, "c-2")).toBeUndefined();
  });

  test("returns undefined for a held turn", () => {
    expect(decidedAnchor({ ...decided, held: true }, "c-1")).toBeUndefined();
  });

  test("returns undefined without an effective level, provider or model", () => {
    const { effective: _e, ...noLevel } = decided;
    const { provider: _p, ...noProvider } = decided;
    const { model: _m, ...noModel } = decided;
    expect(decidedAnchor(noLevel, "c-1")).toBeUndefined();
    expect(decidedAnchor(noProvider, "c-1")).toBeUndefined();
    expect(decidedAnchor(noModel, "c-1")).toBeUndefined();
  });
});

describe("lastAssistantStop", () => {
  const assistant = (stopReason?: unknown) => ({
    type: "message",
    message: { role: "assistant", ...(stopReason === undefined ? {} : { stopReason }) },
  });

  test("returns the stop reason of the newest assistant message", () => {
    const entries = [assistant("error"), { type: "message", message: { role: "user" } }];
    expect(lastAssistantStop([...entries, assistant("stop")])).toBe("stop");
  });

  test("skips non-message entries", () => {
    expect(lastAssistantStop([assistant("error"), { type: "compaction" }])).toBe("error");
  });

  test("returns undefined when the newest assistant has no string stop reason", () => {
    expect(lastAssistantStop([assistant("stop"), assistant(42)])).toBeUndefined();
  });

  test("returns undefined for an empty branch", () => {
    expect(lastAssistantStop([])).toBeUndefined();
  });
});

describe("decidedSummary", () => {
  test("returns undefined for an unanswered turn", () => {
    expect(decidedSummary(record({ effective: "high" }))).toBeUndefined();
  });

  test("prefers the effective level over the requested one", () => {
    const rec = record({
      answered: true,
      requested: "low",
      effective: "high",
      strategy: "delegate",
    });
    expect(decidedSummary(rec)).toEqual({ effort: "high", strategy: "delegate" });
  });

  test("falls back to the requested level", () => {
    expect(decidedSummary(record({ answered: true, requested: "low" }))).toEqual({
      effort: "low",
    });
  });

  test("returns an empty summary for an answered turn with nothing decided", () => {
    expect(decidedSummary(record({ answered: true }))).toEqual({});
  });
});
