// Pure aggregation of the report pass: the run against its plain rerun. File output lives in outputs.ts.
import type { Answer } from "../../src/policy/answers.ts";
import { EFFORT_LEVELS } from "../../src/policy/effort.ts";
import type { ModeName } from "../../src/policy/modes.ts";
import { readWorkerOutcome, type WorkerAnswers } from "../../src/policy/worker.ts";
import { cutCodePoints } from "../../src/shared/text.ts";
import { decide, runsInBackground, type DiffCase, type Result } from "./compare.ts";
import { REPORT_MODES, routeStreamRecords, type Routing } from "./report-route.ts";
import { variantKey, type Plan, type PlainConfig, type PlannedRequest } from "./variants.ts";

type Counts = Record<string, number>;
type Kind = "review" | "scout" | "implementation";

export type ReportAggregates = {
  v: 1;
  pass: "report";
  runId: string;
  samples: { main: number; workers: number };
  skipped: string[];
  excluded: Record<string, number>;
  misses: Record<string, number>;
  main: Record<
    "report" | "rerun",
    {
      effort: Counts;
      vsStart: { lowered: number; same: number; raised: number };
      vsFixed: {
        level: string | null;
        lowered: number;
        same: number;
        raised: number;
      };
    }
  >;
  workers: Record<
    "report" | "rerun",
    Record<
      ModeName,
      Record<Routing, { targets: Counts; reasons: Counts; byKind?: Record<Kind, Counts> }>
    >
  >;
  noise: {
    mainEffort: number;
    workers: Record<ModeName, Record<Routing, number>>;
  };
};

export type ReportMeta = {
  runId: string;
  samples: { main: number; workers: number };
  config: PlainConfig;
  startEffort: readonly (string | undefined)[];
  workerKind: readonly Kind[];
};

const VARIANTS = ["report", "rerun"] as const;
type Variant = (typeof VARIANTS)[number];
const ROUTINGS = ["slots", "tiers"] as const;

const CASE_TEXT_POINTS = 300;

type ReadWorker = Extract<WorkerAnswers, { kind: "read" }>;
type MainRead = { effort: string | undefined; answer: Answer | undefined };
/** One variant's reads, indexed by sample; `undefined` for a miss or an unplanned sample. */
type Side = {
  main: (MainRead | undefined)[];
  workers: (ReadWorker | undefined)[];
  background: boolean[];
};
type Targets = { target: string; reason: string };

const pairId = (kind: string, variant: string, sample: number): string =>
  `${kind}\0${variant}\0${sample}`;

function readMain(req: PlannedRequest, result: Result | undefined, config: PlainConfig) {
  const decided = result === undefined ? undefined : decide(req, result, config);
  if (decided === undefined) return undefined;
  return { effort: decided.keys["effort"], answer: decided.answers["effort"] };
}

function readWorker(req: PlannedRequest, result: Result | undefined): ReadWorker | undefined {
  if (result?.outcome.kind !== "ok") return undefined;
  const read = readWorkerOutcome({ kind: "ok", body: result.outcome.body }, req.specs);
  return read.kind === "read" ? read : undefined;
}

function sideOf(plan: Plan, results: readonly Result[], config: PlainConfig, v: Variant): Side {
  const index = new Map(results.map((r) => [pairId(r.kind, r.variant, r.sample), r]));
  const side: Side = { main: [], workers: [], background: [] };
  for (const req of plan.requests) {
    if (req.variant !== v) continue;
    const result = index.get(pairId(req.kind, req.variant, req.sample));
    if (req.kind === "main") {
      side.main[req.sample] = readMain(req, result, config);
    } else {
      side.workers[req.sample] = readWorker(req, result);
      side.background[req.sample] = runsInBackground(req);
    }
  }
  return side;
}

