import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compare, diffCases, type Result } from "../../scripts/replay/compare.ts";
import { writeOutputs } from "../../scripts/replay/outputs.ts";
import { buildWorkerQuestions } from "../../src/jev/questions.ts";
import type { PlannedRequest } from "../../scripts/replay/variants.ts";
import { config, mainBody, mainReq, MARKER, miss, ok, planOf } from "./helpers.ts";

const meta = { runId: "r", pass: 1 as const, samples: { main: 1, workers: 0 }, config };

/** `n` samples: base `min`, variants flip strategy on the first `flips[v]` samples. */
function flipPlan(flips: Record<string, number>, n = 15) {
  const requests: PlannedRequest[] = [];
  const results: Result[] = [];
  for (let s = 0; s < n; s++) {
    const b = mainReq("minimal", "minimal", s);
    requests.push(b);
    results.push(ok(b, mainBody({ strategy: "direct" })));
    for (const [v, count] of Object.entries(flips)) {
      const r = mainReq(v, "minimal", s);
      requests.push(r);
      results.push(ok(r, mainBody({ strategy: s < count ? "graph" : "direct" })));
    }
  }
  return { plan: planOf(requests), results };
}

describe("compare", () => {
  test("within noise", () => {
    const { plan, results } = flipPlan({ "rerun-a": 2, "rerun-b": 4, full: 3 });
    const v = compare(plan, results, meta).variants["full"];
    expect(v?.flips["strategy"]).toBe(3);
    expect(v?.noise["strategy"]).toBe(4);
    expect(v?.beyond).not.toContain("strategy");
  });

  test("beyond noise", () => {
    const { plan, results } = flipPlan({ "rerun-a": 1, "rerun-b": 2, full: 12 });
    const v = compare(plan, results, meta).variants["full"];
    expect(v?.flips["strategy"]).toBe(12);
    expect(v?.beyond).toEqual(["strategy"]);
  });

  test("effort key is decided, risky lifts low to high", () => {
    const b = mainReq("minimal", "minimal", 0);
    const v = mainReq("full", "minimal", 0);
    const res = [
      ok(b, mainBody({ effort: "low" })),
      ok(v, mainBody({ effort: "low", risky: 0.9 })),
    ];
    const agg = compare(planOf([b, v]), res, meta);
    expect(agg.variants["full"]?.flips["effort"]).toBe(1);
    expect(agg.variants["full"]?.flips["risky"]).toBe(1);
  });

  test("miss on either side excludes the pair and counts for the variant", () => {
    const b0 = mainReq("minimal", "minimal", 0);
    const v0 = mainReq("full", "minimal", 0);
    const b1 = mainReq("minimal", "minimal", 1);
    const v1 = mainReq("full", "minimal", 1);
    const res = [ok(b0, mainBody()), miss(v0), miss(b1), ok(v1, mainBody({ strategy: "graph" }))];
    const v = compare(planOf([b0, v0, b1, v1]), res, meta).variants["full"];
    expect(v?.misses).toBe(2);
    expect(Object.values(v?.flips ?? {}).every((n) => n === 0)).toBe(true);
  });

  test("exclusions and skips are copied", () => {
    const b = mainReq("minimal", "minimal", 0);
    const plan = planOf([b, mainReq("+git", "minimal", 0)], {
      skipped: ["capabilities"],
      excluded: { "+git": 3 },
    });
    const agg = compare(plan, [ok(b, mainBody())], meta);
    expect(agg.skipped).toEqual(["capabilities"]);
    expect(agg.variants["+git"]?.excluded).toBe(3);
  });

  test("a variant excluded for every sample still gets an entry", () => {
    const b = mainReq("minimal", "minimal", 0);
    const plan = planOf([b], { excluded: { "+git": 2, "worker:no-instructions": 3 } });
    const agg = compare(plan, [ok(b, mainBody())], meta);
    expect(agg.variants["+git"]).toMatchObject({
      kind: "main",
      base: "minimal",
      requests: 0,
      excluded: 2,
    });
    expect(agg.variants["worker:no-instructions"]).toMatchObject({
      kind: "worker",
      base: "worker:base",
      requests: 0,
      excluded: 3,
    });
  });

  test("main and worker variants sharing an id keep separate excluded counts", () => {
    const mb = mainReq("minimal", "minimal", 0);
    const mr = mainReq("rerun-a", "minimal", 0);
    const wb = { ...mainReq("base", "base", 0), kind: "worker" as const };
    const wr = { ...mainReq("rerun-a", "base", 0), kind: "worker" as const };
    const plan = planOf([mb, mr, wb, wr], {
      excluded: { "rerun-a": 1, "worker:rerun-a": 4 },
    });
    const agg = compare(plan, [], meta);
    expect(agg.variants["rerun-a"]?.excluded).toBe(1);
    expect(agg.variants["worker:rerun-a"]?.excluded).toBe(4);
  });

  test("base misses count under the base variant, with kind", () => {
    const b0 = mainReq("minimal", "minimal", 0);
    const b1 = mainReq("minimal", "minimal", 1);
    const agg = compare(planOf([b0, b1]), [miss(b0), ok(b1, mainBody())], meta);
    expect(agg.variants["minimal"]?.requests).toBe(2);
    expect(agg.variants["minimal"]?.misses).toBe(1);
    expect(agg.variants["minimal"]?.kind).toBe("main");
  });

  test("a key absent on one side is counted as incomparable", () => {
    const b = mainReq("minimal", "minimal", 0);
    const v = mainReq("full", "minimal", 0);
    const body = mainBody() as { answers: Record<string, unknown> };
    delete body.answers["corrects"];
    const agg = compare(planOf([b, v]), [ok(b, mainBody()), ok(v, body)], meta);
    expect(agg.variants["full"]?.incomparable["corrects"]).toBe(1);
    expect(agg.variants["full"]?.incomparable["strategy"]).toBe(0);
    expect(agg.variants["full"]?.flips["corrects"]).toBe(0);
  });

  test("worker keys from routeLaunch", () => {
    const { questions, specs } = buildWorkerQuestions(["fast", "deep"], {}, "standard", []);
    const req = (variant: string): PlannedRequest => ({
      variant,
      base: "base",
      sample: 0,
      kind: "worker",
      state: { agent: { run_in_background: false } },
      questions,
      specs,
    });
    const answer = (tier: string, effort: string) => ({
      answers: {
        tier: {
          type: "choice",
          choice: tier,
          probabilities: { fast: tier === "fast" ? 0.9 : 0.1, deep: tier === "deep" ? 0.9 : 0.1 },
        },
        effort: {
          type: "choice",
          choice: effort,
          probabilities: Object.fromEntries(
            (specs["effort"]?.type === "choice" ? specs["effort"].options : []).map((o) => [
              o,
              o === effort ? 0.9 : 0.025,
            ]),
          ),
        },
        risky: { type: "noul", noul: 0.1 },
      },
    });
    const base = req("base");
    const alt = req("no-description");
    const effort = specs["effort"]?.type === "choice" ? (specs["effort"].options[0] ?? "") : "";
    const agg = compare(
      planOf([base, alt]),
      [ok(base, answer("fast", effort)), ok(alt, answer("deep", effort))],
      meta,
    );
    const v = agg.variants["worker:no-description"];
    expect(v?.flips["tier"]).toBe(1);
    expect(v?.flips["effort"]).toBe(0);
  });
});

