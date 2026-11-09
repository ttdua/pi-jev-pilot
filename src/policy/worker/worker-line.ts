import type { Answer } from "../answers.ts";
import type { TierName } from "../launch.ts";
import type { WorkerAnswers } from "./answers.ts";
import { decisionFields } from "./ledger-line.ts";
import type { Route } from "./route.ts";

/** The classifier result as the line reads it; `JevOutcome` from `jev/` satisfies it structurally. */
export type WorkerReply =
  | { kind: "ok"; ms: number; body?: unknown }
  | { kind: "miss"; ms: number; miss?: string; reason?: string }
  | { kind: "cancelled" };

/** The executor fields a line reads; anything else the executor sends is ignored. */
export type ExecutorOutcome = {
  status?: unknown;
  durationMs?: unknown;
  toolUses?: unknown;
  tokens?: unknown;
};

export type ToolCounts = { toolsScored: number; toolsFlagged: number };

/** Everything one `worker` line is built from, gathered by the host when the launch settles. */
export type WorkerLineInput = {
  at: number;
  session: string | undefined;
  mode: string;
  agent: string;
  briefChars: number;
  jev: WorkerReply | undefined;
  answers: WorkerAnswers | undefined;
  route: Route | undefined;
  offered: readonly TierName[];
  tierQuestion: boolean;
  rubric: number;
  callerModel: string | undefined;
  /**
   * Takes this agent's tool counts; undefined for a resume or an unnamed agent. Called after the
   * fields before it are built, so a line that fails earlier leaves the counts in place.
   */
  toolCounts: () => ToolCounts | undefined;
  outcome: ExecutorOutcome | undefined;
};

type Line = Record<string, unknown>;

const STATUSES = ["completed", "aborted", "stopped", "error"] as const;
const EFFORT_KEYS: readonly string[] = ["low", "medium", "high", "xhigh", "max"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A finite, non-negative number rounded to an integer; anything else is undefined. */
function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined;
}

/** A choice answer's probabilities, optionally limited to `keys`; own data properties only. */
function probabilities(
  answer: Answer | undefined,
  keys?: readonly string[],
): Record<string, number> | undefined {
  if (answer?.type !== "choice") return undefined;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(answer.probabilities)) {
    if (keys !== undefined && !keys.includes(key)) continue;
    // defineProperty keeps a `__proto__` key as data instead of changing the prototype.
    Object.defineProperty(out, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

/** Sets `key` only when `value` is defined, so the line never carries `undefined`. */
function put(line: Line, key: string, value: unknown): void {
  if (value !== undefined) line[key] = value;
}

function answerFields(line: Line, input: WorkerLineInput): void {
  const { jev, answers } = input;
  if (jev !== undefined && jev.kind !== "cancelled") line["ms"] = count(jev.ms);
  if (answers?.kind === "miss") line["miss"] = answers.miss;
  if (answers?.kind !== "read") return;
  const risky = answers.answers["risky"];
  if (risky?.type === "noul") line["risky"] = risky.noul;
  put(line, "tierP", probabilities(answers.answers["tier"]));
  put(line, "effortP", probabilities(answers.answers["effort"], EFFORT_KEYS));
}

function routeFields(line: Line, route: Exclude<Route, { kind: "skip" }>): void {
  if (route.kind === "untouched") {
    line["reason"] = "untouched";
    if (route.locked === true) line["locked"] = true;
    return;
  }
  const { record } = route;
  line["reason"] = record.reason;
  put(line, "tier", record.tier);
  put(line, "fallback", record.fallback);
  put(line, "effort", record.effort);
  if (record.locked === true) line["locked"] = true;
  put(line, "model", route.write.model);
}

function executorFields(line: Line, outcome: ExecutorOutcome | undefined): void {
  const status = STATUSES.find((s) => s === outcome?.status);
  line["status"] = outcome === undefined ? "error" : (status ?? "error");
  put(line, "durationMs", count(outcome?.durationMs));
  put(line, "toolUses", count(outcome?.toolUses));
  const tokens = outcome?.tokens;
  put(line, "tokens", isRecord(tokens) ? count(tokens["total"]) : undefined);
}

/**
 * The `worker` ledger line for a settled launch, or undefined when the launch is not recorded
 * (no route, or a skipped one). Key order is part of the ledger format.
 */
export function workerLine(input: WorkerLineInput): Line | undefined {
  const { route, jev, answers } = input;
  if (route === undefined || route.kind === "skip") return undefined;
  const line: Line = {
    v: 1,
    at: input.at,
    kind: "worker",
    session: input.session,
    mode: input.mode,
    answered: jev?.kind === "ok" && answers?.kind === "read",
    agent: input.agent,
    briefChars: input.briefChars,
  };
  answerFields(line, input);
  Object.assign(
    line,
    decisionFields({
      answers,
      offered: input.offered,
      tierQuestion: input.tierQuestion,
      rubric: input.rubric,
    }),
  );
  routeFields(line, route);
  put(line, "callerModel", input.callerModel);
  const counts = input.toolCounts();
  if (counts !== undefined) {
    line["toolsScored"] = counts.toolsScored;
    line["toolsFlagged"] = counts.toolsFlagged;
  }
  executorFields(line, input.outcome);
  return line;
}
