// Pure aggregation of replay results against noise, plus the private output files.
import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
import type { Plan, PlainConfig, PlannedRequest } from "./variants.ts";

export type Result = {
  variant: string;
  base: string;
  sample: number;
  kind: "main" | "worker";
  outcome: { kind: "ok"; body: unknown } | { kind: "miss"; miss: MissKind };
};

export type VariantAggregate = {
  base: string;
  requests: number;
  misses: number;
  excluded: number;
  flips: Record<string, number>;
  noise: Record<string, number>;
  beyond: string[];
};

export type Aggregates = {
  v: 1;
  runId: string;
  pass: 1 | 2;
  samples: { main: number; workers: number };
  skipped: string[];
  variants: Record<string, VariantAggregate>;
};

export type CompareMeta = {
  runId: string;
  pass: 1 | 2;
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

/** Aggregates key a worker variant by `worker:<id>`, because `rerun-a` and `rerun-b` exist in both kinds. */
export function variantKey(kind: "main" | "worker", id: string): string {
  return kind === "worker" ? `worker:${id}` : id;
}

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

function resultIndex(results: readonly Result[]): Map<string, Result> {
  return new Map(results.map((r) => [`${r.kind}\0${r.variant}\0${r.sample}`, r]));
}

function pairsOf(plan: Plan, results: readonly Result[], config: PlainConfig): Pair[] {
  const index = resultIndex(results);
  const decided = new Map<Result, Decided | undefined>();
  const reqs = new Map(plan.requests.map((r) => [`${r.kind}\0${r.variant}\0${r.sample}`, r]));
  const read = (kind: string, variant: string, sample: number): Decided | undefined => {
    const id = `${kind}\0${variant}\0${sample}`;
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

function emptyVariant(base: string, kind: "main" | "worker"): VariantAggregate {
  return {
    base,
    requests: 0,
    misses: 0,
    excluded: 0,
    flips: Object.fromEntries(KEYS[kind].map((k) => [k, 0])),
    noise: {},
    beyond: [],
  };
}

function isRerun(id: string): boolean {
  return id === "rerun-a" || id === "rerun-b";
}

function addNoise(variants: Record<string, VariantAggregate>, kind: "main" | "worker"): void {
  const a = variants[variantKey(kind, "rerun-a")];
  const b = variants[variantKey(kind, "rerun-b")];
  for (const [id, v] of Object.entries(variants)) {
    if (!isOfKind(id, kind) || isRerun(id.replace(/^worker:/, ""))) continue;
    for (const key of KEYS[kind]) {
      v.noise[key] = Math.max(a?.flips[key] ?? 0, b?.flips[key] ?? 0);
      if ((v.flips[key] ?? 0) > (v.noise[key] ?? 0)) v.beyond.push(key);
    }
  }
}

function isOfKind(id: string, kind: "main" | "worker"): boolean {
  return kind === "worker" ? id.startsWith("worker:") : !id.startsWith("worker:");
}

export function compare(plan: Plan, results: readonly Result[], meta: CompareMeta): Aggregates {
  const variants: Record<string, VariantAggregate> = {};
  for (const req of plan.requests) {
    const id = variantKey(req.kind, req.variant);
    const entry = (variants[id] ??= emptyVariant(variantKey(req.kind, req.base), req.kind));
    entry.requests++;
    entry.excluded = plan.excluded[req.variant] ?? 0;
  }
  for (const pair of pairsOf(plan, results, meta.config)) {
    const entry = variants[variantKey(pair.req.kind, pair.req.variant)];
    if (entry === undefined) continue;
    if (pair.own === undefined || pair.base === undefined) {
      entry.misses++;
      continue;
    }
    for (const key of KEYS[pair.req.kind]) {
      const mine = pair.own.keys[key];
      const theirs = pair.base.keys[key];
      if (mine !== undefined && theirs !== undefined && mine !== theirs) {
        entry.flips[key] = (entry.flips[key] ?? 0) + 1;
      }
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

function formatCases(cases: readonly DiffCase[]): string {
  const blocks = cases.map((c) =>
    [
      `## ${c.variant} / ${c.key}`,
      `- base: ${c.base} ${JSON.stringify(c.baseAnswer ?? null)}`,
      `- variant: ${c.value} ${JSON.stringify(c.answer ?? null)}`,
      "",
      "~~~~",
      c.text,
      "~~~~",
    ].join("\n"),
  );
  return `# Differing pairs\n\n${blocks.join("\n\n")}\n`;
}

/** Owner-only outputs. `aggregates.json` goes last, atomically, so it marks a finished run. */
export function writeOutputs(
  dir: string,
  aggregates: Aggregates,
  cases: readonly DiffCase[],
): void {
  const markdown = formatCases(cases);
  const json = `${JSON.stringify(aggregates, null, 2)}\n`;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const put = (name: string, content: string): void => {
    writeFileSync(join(dir, name), content, { mode: 0o600 });
    chmodSync(join(dir, name), 0o600);
  };
  put("cases.md", markdown);
  const temp = join(dir, "aggregates.json.tmp");
  try {
    writeFileSync(temp, json, { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, join(dir, "aggregates.json"));
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}
