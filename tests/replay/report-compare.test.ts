import { describe, expect, test } from "bun:test";
import {
  compareReport,
  reportCases,
  type ReportMeta,
  type SerializedCut,
} from "../../scripts/replay/report-compare.ts";
import type { Result } from "../../scripts/replay/compare.ts";
import type { PlannedRequest, PlainConfig } from "../../scripts/replay/variants.ts";
import { difficultyScore } from "../../src/policy/worker/score.ts";
import { cutPoints } from "../../src/policy/worker/cutpoints.ts";
import { MODE_TARGETS } from "../../src/policy/worker/modes.ts";
import { workerQuestions } from "../../scripts/replay/variants.ts";
import { mainBody, mainReq, miss, ok, planOf } from "./helpers.ts";

const config: PlainConfig = {
  tiers: { basic: "a/b", broad: "b/c", deep: "c/d", frontier: "e/f" },
  slots: [{ name: "reviewer", model: "m/n", when: "for review" }],
  mode: "standard",
  frontierOn: true,
};
const VARIANTS = ["report", "rerun"] as const;
const { questions, specs } = workerQuestions(config);

const workerReq = (variant: string, sample: number): PlannedRequest => ({
  variant,
  base: "report",
  sample,
  kind: "worker",
  state: { agent: { run_in_background: false } },
  questions,
  specs,
});
const workerBody = (tier: string) => {
  const spec = specs["tier"];
  const options = spec?.type === "choice" ? spec.options : [];
  const effort = specs["effort"];
  const levels = effort?.type === "choice" ? effort.options : [];
  const choice = (opts: readonly string[], pick: string) => ({
    type: "choice",
    choice: pick,
    probabilities: Object.fromEntries(opts.map((o) => [o, o === pick ? 1 : 0])),
  });
  return {
    answers: {
      tier: choice(options, tier),
      effort: choice(levels, levels[0] ?? "low"),
      risky: { type: "noul", noul: 0.1 },
    },
  };
};
const metaOf = (over: Partial<ReportMeta> = {}): ReportMeta => ({
  runId: "r",
  samples: { main: 0, workers: 0 },
  config,
  startEffort: [],
  workerKind: [],
  ...over,
});

/** A main plan with `efforts[i]` decided in both variants (rerun may differ). */
function mainRun(report: string[], rerun: string[] = report) {
  const requests: PlannedRequest[] = [];
  const results: Result[] = [];
  for (const [variant, efforts] of [
    ["report", report],
    ["rerun", rerun],
  ] as const) {
    efforts.forEach((e, i) => {
      const r = mainReq(variant, "report", i);
      requests.push(r);
      results.push(ok(r, mainBody({ effort: e })));
    });
  }
  return { plan: planOf(requests), results };
}

/** Worker plan: `tiers[i]` answered in both variants; `missing` names variant:sample misses. */
function workerRun(tiers: string[], missing: string[] = []) {
  const requests: PlannedRequest[] = [];
  const results: Result[] = [];
  for (const variant of VARIANTS) {
    tiers.forEach((t, i) => {
      const r = workerReq(variant, i);
      requests.push(r);
      results.push(missing.includes(`${variant}:${i}`) ? miss(r) : ok(r, workerBody(t)));
    });
  }
  return { plan: planOf(requests), results };
}

// Candidates come from the run's own answers, so a changed answer needs other samples to differ from.
const withFiller = (first: string) => [
  first,
  ...Array.from({ length: 20 }, (_, i) => ["basic", "broad", "deep", "frontier"][i % 4] ?? "basic"),
];
/** Sample 0 of the rerun variant answers `deep`. */
const swapRerun0 = (results: Result[]) =>
  results.map((r) =>
    r.variant === "rerun" && r.sample === 0
      ? { ...r, outcome: { kind: "ok" as const, body: workerBody("deep") } }
      : r,
  );

