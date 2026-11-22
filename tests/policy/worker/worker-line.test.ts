import { describe, expect, test } from "bun:test";
import type { Answer } from "../../../src/policy/answers.ts";
import type { WorkerAnswers } from "../../../src/policy/worker/answers.ts";
import type { Route } from "../../../src/policy/worker/route.ts";
import { validateLedgerEntry } from "../../../src/store/ledger-schema.ts";
import { workerLine, type WorkerLineInput } from "../../../src/policy/worker/worker-line.ts";

const tierAnswer: Answer = {
  type: "choice",
  choice: "basic",
  probabilities: { basic: 0.9, broad: 0.1 },
};
const effortAnswer: Answer = {
  type: "choice",
  choice: "medium",
  probabilities: { low: 0.1, medium: 0.8, high: 0.1, bogus: 0.5 },
};
const read: WorkerAnswers = {
  kind: "read",
  answers: { tier: tierAnswer, effort: effortAnswer, risky: { type: "noul", noul: 0.2 } },
  unanswered: {},
};
const routed: Route = {
  kind: "routed",
  write: { model: "fx/fast", thinking: "medium" },
  record: { reason: "cut", tier: "basic", effort: "medium" },
};

const input = (over: Partial<WorkerLineInput> = {}): WorkerLineInput => ({
  at: 1000,
  session: "s-1",
  mode: "standard",
  agent: "general-purpose",
  briefChars: 12,
  jev: { kind: "ok", body: {}, ms: 7.4 },
  answers: read,
  route: routed,
  offered: ["basic", "broad", "deep"],
  tierQuestion: true,
  turnsQuestion: false,
  requestedTurns: undefined,
  rubric: 2,
  callerModel: undefined,
  outcome: { status: "completed", durationMs: 1200.6, toolUses: 3, tokens: { total: 11 } },
  ...over,
});

