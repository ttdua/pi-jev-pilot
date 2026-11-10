import type { JevOutcome } from "../../jev/client.ts";
import type { QuestionSpec } from "../../policy/answers.ts";
import type { AgentFacts, EffectiveLaunch, TierName } from "../../policy/launch.ts";
import type {
  CutPoints,
  ExecutorOutcome,
  LaunchKind,
  ModeName,
  Route,
  WorkerAnswers,
} from "../../policy/worker/index.ts";
import type { Slot } from "../../store/config.ts";

/** What a launch needs from `message_end` until its `tool_call` (and later, its ledger line). */
export type LaunchEntry = {
  facts: AgentFacts;
  launch: EffectiveLaunch;
  kind: LaunchKind;
  /** Read once at classification; the request, tier decision and ledger line all use it. */
  mode: ModeName;
  /** Cut points for `mode`, computed once at classification from the window as it was then. */
  cuts: CutPoints;
  offered: readonly TierName[];
  /** Read with `offered`, so a slot removed mid-launch still resolves at `tool_call`. */
  slots: readonly Slot[];
  outcome: Promise<JevOutcome> | undefined;
  specs: Record<string, QuestionSpec>;
  route?: Route;
  answers?: WorkerAnswers | undefined;
  /** Set when the launch routes: what the ledger line needs besides the route. */
  jev?: JevOutcome | undefined;
  session?: string;
  callerModel?: string;
  briefChars?: number;
  /** Order stamp taken when the launch last routed at its `tool_call`. */
  seq?: number;
  /** Executor agent id, set when the tool result names one. */
  agentId?: string;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The only executor fields a ledger line needs. */
export function slim(data: Record<string, unknown>): ExecutorOutcome {
  const tokens = data["tokens"];
  return {
    status: data["status"],
    durationMs: data["durationMs"],
    toolUses: data["toolUses"],
    tokens: { total: isRecord(tokens) ? tokens["total"] : undefined },
  };
}
