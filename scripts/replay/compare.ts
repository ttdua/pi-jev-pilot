// Pure aggregation of replay results against noise. File output lives in outputs.ts.
import { cutCodePoints } from "../../src/shared/text.ts";
import type { Answer, MissKind } from "../../src/policy/answers.ts";
import { readAnswers } from "../../src/policy/answers.ts";
import {
  CORRECTION_THRESHOLD,
  decideEffort,
  EFFORT_LEVELS,
  type EffortLevel,
} from "../../src/policy/effort.ts";
import { isSlot, slotName, type EffectiveLaunch, type Target } from "../../src/policy/launch.ts";
import { routeLaunch } from "../../src/policy/route.ts";
import { readWorkerOutcome } from "../../src/policy/worker.ts";
import { offeredTiers } from "../../src/jev/questions.ts";
import {
  baseOfKey,
  variantKey,
  type Plan,
  type PlainConfig,
  type PlannedRequest,
} from "./variants.ts";

export type Result = {
  variant: string;
  base: string;
  sample: number;
  kind: "main" | "worker";
  outcome: { kind: "ok"; body: unknown } | { kind: "miss"; miss: MissKind };
};

export type VariantAggregate = {
  kind: "main" | "worker";
  base: string;
  requests: number;
  misses: number;
  excluded: number;
  flips: Record<string, number>;
  /** Decided keys absent on either side of a pair; neither a flip nor a miss. */
  incomparable: Record<string, number>;
  noise: Record<string, number>;
  beyond: string[];
};

export type Aggregates = {
  v: 1;
  runId: string;
  pass: 1;
  samples: { main: number; workers: number };
  skipped: string[];
  variants: Record<string, VariantAggregate>;
};

export type CompareMeta = {
  runId: string;
  pass: 1;
  samples: { main: number; workers: number };
  config: PlainConfig;
};

/** One differing pair on one key. Answers are raw, so `cases.md` can show the probabilities. */
export type DiffCase = {
  variant: string;
  key: string;
  base: string;
  value: string;
  baseAnswer: Answer | undefined;
  answer: Answer | undefined;
  text: string;
};

export const MAIN_KEYS = ["effort", "tier", "strategy", "risky", "corrects"] as const;
export const WORKER_KEYS = ["tier", "effort"] as const;
const KEYS = { main: MAIN_KEYS, worker: WORKER_KEYS } as const;
const CASE_TEXT_POINTS = 300;
const NONE = "none";

type Decided = { keys: Record<string, string>; answers: Record<string, Answer | undefined> };

function mainKeys(answers: Record<string, Answer>): Decided {
  const out: Record<string, string> = {};
  const effort = answers["effort"];
  const risky = answers["risky"];
  const corrects = answers["corrects"];
  if (effort?.type === "choice") {
    out["effort"] = decideEffort({
      choice: effort.choice as EffortLevel,
      ...(risky?.type === "noul" ? { risky: risky.noul } : {}),
      supported: EFFORT_LEVELS,
    }).requested;
  }
  for (const key of ["tier", "strategy"] as const) {
    const a = answers[key];
    if (a?.type === "choice") out[key] = a.choice;
  }
  if (risky?.type === "noul") out["risky"] = String(risky.noul > 0.7);
  if (corrects?.type === "noul") out["corrects"] = String(corrects.noul >= CORRECTION_THRESHOLD);
  return { keys: out, answers };
}

const REPLAY_LAUNCH = (runInBackground: boolean): EffectiveLaunch => ({
  resume: false,
  inheritContext: false,
  runInBackground,
  modelLocked: false,
  thinkingLocked: false,
});

function workerKeys(req: PlannedRequest, body: unknown, config: PlainConfig): Decided | undefined {
  const answers = readWorkerOutcome({ kind: "ok", body }, req.specs);
  if (answers.kind !== "read") return undefined;
  const modelOf = (t: Target): string =>
    isSlot(t)
      ? (config.slots.find((s) => s.name === slotName(t))?.model ?? "")
      : (config.tiers[t] ?? "");
  const route = routeLaunch({
    answers,
    launch: REPLAY_LAUNCH(runsInBackground(req)),
    offered: offeredTiers(config.tiers, config.expertOn),
    mode: config.mode,
    forkedLaunch: "untouched",
    canRun: () => true,
    thinkingOf: () => ({ reasoning: true }),
    modelOf,
    slots: config.slots.map((s) => s.name),
  });
  const record = route.kind === "routed" ? route.record : undefined;
  return {
    keys: { tier: record?.tier ?? NONE, effort: record?.effort ?? NONE },
    answers: answers.answers,
  };
}

function runsInBackground(req: PlannedRequest): boolean {
  const state = req.state as { agent?: { run_in_background?: unknown } } | null;
  return state?.agent?.run_in_background === true;
}

function decide(req: PlannedRequest, result: Result, config: PlainConfig): Decided | undefined {
  if (result.outcome.kind !== "ok") return undefined;
  if (req.kind === "worker") return workerKeys(req, result.outcome.body, config);
  const read = readAnswers(req.specs, result.outcome.body);
  return read.kind === "read" ? mainKeys(read.answers) : undefined;
}

type Pair = { req: PlannedRequest; own: Decided | undefined; base: Decided | undefined };

function pairId(kind: string, variant: string, sample: number): string {
  return `${kind}\0${variant}\0${sample}`;
}

function resultIndex(results: readonly Result[]): Map<string, Result> {
  return new Map(results.map((r) => [pairId(r.kind, r.variant, r.sample), r]));
}

