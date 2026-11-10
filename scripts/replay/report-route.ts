// Pure per-mode, per-routing worker routing for the report pass. Mirrors the host's rolling window.
import { cutPointsFor } from "../../src/policy/worker/index.ts";
import { WINDOW_MAX, windowEntries, type WindowLine } from "../../src/policy/worker/index.ts";
import { EFFORT_LEVELS } from "../../src/policy/effort.ts";
import type { ModeName } from "../../src/policy/worker/index.ts";
import { isSlot } from "../../src/policy/launch.ts";
import { routeLaunch } from "../../src/policy/worker/index.ts";
import { difficultyScore } from "../../src/policy/worker/index.ts";
import type { WorkerAnswers } from "../../src/policy/worker/index.ts";
import { RUBRIC_VERSION } from "../../src/jev/rubrics.ts";
import { offeredTiers } from "../../src/jev/questions.ts";
import { modelOfConfig, REPLAY_LAUNCH } from "./compare.ts";
import type { PlainConfig } from "./variants.ts";

export const REPORT_MODES = ["budget", "standard", "premium"] as const;
export type Routing = "slots" | "tiers";

type ReadAnswers = Extract<WorkerAnswers, { kind: "read" }>;
type RouteOptions = {
  config: PlainConfig;
  mode: ModeName;
  routing: Routing;
  background: readonly boolean[];
};

// The effort answer's probabilities over the known levels, as the host records them.
function effortProbabilities(answers: ReadAnswers): WindowLine["effortP"] {
  const effort = answers.answers["effort"];
  if (effort?.type !== "choice") return undefined;
  const out: Partial<Record<(typeof EFFORT_LEVELS)[number], number>> = {};
  for (const level of EFFORT_LEVELS) {
    const p = effort.probabilities[level];
    if (p !== undefined) out[level] = p;
  }
  return out;
}

export type RoutedLaunch = { target: string; reason: string };

/** One target per answer in sample order; a slot launch never enters the window. */
export function routeStream(
  answers: readonly (ReadAnswers | undefined)[],
  o: RouteOptions,
): (string | undefined)[] {
  return routeStreamRecords(answers, o).map((r) => r?.target);
}

type RouteRecord = NonNullable<
  Extract<ReturnType<typeof routeLaunch>, { kind: "routed" }>["record"]
>;
type StreamContext = { offered: ReturnType<typeof offeredTiers>; tierQuestion: boolean };

/** The window line the host appends after a non-slot launch. */
function windowLine(
  read: ReadAnswers,
  record: RouteRecord,
  at: number,
  ctx: StreamContext,
): WindowLine {
  const score = difficultyScore(read.answers);
  const effortP = effortProbabilities(read);
  return {
    kind: "worker",
    at,
    ...(ctx.tierQuestion
      ? { rubric: RUBRIC_VERSION, expertOffered: ctx.offered.includes("expert") }
      : {}),
    ...(score !== undefined ? { score } : {}),
    reason: record.reason,
    ...(record.tier !== undefined ? { tier: record.tier } : {}),
    ...(record.fallback !== undefined ? { fallback: record.fallback } : {}),
    ...(effortP !== undefined ? { effortP } : {}),
  };
}

/** `routeStream` with the route reason of each launch; `undefined` for a miss. */
export function routeStreamRecords(
  answers: readonly (ReadAnswers | undefined)[],
  o: RouteOptions,
): (RoutedLaunch | undefined)[] {
  const slots = o.routing === "slots" ? o.config.slots.map((s) => s.name) : [];
  const offered = offeredTiers(o.config.tiers, o.config.expertOn);
  const ctx: StreamContext = { offered, tierQuestion: offered.length > 0 || slots.length > 0 };
  const modelOf = modelOfConfig(o.config);
  const lines: WindowLine[] = [];
  return answers.map((read, i) => {
    if (read === undefined) return undefined;
    const route = routeLaunch({
      answers: read,
      launch: REPLAY_LAUNCH(o.background[i] === true),
      offered,
      cuts: cutPointsFor(windowEntries(lines.slice(-WINDOW_MAX), RUBRIC_VERSION), o.mode),
      forkedLaunch: "untouched",
      canRun: () => true,
      thinkingOf: () => ({ reasoning: true }),
      modelOf,
      slots,
    });
    const record = route.kind === "routed" ? route.record : undefined;
    const target = record?.tier ?? "none";
    if (record !== undefined && !isSlot(target)) lines.push(windowLine(read, record, i, ctx));
    return { target, reason: record?.reason ?? "none" };
  });
}
