import type {
  ExtensionContext,
  MessageEndEvent,
  ToolCallEvent,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import type { JevOutcome } from "../../jev/client.ts";
import { RUBRIC_VERSION } from "../../jev/rubrics.ts";
import { workerLine, type ExecutorOutcome } from "../../policy/worker/index.ts";
import { isChild, type Snapshot } from "../platform/index.ts";
import { takeToolCounts } from "../tools/index.ts";
import { classifyLaunch, type ClassifyDeps } from "./classify.ts";
import { isRecord, slim, type LaunchEntry } from "./entry.ts";
import type { LaunchBook } from "./launches.ts";
import { routeToolCall, stampToolCall } from "./route.ts";
import type { LaunchWarnings } from "./warnings.ts";

/** What every worker handler shares. */
export type WorkerHost = {
  book: LaunchBook<LaunchEntry, ExecutorOutcome>;
  warnings: LaunchWarnings;
  classify: ClassifyDeps;
  snapshot: () => Snapshot;
  append: (entry: unknown) => void;
  now: () => number;
};

// Only a duplicate closes the gate for now: a real captured service has no launch seam until
// Task 4, so `present` is not reachable yet. Task 7 deletes this gate.
/** Fresh gate; returns the snapshot only when routing may act. */
function gate(host: WorkerHost, ctx: ExtensionContext): Snapshot | undefined {
  if (!host.book.isOpen()) return undefined;
  if (isChild(ctx.sessionManager.getSessionId())) return undefined;
  // Called detached, as before the split: `snapshot` never receives a `this`.
  const { snapshot } = host;
  const snap = snapshot();
  if (!snap.config.valid || !snap.keySet || snap.executor.kind === "duplicate") return undefined;
  return snap.settings.switches.subagents ? snap : undefined;
}

/** One `worker` line; never throws. Tool counts are consumed only when a line is written. */
function writeLine(
  host: WorkerHost,
  entry: LaunchEntry,
  outcome: ExecutorOutcome | undefined,
): void {
  try {
    if (entry.route === undefined || entry.route.kind === "skip") return;
    const counted = entry.agentId !== undefined && !entry.launch.resume;
    const { now, append } = host;
    const line = workerLine({
      at: now(),
      session: entry.session,
      mode: entry.mode,
      agent: entry.facts.name,
      briefChars: entry.briefChars ?? 0,
      jev: entry.jev,
      answers: entry.answers,
      route: entry.route,
      offered: entry.offered,
      tierQuestion: entry.kind.kind === "ask" && entry.kind.tierQuestion,
      rubric: RUBRIC_VERSION,
      callerModel: entry.callerModel,
      toolCounts: () => (counted ? takeToolCounts(entry.agentId ?? "") : undefined),
      outcome,
    });
    if (line !== undefined) append(line);
  } catch {
    /* a failed ledger line never affects the launch */
  }
}

/**
 * The `subagent` tool calls of an assistant message, as id and arguments. A generator, so each
 * block is read only after the previous launch was classified, as before the split.
 */
function* subagentCalls(message: unknown): Generator<[string, Record<string, unknown>]> {
  if (!isRecord(message) || message["role"] !== "assistant") return;
  const content = message["content"];
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (!isRecord(block) || block["type"] !== "toolCall" || block["name"] !== "subagent") continue;
    const id = block["id"];
    const args = block["arguments"];
    if (typeof id === "string" && isRecord(args)) yield [id, args];
  }
}

/** `message_end`: classify every launch of the message and wait for the classifier. */
export async function onMessageEnd(
  host: WorkerHost,
  event: MessageEndEvent,
  ctx: ExtensionContext,
): Promise<void> {
  const snap = gate(host, ctx);
  if (snap === undefined) return;
  const pending: Promise<JevOutcome>[] = [];
  for (const [id, args] of subagentCalls(event.message)) {
    try {
      const entry = classifyLaunch(args, ctx, snap, host.classify);
      host.book.remember(id, entry);
      if (entry.outcome !== undefined) pending.push(entry.outcome);
    } catch {
      /* this launch is classified again at its tool_call */
    }
  }
  await Promise.all(pending);
}

/** `tool_call`: route the launch and write the model and thinking into its input. */
export async function onToolCall(
  host: WorkerHost,
  event: ToolCallEvent,
  ctx: ExtensionContext,
): Promise<void> {
  if (event.toolName !== "subagent") return;
  const snap = gate(host, ctx);
  if (snap === undefined) return;
  const input = event.input as Record<string, unknown>;
  const { book } = host;
  let entry = book.launch(event.toolCallId);
  if (entry === undefined) {
    entry = classifyLaunch(input, ctx, snap, host.classify);
    book.remember(event.toolCallId, entry);
  }
  stampToolCall(entry, input, {
    nextSeq: () => book.nextSeq(),
    sessionId: () => ctx.sessionManager.getSessionId(),
  });
  const problem = await routeToolCall(entry, input, ctx, snap);
  if (problem === undefined || !ctx.hasUI) return;
  try {
    host.warnings.show(ctx.ui, problem);
  } catch {
    /* a failed warning never blocks the launch */
  }
}

/** The executor agent id a tool result names, or undefined. */
function agentIdOf(event: ToolResultEvent): string | undefined {
  const details: unknown = event.details;
  const agentId = isRecord(details) ? details["agentId"] : undefined;
  return typeof agentId === "string" && agentId !== "" ? agentId : undefined;
}

/** `tool_result`: write the line now, or wait for (or join with) the executor outcome. */
export function onToolResult(host: WorkerHost, event: ToolResultEvent): void {
  const { book } = host;
  if (!book.isOpen() || event.toolName !== "subagent") return;
  const entry = book.take(event.toolCallId);
  const agentId = agentIdOf(event);
  if (entry !== undefined && agentId !== undefined) entry.agentId = agentId;
  if (entry?.route === undefined || entry.route.kind === "skip") {
    // Nothing will be written for this launch: an outcome buffered for its agent
    // belongs to an earlier run or to this unwritten launch, so drop it.
    if (agentId !== undefined) book.dropOutcome(agentId);
    return;
  }
  if (agentId === undefined) return writeLine(host, entry, undefined);
  const joined = book.join(agentId, entry);
  if (joined.kind === "write") writeLine(host, entry, joined.outcome);
}

/** Executor events: write the waiting launch's line, or keep the outcome for its tool result. */
export function onExecutorEvent(host: WorkerHost, data: unknown): void {
  const { book } = host;
  if (!book.isOpen() || !isRecord(data) || typeof data["id"] !== "string") return;
  const id = data["id"];
  const entry = book.claim(id);
  if (entry === undefined) book.buffer(id, () => slim(data));
  else writeLine(host, entry, slim(data));
}