describe("workerLine", () => {
  test("Routed fields: writes every key of a routed, answered launch in ledger order", () => {
    const line = workerLine(
      input({
        callerModel: "caller/m",
        effective: { model: "fx/fast", thinking: "medium" },
      }),
    );
    expect(Object.keys(line ?? {})).toEqual([
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
      "frontierOffered",
      "score",
      "reason",
      "tier",
      "effort",
      "model",
      "callerModel",
      "status",
      "durationMs",
      "toolUses",
      "tokens",
      "effectiveModel",
      "effectiveThinking",
    ]);
  });

  test("rounds counts and keeps only effort levels in effortP", () => {
    const line = workerLine(input());
    expect(line).toMatchObject({ ms: 7, durationMs: 1201, toolUses: 3, tokens: 11 });
    expect(line?.["effortP"]).toEqual({ low: 0.1, medium: 0.8, high: 0.1 });
  });

  test("writes no tool count fields", () => {
    const line = workerLine(input());
    for (const k of ["toolsScored", "toolsFlagged", "toolsGranted"]) {
      expect(line).not.toHaveProperty(k);
    }
  });

  test("returns undefined for a skipped or missing route", () => {
    expect(workerLine(input({ route: { kind: "skip" } }))).toBeUndefined();
    expect(workerLine(input({ route: undefined }))).toBeUndefined();
  });

  test("records an untouched launch with its lock", () => {
    const line = workerLine(input({ route: { kind: "untouched", locked: true } }));
    expect(line).toMatchObject({ reason: "untouched", locked: true });
    expect(line).not.toHaveProperty("tier");
  });

  test("records a miss and leaves answered false", () => {
    const line = workerLine(
      input({
        answers: { kind: "miss", miss: "timeout" },
        jev: { kind: "miss", miss: "timeout", reason: "slow", ms: 30 },
      }),
    );
    expect(line).toMatchObject({ answered: false, miss: "timeout", ms: 30 });
    expect(line).not.toHaveProperty("tierP");
  });

  test("reports error and no executor fields without an outcome", () => {
    const line = workerLine(input({ outcome: undefined }));
    expect(line).toMatchObject({ status: "error" });
    expect(line).not.toHaveProperty("durationMs");
  });

  test("reports error for an unknown executor status", () => {
    expect(workerLine(input({ outcome: { status: "weird" } }))?.["status"]).toBe("error");
  });

  test("keeps the answered flag false when the classifier was cancelled", () => {
    const line = workerLine(input({ jev: { kind: "cancelled" } }));
    expect(line).toMatchObject({ answered: false });
    expect(line).not.toHaveProperty("ms");
  });

  test("drops a negative or non-numeric count", () => {
    const line = workerLine(
      input({ outcome: { status: "completed", durationMs: -1, toolUses: "3" } }),
    );
    expect(line).not.toHaveProperty("durationMs");
    expect(line).not.toHaveProperty("toolUses");
  });

  test("Effective values written", () => {
    const line = workerLine(
      input({
        effective: { model: "fixture/fixture-deep", thinking: "high" },
      }),
    );
    expect(line).toMatchObject({
      effectiveModel: "fixture/fixture-deep",
      effectiveThinking: "high",
    });
  });

  test("no effective fields without a session", () => {
    const line = workerLine(input({ effective: undefined }));
    expect(line).not.toHaveProperty("effectiveModel");
    expect(line).not.toHaveProperty("effectiveThinking");
    const partial = workerLine(input({ effective: { model: "fx/fast" } }));
    expect(partial).toMatchObject({ effectiveModel: "fx/fast" });
    expect(partial).not.toHaveProperty("effectiveThinking");
  });

  describe("turn fields", () => {
    const turnsAnswer: Answer = {
      type: "choice",
      choice: "long",
      probabilities: { short: 0.1, medium: 0.2, long: 0.6, very_long: 0.1, bogus: 0.9 },
    };
    const withTurns = (answers: Record<string, Answer>): WorkerAnswers => ({
      kind: "read",
      answers,
      unanswered: {},
    });
    const valid = (line: Record<string, unknown> | undefined) => {
      expect(validateLedgerEntry(line).ok).toBe(true);
    };

    test("Raised limit recorded", () => {
      const line = workerLine(
        input({
          turnsQuestion: true,
          requestedTurns: 20,
          answers: withTurns({ tier: tierAnswer, effort: effortAnswer, turns: turnsAnswer }),
          route: {
            kind: "routed",
            write: { model: "fx/fast", thinking: "medium", maxTurns: 100 },
            record: { reason: "cut", tier: "basic", effort: "medium", turnFloor: 100 },
          },
        }),
      );
      expect(line).toMatchObject({
        requestedTurns: 20,
        turnsP: { short: 0.1, medium: 0.2, long: 0.6, very_long: 0.1 },
        turnFloor: 100,
        tier: "basic",
      });
      const keys = Object.keys(line ?? {});
      expect(keys.slice(keys.indexOf("effort"))).toEqual(
        expect.arrayContaining(["requestedTurns", "turnsP", "turnFloor", "model"]),
      );
      expect(keys.indexOf("requestedTurns")).toBeLessThan(keys.indexOf("turnsP"));
      expect(keys.indexOf("turnsP")).toBeLessThan(keys.indexOf("turnFloor"));
      expect(keys.indexOf("turnFloor")).toBeLessThan(keys.indexOf("model"));
      valid(line);
    });

    test("Asked but not raised", () => {
      const line = workerLine(
        input({
          turnsQuestion: true,
          requestedTurns: 120,
          answers: withTurns({ tier: tierAnswer, turns: turnsAnswer }),
        }),
      );
      expect(line).toMatchObject({ requestedTurns: 120 });
      expect(line).toHaveProperty("turnsP");
      expect(line).not.toHaveProperty("turnFloor");
      valid(line);
    });

    test("Unlimited launch", () => {
      const line = workerLine(input());
      for (const k of ["requestedTurns", "turnsP", "turnFloor"]) {
        expect(line).not.toHaveProperty(k);
      }
      valid(line);
    });

    test("Turns-only recorded", () => {
      const line = workerLine(
        input({
          turnsQuestion: true,
          requestedTurns: 20,
          answers: withTurns({ turns: { ...turnsAnswer, choice: "very_long" } }),
          route: {
            kind: "routed",
            write: { maxTurns: 200 },
            record: { reason: "untouched", turnFloor: 200, locked: true },
          },
          tierQuestion: false,
        }),
      );
      expect(line).toMatchObject({
        reason: "untouched",
        answered: true,
        locked: true,
        requestedTurns: 20,
        turnFloor: 200,
      });
      for (const k of ["tier", "model", "effort", "score", "rubric"]) {
        expect(line).not.toHaveProperty(k);
      }
      valid(line);
    });

    test("Turn miss recorded", () => {
      const line = workerLine(
        input({
          turnsQuestion: true,
          requestedTurns: 20,
          answers: { kind: "miss", miss: "timeout" },
          jev: { kind: "miss", miss: "timeout", ms: 30 },
          route: { kind: "routed", write: {}, record: { reason: "miss" } },
        }),
      );
      expect(line).toMatchObject({ requestedTurns: 20, answered: false, miss: "timeout" });
      expect(line).not.toHaveProperty("turnsP");
      expect(line).not.toHaveProperty("turnFloor");
      valid(line);
    });

    test("Untouched recorded", () => {
      const line = workerLine(input({ route: { kind: "untouched", locked: true } }));
      expect(line).toMatchObject({ reason: "untouched", locked: true });
      expect(line).not.toHaveProperty("requestedTurns");
      valid(line);
    });
  });
});
