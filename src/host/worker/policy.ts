import type { LaunchAdjustment, LaunchPolicy, LaunchRequest } from "@ttdua/pi-subagents";
import { isChild, type Snapshot } from "../platform/index.ts";
import { classifyLaunch, type ClassifyDeps } from "./classify.ts";
import type { LaunchEntry } from "./entry.ts";
import type { LaunchBook } from "./launches.ts";
import type { MainContext, PolicyCall } from "./request.ts";
import { routeLaunchEntry, type Routed } from "./route.ts";
import type { LaunchWarnings } from "./warnings.ts";

/** A launch the policy decided and the ledger will record. */
export type Decided = { launch: LaunchEntry };

/** What the launch policy and the outcome handlers share. */
export type WorkerHost = {
  book: LaunchBook<Decided>;
  warnings: LaunchWarnings;
  classify: ClassifyDeps;
  snapshot: () => Snapshot;
  append: (entry: unknown) => void;
  now: () => number;
  /** The main session the policy was registered in; undefined before `start`. */
  main: () => MainContext | undefined;
};

/** Whether routing may act: config, key and executor first, then the routing switch. */
function routingOpen(snap: Snapshot): boolean {
  return (
    snap.config.valid &&
    snap.keySet &&
    snap.executor.kind === "present" &&
    snap.settings.switches.subagents
  );
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
function remember(host: WorkerHost, entry: LaunchEntry | undefined): void {
  if (entry?.route === undefined || entry.route.kind === "skip") return;
  host.book.remember(entry.agentId, { launch: entry });
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
  if (!routingOpen(snap)) return undefined;
  const { now } = host;
  const end = now() + snap.settings.classifier.timeoutMs;
  const remainingMs = (): number => Math.max(1, end - now());
  const call: PolicyCall = { request, ctx, snap, signal, remainingMs };
  const entry = classifyLaunch(call, host.classify);
  const routed = entry === undefined ? undefined : await routeLaunchEntry(entry, ctx, snap);
  if (signal.aborted) return undefined;
  warn(host, call, routed);
  remember(host, entry);
  const write = routed?.write;
  return write !== undefined && Object.keys(write).length > 0 ? write : undefined;
}

/**
 * The main session's launch policy: routes the worker. Fails open: any error returns no adjustment, so the launch runs as requested.
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
