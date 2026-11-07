import { describe, expect, test } from "bun:test";
import {
  compareReport,
  reportCases,
  type ReportMeta,
} from "../../scripts/replay/report-compare.ts";
import type { Result } from "../../scripts/replay/compare.ts";
import type { PlannedRequest, PlainConfig } from "../../scripts/replay/variants.ts";
import { workerQuestions } from "../../scripts/replay/variants.ts";
import { mainBody, mainReq, miss, ok, planOf } from "./helpers.ts";

const config: PlainConfig = {
  tiers: { fast: "a/b", balanced: "b/c", deep: "c/d", expert: "e/f" },
  slots: [{ name: "reviewer", model: "m/n", when: "for review" }],
  mode: "standard",
  expertOn: true,
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
  });

  test("start outside the levels counts as none; ties take the higher level", () => {
    const { plan, results } = mainRun(["low", "low", "low"]);
    const agg = compareReport(plan, results, metaOf({ startEffort: ["bogus", "low", "high"] }));
    expect(agg.main.report.vsStart).toEqual({ lowered: 1, same: 1, raised: 0 });
    expect(agg.main.report.vsFixed.level).toBe("high");
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
    const tiers = kinds.map((_, i) => (i < 3 || i === 4 ? "slot::reviewer" : "fast"));
    const { plan, results } = workerRun(tiers);
    const agg = compareReport(plan, results, metaOf({ workerKind: kinds }));
    const byKind = agg.workers.report.standard.slots.byKind;
    expect(byKind?.review["slot::reviewer"]).toBe(3);
    expect(byKind?.implementation["slot::reviewer"]).toBe(1);
    expect(agg.workers.report.standard.tiers.byKind).toBeUndefined();
    expect(Object.values(agg.workers.report.standard.slots.reasons).reduce((a, b) => a + b)).toBe(
      10,
    );
  });

  test("miss excluded from noise", () => {
    const { plan, results } = workerRun(["fast", "fast"], ["rerun:1"]);
    const agg = compareReport(plan, results, metaOf({ workerKind: ["scout", "scout"] }));
    expect(agg.misses["worker:rerun"]).toBe(1);
    expect(agg.misses["worker:report"]).toBe(0);
    expect(Object.values(agg.noise.workers.standard).every((n) => n === 0)).toBe(true);
    expect(agg.workers.rerun.standard.tiers.targets).toEqual({ fast: 1 });
  });

  test("a changed target counts as noise", () => {
    const { plan, results } = workerRun(["fast"]);
    const swapped = results.map((r) =>
      r.variant === "rerun"
        ? { ...r, outcome: { kind: "ok" as const, body: workerBody("deep") } }
        : r,
    );
    const agg = compareReport(plan, swapped, metaOf({ workerKind: ["scout"] }));
    expect(agg.noise.workers.standard.tiers).toBe(1);
  });

  test("all misses", () => {
    const main = mainRun(["low"]);
    const worker = workerRun(["fast"], ["report:0", "rerun:0"]);
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
    const { plan, results } = workerRun(["fast"]);
    const swapped = results.map((r) =>
      r.variant === "rerun"
        ? { ...r, outcome: { kind: "ok" as const, body: workerBody("deep") } }
        : r,
    );
    const cases = reportCases(plan, swapped, config, text);
    expect(cases.map((c) => c.key)).toContain("standard/tiers");
    expect(cases.every((c) => c.base !== c.value && c.variant === "rerun")).toBe(true);
  });
});
