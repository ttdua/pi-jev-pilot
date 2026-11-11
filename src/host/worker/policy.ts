import type { LaunchAdjustment, LaunchPolicy, LaunchRequest } from "@ttdua/pi-subagents";
import type { ToolPlan } from "../../policy/tools/index.ts";
import { isChild, type Snapshot } from "../platform/index.ts";
import {
  assessTools,
  hasCandidates,
  planTools,
  type AssessDeps,
  type ToolDecision,
} from "../tools/index.ts";
import { classifyLaunch, type ClassifyDeps } from "./classify.ts";
import type { LaunchEntry } from "./entry.ts";
import type { LaunchBook } from "./launches.ts";
import type { MainContext, PolicyCall } from "./request.ts";
import { routeLaunchEntry, type Routed } from "./route.ts";
import type { LaunchWarnings } from "./warnings.ts";

/** A launch the policy decided and the ledger will record: its route and its tool decision. */
export type Decided = { launch: LaunchEntry; tools: ToolDecision | undefined };

/** What the launch policy and the outcome handlers share. */
export type WorkerHost = {
  book: LaunchBook<Decided>;
  warnings: LaunchWarnings;
  classify: ClassifyDeps;
  assess: AssessDeps;
  snapshot: () => Snapshot;
  append: (entry: unknown) => void;
  now: () => number;
  /** The main session the policy was registered in; undefined before `start`. */
  main: () => MainContext | undefined;
};

/** Which parts may act on this launch, read fresh from the snapshot. */
type Gates = { routing: boolean; tools: boolean };

/** Config, key and executor first; then each part's own switch. */
function openGates(snap: Snapshot): Gates | undefined {
  if (!snap.config.valid || !snap.keySet || snap.executor.kind !== "present") return undefined;
  const { switches } = snap.settings;
  if (!switches.subagents && !switches.tools) return undefined;
  return { routing: switches.subagents, tools: switches.tools };
}

/** One classifier deadline, shared by every Jev request of this launch. */
function deadline(host: WorkerHost, timeoutMs: number): () => number {
  const { now } = host;
  const end = now() + timeoutMs;
  return () => Math.max(1, end - now());
}

/** The route's write plus, in `enforce`, the flagged and granted tools. */
function adjustmentOf(
  routed: Routed | undefined,
  tools: ToolDecision | undefined,
): LaunchAdjustment | undefined {
  const out: { -readonly [K in keyof LaunchAdjustment]: LaunchAdjustment[K] } = {
    ...routed?.write,
  };
  if (tools?.mode === "enforce") {
    if (tools.flagged.size > 0) out.removeTools = [...tools.flagged];
    if (tools.granted.size > 0) out.addTools = [...tools.granted];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Shows the "cannot run" warning once per target and model; never blocks the launch. */
function warn(host: WorkerHost, call: PolicyCall, routed: Routed | undefined): void {
  if (routed?.problem === undefined) return;
  try {
    if (call.ctx.hasUI) host.warnings.show(call.ctx.ui, routed.problem);
  } catch {
    /* a failed warning never blocks the launch */
  }
}

/** Keeps a recorded launch until its outcome; a skipped route (cancel) records nothing. */
function remember(host: WorkerHost, entry: LaunchEntry | undefined, tools?: ToolDecision): void {
  if (entry?.route === undefined || entry.route.kind === "skip") return;
  host.book.remember(entry.agentId, { launch: entry, tools });
}

/** Runs the worker request and the tool request at once and waits for both. */
async function decide(host: WorkerHost, call: PolicyCall, gates: Gates, plan: ToolPlan) {
  const entry = gates.routing ? classifyLaunch(call, host.classify) : undefined;
  const assessed = hasCandidates(plan)
    ? assessTools({ ...call, plan }, host.assess)
    : Promise.resolve(undefined);
  const [routed, tools] = await Promise.all([
    entry === undefined ? undefined : routeLaunchEntry(entry, call.ctx, call.snap),
    assessed,
  ]);
  return { entry, routed, tools };
}

/** The policy body for one launch; undefined leaves the launch as requested. */
async function decideLaunch(
  host: WorkerHost,
  request: LaunchRequest,
  signal: AbortSignal,
): Promise<LaunchAdjustment | undefined> {
  const ctx = host.main();
  if (ctx === undefined || !host.book.isOpen()) return undefined;
  if (request.parentSessionId !== undefined && isChild(request.parentSessionId)) return undefined;
  // Called detached: `snapshot` never receives a `this`.
  const { snapshot } = host;
  const snap = snapshot();
  const gates = openGates(snap);
  if (gates === undefined) return undefined;
  const remainingMs = deadline(host, snap.settings.classifier.timeoutMs);
  const call: PolicyCall = { request, ctx, snap, signal, remainingMs };
  const plan = gates.tools ? planTools(request, snap.settings) : { block: [], grant: [] };
  const { entry, routed, tools } = await decide(host, call, gates, plan);
  if (signal.aborted) return undefined;
  warn(host, call, routed);
  remember(host, entry, tools);
  return adjustmentOf(routed, tools);
}

/**
 * The main session's launch policy: routes the worker and assesses its tools in one call. Fails
 * open: any error returns no adjustment, so the launch runs as requested.
 */
export function createWorkerPolicy(host: WorkerHost): LaunchPolicy {
  return async (request, signal) => {
    try {
      return await decideLaunch(host, request, signal);
    } catch {
      return undefined;
    }
  };
}
