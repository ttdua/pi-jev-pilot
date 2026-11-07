// Pure per-mode, per-routing worker routing for the report pass. Mirrors the host's rolling window.
import { cutPointsFor } from "../../src/policy/cutpoints.ts";
import { WINDOW_MAX, windowEntries, type WindowLine } from "../../src/policy/cut-window.ts";
import { EFFORT_LEVELS } from "../../src/policy/effort.ts";
import type { ModeName } from "../../src/policy/modes.ts";
import { routeLaunch } from "../../src/policy/route.ts";
import { difficultyScore } from "../../src/policy/score.ts";
import type { WorkerAnswers } from "../../src/policy/worker.ts";
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

/** One target per answer in sample order; a slot launch never enters the window. */
export function routeStream(
  answers: readonly (ReadAnswers | undefined)[],
  o: RouteOptions,
): (string | undefined)[] {
  const slots = o.routing === "slots" ? o.config.slots.map((s) => s.name) : [];
  const offered = offeredTiers(o.config.tiers, o.config.expertOn);
  const tierQuestion = offered.length > 0 || slots.length > 0;
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
    if (record !== undefined && !target.startsWith("slot::")) {
      const score = difficultyScore(read.answers);
      const effortP = effortProbabilities(read);
      lines.push({
        kind: "worker",
        at: i,
        ...(tierQuestion
          ? { rubric: RUBRIC_VERSION, expertOffered: offered.includes("expert") }
          : {}),
        ...(score !== undefined ? { score } : {}),
        reason: record.reason,
        ...(record.tier !== undefined ? { tier: record.tier } : {}),
        ...(record.fallback !== undefined ? { fallback: record.fallback } : {}),
        ...(effortP !== undefined ? { effortP } : {}),
      });
    }
    return target;
  });
}