function pairsOf(plan: Plan, results: readonly Result[], config: PlainConfig): Pair[] {
  const index = resultIndex(results);
  const decided = new Map<Result, Decided | undefined>();
  const reqs = new Map(plan.requests.map((r) => [pairId(r.kind, r.variant, r.sample), r]));
  const read = (kind: string, variant: string, sample: number): Decided | undefined => {
    const id = pairId(kind, variant, sample);
    const result = index.get(id);
    const req = reqs.get(id);
    if (result === undefined || req === undefined) return undefined;
    if (!decided.has(result)) decided.set(result, decide(req, result, config));
    return decided.get(result);
  };
  return plan.requests
    .filter((r) => r.variant !== r.base)
    .map((req) => ({
      req,
      own: read(req.kind, req.variant, req.sample),
      base: read(req.kind, req.base, req.sample),
    }));
}

function zeroed(kind: "main" | "worker"): Record<string, number> {
  return Object.fromEntries(KEYS[kind].map((k) => [k, 0]));
}

function emptyVariant(base: string, kind: "main" | "worker"): VariantAggregate {
  return {
    kind,
    base,
    requests: 0,
    misses: 0,
    excluded: 0,
    flips: zeroed(kind),
    incomparable: zeroed(kind),
    noise: {},
    beyond: [],
  };
}

function addNoise(variants: Record<string, VariantAggregate>, kind: "main" | "worker"): void {
  const a = variants[variantKey(kind, "rerun-a")];
  const b = variants[variantKey(kind, "rerun-b")];
  for (const [id, v] of Object.entries(variants)) {
    const isRerun = id === variantKey(kind, "rerun-a") || id === variantKey(kind, "rerun-b");
    if (v.kind !== kind || isRerun) continue;
    for (const key of KEYS[kind]) {
      v.noise[key] = Math.max(a?.flips[key] ?? 0, b?.flips[key] ?? 0);
      if ((v.flips[key] ?? 0) > (v.noise[key] ?? 0)) v.beyond.push(key);
    }
  }
}

function tally(plan: Plan): Record<string, VariantAggregate> {
  const variants: Record<string, VariantAggregate> = {};
  for (const req of plan.requests) {
    const id = variantKey(req.kind, req.variant);
    const entry = (variants[id] ??= emptyVariant(variantKey(req.kind, req.base), req.kind));
    entry.requests++;
    entry.excluded = plan.excluded[id] ?? 0;
  }
  for (const [id, excluded] of Object.entries(plan.excluded)) {
    if (variants[id] !== undefined) continue;
    const { kind, base } = baseOfKey(id);
    variants[id] = { ...emptyVariant(base, kind), excluded };
  }
  return variants;
}

/** Misses of base requests count under the base variant's own aggregate. */
function countBaseMisses(
  plan: Plan,
  results: readonly Result[],
  config: PlainConfig,
  variants: Record<string, VariantAggregate>,
): void {
  const index = resultIndex(results);
  for (const req of plan.requests) {
    if (req.variant !== req.base) continue;
    const result = index.get(pairId(req.kind, req.variant, req.sample));
    const entry = variants[variantKey(req.kind, req.variant)];
    if (
      entry !== undefined &&
      (result === undefined || decide(req, result, config) === undefined)
    ) {
      entry.misses++;
    }
  }
}

function countPair(entry: VariantAggregate, pair: Pair & { own: Decided; base: Decided }): void {
  for (const key of KEYS[pair.req.kind]) {
    const mine = pair.own.keys[key];
    const theirs = pair.base.keys[key];
    if (mine === undefined || theirs === undefined) {
      entry.incomparable[key] = (entry.incomparable[key] ?? 0) + 1;
    } else if (mine !== theirs) {
      entry.flips[key] = (entry.flips[key] ?? 0) + 1;
    }
  }
}

export function compare(plan: Plan, results: readonly Result[], meta: CompareMeta): Aggregates {
  const variants = tally(plan);
  countBaseMisses(plan, results, meta.config, variants);
  for (const pair of pairsOf(plan, results, meta.config)) {
    const entry = variants[variantKey(pair.req.kind, pair.req.variant)];
    if (entry === undefined) continue;
    if (pair.own === undefined || pair.base === undefined) {
      entry.misses++;
    } else {
      countPair(entry, { ...pair, own: pair.own, base: pair.base });
    }
  }
  addNoise(variants, "main");
  addNoise(variants, "worker");
  return {
    v: 1,
    runId: meta.runId,
    pass: meta.pass,
    samples: meta.samples,
    skipped: [...plan.skipped],
    variants,
  };
}

/** Every differing (pair, key), with the prompt or brief the pair was asked about. */
export function diffCases(
  plan: Plan,
  results: readonly Result[],
  config: PlainConfig,
  sampleText: (kind: "main" | "worker", sample: number) => string,
): DiffCase[] {
  const cases: DiffCase[] = [];
  for (const { req, own, base } of pairsOf(plan, results, config)) {
    if (own === undefined || base === undefined) continue;
    for (const key of KEYS[req.kind]) {
      const value = own.keys[key];
      const was = base.keys[key];
      if (value === undefined || was === undefined || value === was) continue;
      cases.push({
        variant: variantKey(req.kind, req.variant),
        key,
        base: was,
        value,
        baseAnswer: base.answers[key],
        answer: own.answers[key],
        text: cutCodePoints(sampleText(req.kind, req.sample), CASE_TEXT_POINTS),
      });
    }
  }
  return cases;
}