function bump(counts: Counts, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

/** Plain-integer misses per variant key; a request is a miss when it has no readable answer. */
function tallyMisses(plan: Plan, results: readonly Result[], config: PlainConfig) {
  const index = new Map(results.map((r) => [pairId(r.kind, r.variant, r.sample), r]));
  const misses: Counts = {};
  for (const req of plan.requests) {
    const key = variantKey(req.kind, req.variant);
    misses[key] ??= 0;
    const result = index.get(pairId(req.kind, req.variant, req.sample));
    const read = req.kind === "main" ? readMain(req, result, config) : readWorker(req, result);
    if (read === undefined) misses[key]++;
  }
  return misses;
}

function levelIndex(level: string | undefined): number {
  return level === undefined ? -1 : EFFORT_LEVELS.findIndex((l) => l === level);
}

type Direction = { lowered: number; same: number; raised: number };

function addDirection(d: Direction, decided: number, start: number): void {
  if (decided < start) d.lowered++;
  else if (decided > start) d.raised++;
  else d.same++;
}

/** The most common valid start level; ties go to the higher level. */
function fixedLevel(startEffort: readonly (string | undefined)[]): string | null {
  const counts = new Map<number, number>();
  for (const s of startEffort) {
    const i = levelIndex(s);
    if (i >= 0) counts.set(i, (counts.get(i) ?? 0) + 1);
  }
  let best = -1;
  for (const [i, n] of counts) {
    if (best < 0 || n > (counts.get(best) ?? 0) || (n === counts.get(best) && i > best)) best = i;
  }
  return best < 0 ? null : (EFFORT_LEVELS[best] ?? null);
}

function tallyMain(side: Side, startEffort: readonly (string | undefined)[]) {
  const fixed = fixedLevel(startEffort);
  const out = {
    effort: {} as Counts,
    vsStart: { lowered: 0, same: 0, raised: 0 },
    vsFixed: { level: fixed, lowered: 0, same: 0, raised: 0 },
  };
  side.main.forEach((m, i) => {
    const decided = levelIndex(m?.effort);
    if (m?.effort === undefined || decided < 0) return;
    bump(out.effort, m.effort);
    const start = levelIndex(startEffort[i]);
    if (start >= 0) addDirection(out.vsStart, decided, start);
    if (fixed !== null) addDirection(out.vsFixed, decided, levelIndex(fixed));
  });
  return out;
}

function routeSide(side: Side, config: PlainConfig, mode: ModeName, routing: Routing) {
  return routeStreamRecords(side.workers, {
    config,
    mode,
    routing,
    background: side.background,
  });
}

function tallyWorkers(routed: (Targets | undefined)[], kinds: readonly Kind[], withKinds: boolean) {
  const out: {
    targets: Counts;
    reasons: Counts;
    byKind?: Record<Kind, Counts>;
  } = {
    targets: {},
    reasons: {},
  };
  if (withKinds) out.byKind = { review: {}, scout: {}, implementation: {} };
  routed.forEach((r, i) => {
    if (r === undefined) return;
    bump(out.targets, r.target);
    bump(out.reasons, r.reason);
    const counts = out.byKind?.[kinds[i] ?? "implementation"];
    if (counts !== undefined) bump(counts, r.target);
  });
  return out;
}

function differing<T>(a: readonly (T | undefined)[], b: readonly (T | undefined)[]): number[] {
  const out: number[] = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== undefined && b[i] !== undefined && a[i] !== b[i]) out.push(i);
  }
  return out;
}

function perModeRouting<T>(f: (mode: ModeName, routing: Routing) => T) {
  return Object.fromEntries(
    REPORT_MODES.map((m) => [m, Object.fromEntries(ROUTINGS.map((r) => [r, f(m, r)]))]),
  ) as Record<ModeName, Record<Routing, T>>;
}

export function compareReport(
  plan: Plan,
  results: readonly Result[],
  meta: ReportMeta,
): ReportAggregates {
  const sides = {
    report: sideOf(plan, results, meta.config, "report"),
    rerun: sideOf(plan, results, meta.config, "rerun"),
  };
  const routed = {
    report: perModeRouting((m, r) => routeSide(sides.report, meta.config, m, r)),
    rerun: perModeRouting((m, r) => routeSide(sides.rerun, meta.config, m, r)),
  };
  const workers = (v: Variant) =>
    perModeRouting((m, r) => tallyWorkers(routed[v][m][r], meta.workerKind, r === "slots"));
  return {
    v: 1,
    pass: "report",
    runId: meta.runId,
    samples: meta.samples,
    skipped: [...plan.skipped],
    excluded: { ...plan.excluded },
    misses: tallyMisses(plan, results, meta.config),
    main: {
      report: tallyMain(sides.report, meta.startEffort),
      rerun: tallyMain(sides.rerun, meta.startEffort),
    },
    workers: { report: workers("report"), rerun: workers("rerun") },
    noise: {
      mainEffort: differing(
        sides.report.main.map((m) => m?.effort),
        sides.rerun.main.map((m) => m?.effort),
      ).length,
      workers: perModeRouting(
        (m, r) =>
          differing(
            routed.report[m][r].map((x) => x?.target),
            routed.rerun[m][r].map((x) => x?.target),
          ).length,
      ),
    },
  };
}

/** Every sample whose decision differs between the run and its rerun. */
export function reportCases(
  plan: Plan,
  results: readonly Result[],
  config: PlainConfig,
  sampleText: (kind: "main" | "worker", sample: number) => string,
): DiffCase[] {
  const report = sideOf(plan, results, config, "report");
  const rerun = sideOf(plan, results, config, "rerun");
  const cases: DiffCase[] = [];
  const add = (kind: "main" | "worker", sample: number, c: Omit<DiffCase, "variant" | "text">) =>
    cases.push({
      variant: "rerun",
      text: cutCodePoints(sampleText(kind, sample), CASE_TEXT_POINTS),
      ...c,
    });
  for (const i of differing(
    report.main.map((m) => m?.effort),
    rerun.main.map((m) => m?.effort),
  )) {
    add("main", i, {
      key: "effort",
      base: report.main[i]?.effort ?? "",
      value: rerun.main[i]?.effort ?? "",
      baseAnswer: report.main[i]?.answer,
      answer: rerun.main[i]?.answer,
    });
  }
  for (const mode of REPORT_MODES) {
    for (const routing of ROUTINGS) {
      const was = routeSide(report, config, mode, routing);
      const now = routeSide(rerun, config, mode, routing);
      for (const i of differing(
        was.map((x) => x?.target),
        now.map((x) => x?.target),
      )) {
        add("worker", i, {
          key: `${mode}/${routing}`,
          base: was[i]?.target ?? "",
          value: now[i]?.target ?? "",
          baseAnswer: report.workers[i]?.answers["tier"],
          answer: rerun.workers[i]?.answers["tier"],
        });
      }
    }
  }
  return cases;
}
