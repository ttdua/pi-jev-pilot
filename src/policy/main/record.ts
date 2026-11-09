import type { EffortLevel, ThinkingLevel } from "../policy/effort.ts";
import type { Strategy } from "../policy/strategy.ts";

/** Per-turn bookkeeping. Internal; the ledger lines are written from it when the run settles. */
export type TurnRecord = {
  turnId: string;
  at: number;
  sessionId: string;
  mode: string;
  from: ThinkingLevel;
  previousTurnId?: string;
  held?: true;
  provider?: string;
  model?: string;
  compactionId?: string;
  answered: boolean;
  ms: number;
  miss?: string;
  effortP?: Record<string, number>;
  risky?: number;
  corrects?: number;
  strategy?: Strategy;
  strategyP?: number;
  advised?: boolean;
  skill?: string;
  skillP?: number;
  gate?: number;
  requested?: EffortLevel;
  effective?: ThinkingLevel;
  applied?: ThinkingLevel;
  sawRequest: boolean;
  toolCalls: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  /** Stop reason of the last assistant message seen in `turn_end`. */
  lastStop?: string;
};

/** The `turn_end` fields the record reads; Pi's event is wider. */
export type TurnEndFacts = {
  toolResults?: readonly { isError?: boolean }[];
  message: unknown;
};

/** Adds one turn's tool calls, failures and token usage, and keeps its stop reason. */
export function addTurnEnd(rec: TurnRecord, event: TurnEndFacts): void {
  const results = event.toolResults ?? [];
  rec.toolCalls += results.length;
  rec.failures += results.filter((r) => r.isError === true).length;
  const message = event.message as {
    usage?: { input?: unknown; output?: unknown };
    stopReason?: unknown;
  };
  if (typeof message.usage?.input === "number") rec.inputTokens += message.usage.input;
  if (typeof message.usage?.output === "number") rec.outputTokens += message.usage.output;
  if (typeof message.stopReason === "string") rec.lastStop = message.stopReason;
}
