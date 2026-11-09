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