describe("writeOutputs", () => {
  const made = () => {
    const b = mainReq("minimal", "minimal", 0);
    const v = mainReq("full", "minimal", 0);
    const plan = planOf([b, v]);
    const results = [ok(b, mainBody()), ok(v, mainBody({ strategy: "graph" }))];
    const agg = compare(plan, results, meta);
    const cases = diffCases(plan, results, config, (_k, s) => `${MARKER} ${s}`);
    return { agg, cases };
  };

  test("aggregates hold no text, cases do", () => {
    const { agg, cases } = made();
    expect(cases.length).toBe(1);
    const dir = join(mkdtempSync(join(tmpdir(), "out-")), "run");
    writeOutputs(dir, agg, cases);
    expect(readFileSync(join(dir, "aggregates.json"), "utf8")).not.toContain(MARKER);
    expect(readFileSync(join(dir, "cases.md"), "utf8")).toContain(MARKER);
  });

  test("owner-only outputs", () => {
    const { agg, cases } = made();
    const dir = join(mkdtempSync(join(tmpdir(), "out-")), "run");
    writeOutputs(dir, agg, cases);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    for (const f of ["aggregates.json", "cases.md"]) {
      expect(statSync(join(dir, f)).mode & 0o777).toBe(0o600);
    }
    expect(existsSync(join(dir, "aggregates.json.tmp"))).toBe(false);
  });

  test("case text is cut at 300 code points", () => {
    const b = mainReq("minimal", "minimal", 0);
    const v = mainReq("full", "minimal", 0);
    const plan = planOf([b, v]);
    const results = [ok(b, mainBody()), ok(v, mainBody({ strategy: "graph" }))];
    const [c] = diffCases(plan, results, config, () => "😀".repeat(400));
    expect(Array.from(c?.text ?? "").length).toBe(300);
  });
});