describe("compareReport main", () => {
  test("effort against start", () => {
    const { plan, results } = mainRun(["medium", "high", "xhigh"]);
    const agg = compareReport(
      plan,
      results,
      metaOf({
        startEffort: ["high", "high", "high"],
        samples: { main: 3, workers: 0 },
      }),
    );
    const want = { lowered: 0, same: 1, raised: 2 };
    expect(agg.main.report.vsStart).toEqual({ ...want, lowered: 1, raised: 1 });
    expect(agg.main.report.vsFixed).toEqual({
      level: "high",
      lowered: 1,
      same: 1,
      raised: 1,
    });
    expect(agg.main.report.effort).toEqual({ medium: 1, high: 1, xhigh: 1 });
  });

  test("no start effort", () => {
    const { plan, results } = mainRun(["high", "low"]);
    const agg = compareReport(plan, results, metaOf({ startEffort: [undefined, "low"] }));
    expect(agg.main.report.effort).toEqual({ low: 1, high: 1 });
    expect(agg.main.report.vsStart).toEqual({ lowered: 0, same: 1, raised: 0 });
    expect(agg.main.report.vsFixed).toEqual({ level: "low", lowered: 0, same: 1, raised: 0 });
  });

  test("start outside the levels counts as none; ties take the higher level", () => {
    const { plan, results } = mainRun(["low", "low", "low"]);
    const agg = compareReport(plan, results, metaOf({ startEffort: ["bogus", "low", "high"] }));
    expect(agg.main.report.vsStart).toEqual({ lowered: 1, same: 1, raised: 0 });
    expect(agg.main.report.vsFixed).toEqual({ level: "high", lowered: 2, same: 0, raised: 0 });
  });

  test("no start at all gives a null fixed level", () => {
    const { plan, results } = mainRun(["low"]);
    const agg = compareReport(plan, results, metaOf());
    expect(agg.main.report.vsFixed).toEqual({
      level: null,
      lowered: 0,
      same: 0,
      raised: 0,
    });
  });
});

describe("compareReport workers", () => {
  const kinds = [
    ...Array<"review">(4).fill("review"),
    ...Array<"implementation">(6).fill("implementation"),
  ];
  test("reviewer share by kind", () => {
    const tiers = kinds.map((_, i) => (i < 3 || i === 4 ? "slot::reviewer" : "basic"));
    const { plan, results } = workerRun(tiers);
    const agg = compareReport(plan, results, metaOf({ workerKind: kinds }));
    const byKind = agg.workers.report.standard.slots.byKind;
    expect(byKind?.review["slot::reviewer"]).toBe(3);
    expect(byKind?.implementation["slot::reviewer"]).toBe(1);
    const keys = Object.values(byKind ?? {}).flatMap((c) => Object.keys(c));
    expect(keys.every((k) => k.startsWith("slot::"))).toBe(true);
    expect(agg.workers.report.standard.tiers.byKind).toBeUndefined();
    expect(Object.values(agg.workers.report.standard.slots.reasons).reduce((a, b) => a + b)).toBe(
      10,
    );
  });

  test("a worker without a known kind is left out of byKind", () => {
    const { plan, results } = workerRun(["slot::reviewer", "slot::reviewer"]);
    const agg = compareReport(plan, results, metaOf({ workerKind: ["review"] }));
    const byKind = agg.workers.report.standard.slots.byKind;
    expect(byKind?.review["slot::reviewer"]).toBe(1);
    expect(byKind?.implementation["slot::reviewer"]).toBeUndefined();
  });

  test("miss excluded from noise", () => {
    const { plan, results } = workerRun(["basic", "basic"], ["rerun:1"]);
    const agg = compareReport(plan, results, metaOf({ workerKind: ["scout", "scout"] }));
    expect(agg.misses["worker:rerun"]).toBe(1);
    expect(agg.misses["worker:report"]).toBe(0);
    expect(Object.values(agg.noise.workers.standard).every((n) => n === 0)).toBe(true);
    expect(agg.workers.rerun.standard.tiers.targets).toEqual({ basic: 1 });
  });

  test("a changed target counts as noise", () => {
    const { plan, results } = workerRun(withFiller("basic"));
    const agg = compareReport(plan, swapRerun0(results), metaOf({ workerKind: ["scout"] }));
    expect(agg.noise.workers.standard.tiers).toBeGreaterThan(0);
  });

  test("all misses", () => {
    const main = mainRun(["low"]);
    const worker = workerRun(["basic"], ["report:0", "rerun:0"]);
    const plan = planOf([...main.plan.requests, ...worker.plan.requests]);
    const results = [...main.plan.requests.map(miss), ...worker.plan.requests.map(miss)];
    const agg = compareReport(
      plan,
      results,
      metaOf({ workerKind: ["scout"], startEffort: ["low"] }),
    );
    expect(agg.main.report.effort).toEqual({});
    expect(agg.main.rerun.vsStart).toEqual({ lowered: 0, same: 0, raised: 0 });
    expect(agg.workers.report.budget.slots.targets).toEqual({});
    expect(agg.workers.report.budget.slots.reasons).toEqual({});
    expect(agg.noise.mainEffort).toBe(0);
    expect(Object.values(agg.noise.workers.premium)).toEqual([0, 0]);
    expect(agg.misses).toEqual({
      report: 1,
      rerun: 1,
      "worker:report": 1,
      "worker:rerun": 1,
    });
  });
});

