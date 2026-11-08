// Shared builders for the runner and comparison tests.
import type { Result } from "../../scripts/replay/compare.ts";
import type { Plan, PlannedRequest, PlainConfig } from "../../scripts/replay/variants.ts";
import { mainQuestions } from "../../src/jev/questions.ts";
import type { WorkerAnswers } from "../../src/policy/worker.ts";

export const MARKER = "JEV-MARKER-PROMPT";
export const config: PlainConfig = {
  tiers: { fast: "a/b", deep: "c/d" },
  slots: [],
  mode: "standard",
  expertOn: false,
};

const main = mainQuestions({ askEffort: true, askStrategy: true });

export type MainPick = { effort?: string; strategy?: string; risky?: number; tier?: string };

const choice = (options: readonly string[], pick: string) => ({
  type: "choice",
  choice: pick,
  probabilities: Object.fromEntries(
    options.map((o) => [o, o === pick ? 0.9 : 0.1 / options.length]),
  ),
});

/** A valid main response body for the given picks. */
export function mainBody(p: MainPick = {}): unknown {
  const opts = (key: string): readonly string[] => {
    const spec = main.specs[key];
    return spec?.type === "choice" ? spec.options : [];
  };
  const tier = p.tier ?? opts("tier")[0] ?? "";
  return {
    answers: {
      effort: choice(opts("effort"), p.effort ?? "low"),
      risky: { type: "noul", noul: p.risky ?? 0.1 },
      tier: choice(opts("tier"), tier),
      strategy: choice(opts("strategy"), p.strategy ?? "direct"),
      corrects: { type: "noul", noul: 0.1 },
    },
  };
}

export const mainReq = (variant: string, base: string, sample: number): PlannedRequest => ({
  variant,
  base,
  sample,
  kind: "main",
  state: { prompt: `${MARKER} ${sample}` },
  questions: main.wire,
  specs: main.specs,
});

export const ok = (r: PlannedRequest, body: unknown): Result => ({
  variant: r.variant,
  base: r.base,
  sample: r.sample,
  kind: r.kind,
  outcome: { kind: "ok", body },
});

export const miss = (r: PlannedRequest): Result => ({
  variant: r.variant,
  base: r.base,
  sample: r.sample,
  kind: r.kind,
  outcome: { kind: "miss", miss: "error" },
});

export const planOf = (requests: PlannedRequest[], over: Partial<Plan> = {}): Plan => ({
  requests,
  skipped: [],
  excluded: {},
  ...over,
});

export type WorkerPick = {
  tier?: string;
  tierP?: Record<string, number>;
  effort?: string;
  risky?: number;
};

/** A parsed worker answer set, as `readWorkerOutcome` would return it. */
export function workerAnswers(p: WorkerPick = {}): Extract<WorkerAnswers, { kind: "read" }> {
  const tier = p.tier ?? "fast";
  const effort = p.effort ?? "low";
  return {
    kind: "read",
    unanswered: {},
    answers: {
      tier: { type: "choice", choice: tier, probabilities: p.tierP ?? { [tier]: 1 } },
      effort: { type: "choice", choice: effort, probabilities: { [effort]: 1 } },
      risky: { type: "noul", noul: p.risky ?? 0.1 },
    },
  };
}
