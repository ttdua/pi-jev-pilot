import { CORRECTION_THRESHOLD, type ThinkingLevel } from "../effort.ts";
import type { TurnRecord } from "./record.ts";

/** What a settled run adds to the record when its `main` line is written. */
export type SettleFacts = {
  /** Stop reason of the last assistant message, from `turn_end` or the branch. */
  stop: string | undefined;
  aborted: boolean;
  now: number;
};

type LineBase = { v: 1; at: number; session: string };

const lineBase = (rec: TurnRecord): LineBase => ({ v: 1, at: rec.at, session: rec.sessionId });

/** Copies each of `keys` from `source` only when set, so the line never carries `undefined`. */
function present<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Partial<T> {
  const out: Partial<T> = {};
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

/** Optional fields before the strategy group, in ledger key order. */
const ANSWER_FIELDS = ["miss", "effortP", "risky", "corrects"] as const;
/** Optional fields after the strategy group, in ledger key order. */
const DECISION_FIELDS = ["skill", "skillP", "gate", "requested", "effective"] as const;

/** The `correction` line for the previous turn, when this turn's `corrects` reaches the threshold. */
export function correctionLine(rec: TurnRecord): Record<string, unknown> | undefined {
  if (rec.corrects === undefined || rec.previousTurnId === undefined) return undefined;
  if (rec.corrects < CORRECTION_THRESHOLD) return undefined;
  return {
    ...lineBase(rec),
    kind: "correction",
    turnId: rec.previousTurnId,
    corrects: rec.corrects,
  };
}

function settledOutcome(facts: SettleFacts): "aborted" | "error" | "ok" {
  if (facts.aborted) return "aborted";
  return facts.stop === "error" ? "error" : "ok";
}

/** Strategy fields travel together or not at all. */
function strategyFields(rec: TurnRecord): Record<string, unknown> {
  if (rec.strategy === undefined || rec.strategyP === undefined || rec.advised === undefined) {
    return {};
  }
  return { strategy: rec.strategy, strategyP: rec.strategyP, advised: rec.advised };
}

/** The `main` ledger line for a settled turn. */
export function mainLine(rec: TurnRecord, facts: SettleFacts): Record<string, unknown> {
  // `ms` is meaningful only once the classifier answered or missed.
  const timed = rec.answered || rec.miss !== undefined;
  return {
    ...lineBase(rec),
    kind: "main",
    mode: rec.mode,
    answered: rec.answered,
    turnId: rec.turnId,
    ...(rec.held === true ? { held: true } : {}),
    ...(timed ? { ms: rec.ms } : {}),
    ...present(rec, ANSWER_FIELDS),
    ...strategyFields(rec),
    ...present(rec, DECISION_FIELDS),
    from: rec.from,
    toolCalls: rec.toolCalls,
    failures: rec.failures,
    inputTokens: rec.inputTokens,
    outputTokens: rec.outputTokens,
    durationMs: Math.max(0, facts.now - rec.at),
    outcome: settledOutcome(facts),
  };
}

export type DecidedAnchor = { provider: string; model: string; level: ThinkingLevel };

/**
 * The hold anchor for the `jev-turn` entry: only a decided, unheld turn whose compaction
 * is still the current one.
 */
export function decidedAnchor(
  rec: TurnRecord,
  currentCompactionId: string | undefined,
): DecidedAnchor | undefined {
  if (rec.held === true || rec.effective === undefined) return undefined;
  if (typeof rec.provider !== "string" || typeof rec.model !== "string") return undefined;
  if (currentCompactionId !== rec.compactionId) return undefined;
  return { provider: rec.provider, model: rec.model, level: rec.effective };
}

type BranchEntry = { type?: string; message?: unknown };

/** Stop reason of the newest assistant message on the branch, if it is a string. */
export function lastAssistantStop(entries: readonly BranchEntry[]): string | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.type !== "message") continue;
    const message = entry.message as { role?: string; stopReason?: unknown };
    if (message.role !== "assistant") continue;
    return typeof message.stopReason === "string" ? message.stopReason : undefined;
  }
  return undefined;
}

export type DecidedSummary = { effort?: string; strategy?: string };

/** What an answered turn decided, carried into the next prompt's rich state. */
export function decidedSummary(rec: TurnRecord): DecidedSummary | undefined {
  if (!rec.answered) return undefined;
  const effort = rec.effective ?? rec.requested;
  return {
    ...(effort === undefined ? {} : { effort }),
    ...(rec.strategy === undefined ? {} : { strategy: rec.strategy }),
  };
}
