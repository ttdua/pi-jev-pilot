import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { LaunchRequest } from "@ttdua/pi-subagents";
import { offeredTiers } from "../../jev/questions.ts";
import { effectiveLaunch } from "../../policy/launch.ts";
import { cutPointsFor, launchKind, type WindowEntry } from "../../policy/worker/index.ts";
import { agentFacts, type Snapshot } from "../platform/index.ts";
import type { LaunchEntry } from "./entry.ts";

/** What the policy reads from the main session it was registered in. */
export type MainContext = Pick<
  ExtensionContext,
  "sessionManager" | "modelRegistry" | "hasUI" | "ui"
>;

/** One policy call: the launch, the main session, the fresh snapshot and the classifier budget. */
export type PolicyCall = {
  request: LaunchRequest;
  ctx: MainContext;
  snap: Snapshot;
  /** The executor's signal for this call: aborted when the launch is cancelled or times out. */
  signal: AbortSignal;
  /** Milliseconds left of the one classifier deadline this launch's requests share. */
  remainingMs: () => number;
};

/** A caller-chosen model id the ledger may record. */
const CALLER_MODEL = /^[A-Za-z0-9._:/-]{1,128}$/;

/**
 * Whether the caller named the requested model. The executor fills `requested.model` from the
 * agent's own `model` when the caller names none, so a model equal to the agent's is not the caller's.
 */
export function callerNamedModel(request: LaunchRequest): boolean {
  const model = request.requested.model;
  return model !== undefined && model !== request.agent.model;
}

/** The caller's model for the ledger, when the caller named one the ledger may record. */
function callerModel(request: LaunchRequest): string | undefined {
  const model = request.requested.model;
  if (model === undefined || !callerNamedModel(request)) return undefined;
  return CALLER_MODEL.test(model) ? model : undefined;
}

/** The launch as routing first sees it, before any classifier question is asked. */
export function newEntry(call: PolicyCall, window: readonly WindowEntry[]): LaunchEntry {
  const { request, snap } = call;
  const { settings } = snap;
  const facts = agentFacts(request.agent);
  const launch = effectiveLaunch(
    { ...request, callerNamedModel: callerNamedModel(request) },
    facts,
  );
  const offered = offeredTiers(settings.tiers, settings.switches.expert);
  const slots = settings.crew.slots.map((s) => ({ name: s.name, model: s.model, when: s.when }));
  const caller = callerModel(request);
  return {
    agentId: request.agentId,
    origin: request.origin,
    facts,
    launch,
    kind: launchKind(launch, offered, settings.subagents.forkedLaunch, slots.length),
    mode: settings.mode,
    cuts: cutPointsFor(window, settings.mode),
    offered,
    slots,
    outcome: undefined,
    specs: {},
    session: call.ctx.sessionManager.getSessionId(),
    ...(caller === undefined ? {} : { callerModel: caller }),
    briefChars: Array.from(request.prompt).length,
  };
}
