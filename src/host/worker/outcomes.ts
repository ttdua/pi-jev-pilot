import { RUBRIC_VERSION } from "../../jev/rubrics.ts";
import {
  workerLine,
  type EffectiveValues,
  type ExecutorOutcome,
} from "../../policy/worker/index.ts";
import { isRecord, slim } from "./entry.ts";
import type { Held } from "./launches.ts";
import type { Decided, WorkerHost } from "./policy.ts";

/** The executor events the ledger joins on, by `agentId` (lifecycle) or `id` (outcome). */
export const SESSION_CREATED = "subagents:child:session-created";
export const OUTCOME_EVENTS = ["subagents:completed", "subagents:failed"] as const;

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** One `worker` line; never throws. */
function writeLine(host: WorkerHost, held: Held<Decided>, outcome: ExecutorOutcome): void {
  try {
    const { launch } = held.entry;
    const { now, append } = host;
    const line = workerLine({
      at: now(),
      session: launch.session,
      mode: launch.mode,
      agent: launch.facts.name,
      briefChars: launch.briefChars,
      jev: launch.jev,
      answers: launch.answers,
      route: launch.route,
      offered: launch.offered,
      tierQuestion: launch.kind.kind === "ask" && launch.kind.tierQuestion,
      rubric: RUBRIC_VERSION,
      callerModel: launch.callerModel,
      outcome,
      effective: held.effective,
    });
    if (line !== undefined) append(line);
  } catch {
    /* a failed ledger line never affects the launch */
  }
}

/** `session-created`: the model and thinking the child really runs with. */
export function onSessionCreated(host: WorkerHost, data: unknown): void {
  if (!host.book.isOpen() || !isRecord(data)) return;
  const agentId = text(data["agentId"]);
  if (agentId === undefined) return;
  const effective: EffectiveValues = {};
  const model = text(data["effectiveModel"]);
  const thinking = text(data["effectiveThinking"]);
  if (model !== undefined) effective.model = model;
  if (thinking !== undefined) effective.thinking = thinking;
  host.book.sessionCreated(agentId, effective);
}

/**
 * A launch cancelled after its policy call but before its session existed: the executor ends it
 * `stopped` without a `session-created` event, and the ledger keeps no line for a cancelled launch.
 */
function isCancelledBeforeSession(held: Held<Decided>, outcome: ExecutorOutcome): boolean {
  return outcome.status === "stopped" && held.effective === undefined;
}

/**
 * `completed`/`failed`: write the decided launch's line; any other agent id is ignored. The held
 * launch is settled either way, so a launch cancelled before its session leaves nothing behind.
 */
export function onOutcome(host: WorkerHost, data: unknown): void {
  if (!host.book.isOpen() || !isRecord(data)) return;
  const id = text(data["id"]);
  const held = id === undefined ? undefined : host.book.settle(id);
  if (held === undefined) return;
  const outcome = slim(data);
  if (!isCancelledBeforeSession(held, outcome)) writeLine(host, held, outcome);
}
