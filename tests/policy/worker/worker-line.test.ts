import { describe, expect, test } from "bun:test";
import type { Answer } from "../../../src/policy/answers.ts";
import type { WorkerAnswers } from "../../../src/policy/worker/answers.ts";
import type { Route } from "../../../src/policy/worker/route.ts";
import { workerLine, type WorkerLineInput } from "../../../src/policy/worker/worker-line.ts";

const tierAnswer: Answer = {
  type: "choice",
  choice: "fast",
  probabilities: { fast: 0.9, balanced: 0.1 },
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
  record: { reason: "cut", tier: "fast", effort: "medium" },
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
  offered: ["fast", "balanced", "deep"],
  tierQuestion: true,
  rubric: 2,
  callerModel: undefined,
  toolCounts: undefined,
  outcome: { status: "completed", durationMs: 1200.6, toolUses: 3, tokens: { total: 11 } },
  ...over,
});

describe("workerLine", () => {
  test("writes every key of a routed, answered launch in ledger order", () => {
    const line = workerLine(
      input({ callerModel: "caller/m", toolCounts: { toolsScored: 4, toolsFlagged: 1 } }),
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

  test("rounds counts and keeps only effort levels in effortP", () => {
    const line = workerLine(input());
    expect(line).toMatchObject({ ms: 7, durationMs: 1201, toolUses: 3, tokens: 11 });
    expect(line?.["effortP"]).toEqual({ low: 0.1, medium: 0.8, high: 0.1 });
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
});
