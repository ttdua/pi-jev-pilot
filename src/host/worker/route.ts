import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ModelThinking, ThinkingLevel } from "../../policy/effort.ts";
import type { Target } from "../../policy/launch.ts";
import { readWorkerOutcome, routeLaunch, type Route } from "../../policy/worker/index.ts";
import { checkModel, resolveModel, type Snapshot } from "../platform/index.ts";
import type { LaunchEntry } from "./entry.ts";
import type { CannotRun } from "./warnings.ts";

type Ctx = Pick<ExtensionContext, "modelRegistry">;
type Check = { ok: true; thinking: ModelThinking } | { ok: false; why: string };

/** What a route writes into the launch: the adjustment's `model` and `thinking`, nothing else. */
export type RouteWrite = { model?: string; thinking?: ThinkingLevel };

/** The route's write, and the target that could not run so the caller can warn about it. */
export type Routed = { write: RouteWrite; problem: CannotRun | undefined };

/** Model and registry checks for one routing decision, each target checked at most once. */
class TargetChecks {
  readonly #checks = new Map<Target, Check>();

  constructor(
    readonly ctx: Ctx,
    readonly modelOf: (target: Target) => string,
  ) {}

  of(target: Target): Check {
    let check = this.#checks.get(target);
    if (check === undefined) {
      check = checkModel(this.ctx.modelRegistry, this.modelOf(target));
      this.#checks.set(target, check);
    }
    return check;
  }
}

/** The launch writes a model only when it asked the tier question and the caller did not lock it. */
function writesModel(entry: LaunchEntry): boolean {
  return entry.kind.kind === "ask" && entry.kind.tierQuestion && !entry.launch.modelLocked;
}

/** The fallback target that cannot run, when the route fell back from it. */
function fallbackProblem(
  result: Extract<Route, { kind: "routed" }>,
  checks: TargetChecks,
): CannotRun | undefined {
  const decided = result.record.fallback;
  if (decided === undefined) return undefined;
  const check = checks.of(decided);
  if (check.ok) return undefined;
  const to = result.record.tier === decided ? undefined : result.record.tier;
  return { target: decided, model: checks.modelOf(decided), why: check.why, to };
}

/**
 * Reads the classifier answer and decides the route. Returns what to write into the launch and
 * the target that could not run; the entry keeps the route and answers for the ledger line.
 */
export async function routeLaunchEntry(
  entry: LaunchEntry,
  ctx: Ctx,
  snap: Snapshot,
): Promise<Routed> {
  const outcome = entry.outcome === undefined ? undefined : await entry.outcome;
  const answers = outcome === undefined ? undefined : readWorkerOutcome(outcome, entry.specs);
  entry.jev = outcome;
  const { settings } = snap;
  const modelOf = (t: Target): string => resolveModel(t, settings.tiers, entry.slots) ?? "";
  const checks = new TargetChecks(ctx, modelOf);
  const writes = writesModel(entry);
  const result = routeLaunch({
    answers,
    launch: entry.launch,
    offered: entry.offered,
    cuts: entry.cuts,
    forkedLaunch: settings.subagents.forkedLaunch,
    canRun: (t) => !writes || checks.of(t).ok,
    thinkingOf: (t) => {
      const check = checks.of(t);
      return check.ok ? check.thinking : undefined;
    },
    modelOf,
    slots: entry.slots.map((s) => s.name),
  });
  entry.answers = answers;
  entry.route = result;
  if (result.kind !== "routed") return { write: {}, problem: undefined };
  return {
    write: { ...result.write },
    problem: writes ? fallbackProblem(result, checks) : undefined,
  };
}
