import type { LaunchRequest } from "@ttdua/pi-subagents";
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

/** What a launch needs from its policy call until its ledger line. */
export type LaunchEntry = {
  /** The executor's id for this launch; outcomes join on it. */
  agentId: string;
  origin: LaunchRequest["origin"];
  facts: AgentFacts;
  launch: EffectiveLaunch;
  kind: LaunchKind;
  /** Read once at the policy call; the request, tier decision and ledger line all use it. */
  mode: ModeName;
  /** Cut points for `mode`, computed once at the policy call from the window as it was then. */
  cuts: CutPoints;
  offered: readonly TierName[];
  /** Read with `offered`, so a slot removed mid-launch still resolves when the route is decided. */
  slots: readonly Slot[];
  outcome: Promise<JevOutcome> | undefined;
  specs: Record<string, QuestionSpec>;
  session: string;
  callerModel?: string;
  briefChars: number;
  route?: Route;
  answers?: WorkerAnswers | undefined;
  /** Set when the launch routes: what the ledger line needs besides the route. */
  jev?: JevOutcome | undefined;
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