describe("seed candidates", () => {
  // Worker i answers a tier by i % 4; scores spread over 0..3.
  const tierOf = (i: number) => ["basic", "broad", "deep", "frontier"][i % 4] ?? "basic";
  const run = (n: number, missing: string[] = []) => {
    const { plan, results } = workerRun(
      Array.from({ length: n }, (_, i) => tierOf(i)),
      missing,
    );
    return compareReport(plan, results, metaOf({ workerKind: Array(n).fill("scout") }));
  };
  const scoresOf = (n: number, skip: number[] = []) =>
    Array.from({ length: n }, (_, i) => i)
      .filter((i) => !skip.includes(i))
      .map((i) => ({
        score: difficultyScore(workerBody(tierOf(i)).answers as never) as number,
        decided: "basic" as const,
      }));
  const ser = (n: number): SerializedCut =>
    n === Infinity ? "Infinity" : n === -Infinity ? "-Infinity" : n;
  const expected = (
    entries: ReturnType<typeof scoresOf>,
    mode: "budget" | "standard" | "premium",
  ) => {
    const c = cutPoints(entries, MODE_TARGETS[mode]);
    return {
      basicMax: ser(c.basicMax),
      broadMax: ser(c.broadMax),
      frontierMin: ser(c.frontierMin),
    };
  };

  test("candidate per mode", () => {
    const agg = run(120);
    const entries = scoresOf(120);
    for (const v of ["report", "rerun"] as const)
      for (const m of ["budget", "standard", "premium"] as const)
        expect(agg.seedCandidates[v][m]).toEqual(expected(entries, m));
  });

  test("budget candidate has no frontier", () => {
    const agg = run(120);
    expect(agg.seedCandidates.report.budget.frontierMin).toBe("Infinity");
    expect(agg.seedCandidates.report.premium.basicMax).toBe("-Infinity");
    // Survives a JSON round trip as strings.
    const back = JSON.parse(JSON.stringify(agg.seedCandidates));
    expect(back.report.budget.frontierMin).toBe("Infinity");
  });

  test("misses left out", () => {
    const skip = [3, 17, 40, 41, 99];
    const agg = run(
      120,
      skip.map((i) => `report:${i}`),
    );
    expect(agg.seedCandidates.report.standard).toEqual(expected(scoresOf(120, skip), "standard"));
    // The other variant keeps all 120 answers.
    expect(agg.seedCandidates.rerun.standard).toEqual(expected(scoresOf(120), "standard"));
    // Literals that differ between 115 and 120 scores (counts 29/28/30/28 vs 30 each).
    expect(agg.seedCandidates.report.budget.basicMax).toBe(2);
    expect(agg.seedCandidates.rerun.budget.basicMax).toBe(1);
    expect(agg.seedCandidates.report.premium.broadMax).toBe(2);
    expect(agg.seedCandidates.rerun.premium.broadMax).toBe(1);
  });

  test("no main tier key", () => {
    const { plan, results } = mainRun(["low"]);
    const body = mainBody({ effort: "low" }) as { answers: Record<string, unknown> };
    expect(Object.keys(body.answers)).not.toContain("tier");
    const agg = compareReport(plan, results, metaOf());
    expect(JSON.stringify(agg.main)).not.toContain("tier");
  });
});

describe("reportCases", () => {
  const text = (_k: "main" | "worker", s: number) => "é".repeat(400) + s;

  test("cases list only differing samples", () => {
    const { plan, results } = mainRun(["low", "high"], ["high", "high"]);
    const cases = reportCases(plan, results, config, text);
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      variant: "rerun",
      key: "effort",
      base: "low",
      value: "high",
    });
    expect([...(cases[0]?.text ?? "")]).toHaveLength(300);
    expect(cases[0]?.baseAnswer?.type).toBe("choice");
  });

  test("worker cases are keyed by mode and routing", () => {
    const { plan, results } = workerRun(withFiller("basic"));
    const cases = reportCases(plan, swapRerun0(results), config, text);
    expect(cases.map((c) => c.key)).toContain("standard/tiers");
    expect(cases.every((c) => c.base !== c.value && c.variant === "rerun")).toBe(true);
  });
});
