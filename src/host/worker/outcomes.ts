import { RUBRIC_VERSION } from "../../jev/rubrics.ts";
import {
  workerLine,
  type EffectiveValues,
  type ExecutorOutcome,
} from "../../policy/worker/index.ts";
import { launchToolCounts } from "../tools/index.ts";
import { isRecord, slim } from "./entry.ts";
import type { Held } from "./launches.ts";
import type { Decided, WorkerHost } from "./policy.ts";

/** The executor events the ledger joins on, by `agentId` (lifecycle) or `id` (outcome). */
export const SESSION_CREATED = "subagents:child:session-created";
export const BOUND = "subagents:child:bound";
export const OUTCOME_EVENTS = ["subagents:completed", "subagents:failed"] as const;

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** One `worker` line; never throws. Tool counts exist only when a line is written. */
function writeLine(host: WorkerHost, held: Held<Decided>, outcome: ExecutorOutcome): void {
  try {
    const { launch, tools } = held.entry;
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
      toolCounts: () =>
        tools === undefined ? undefined : launchToolCounts(tools, held.grantedTools),
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

/** `bound`: the grants that took effect in the child. */
export function onBound(host: WorkerHost, data: unknown): void {
  if (!host.book.isOpen() || !isRecord(data)) return;
  const agentId = text(data["agentId"]);
  const granted = data["grantedTools"];
  if (agentId === undefined || !Array.isArray(granted)) return;
  host.book.bound(
    agentId,
    granted.filter((name): name is string => typeof name === "string"),
  );
}

/** `completed`/`failed`: write the decided launch's line; any other agent id is ignored. */
export function onOutcome(host: WorkerHost, data: unknown): void {
  if (!host.book.isOpen() || !isRecord(data)) return;
  const id = text(data["id"]);
  const held = id === undefined ? undefined : host.book.settle(id);
  if (held !== undefined) writeLine(host, held, slim(data));
}
