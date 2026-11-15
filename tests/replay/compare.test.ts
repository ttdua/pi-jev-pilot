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
    const { questions, specs } = buildWorkerQuestions(["fast", "deep"], {}, []);
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
          // Extreme enough that a deep answer clears the seed `standard` cut point (1.81).
          probabilities: { fast: tier === "fast" ? 1 : 0, deep: tier === "deep" ? 1 : 0 },
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
    // `low` survives every tier unchanged; the option order is irrelevant to the rank.
    const effort = "low";
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

describe("size", () => {
  type Pick = { toolCalls: number | undefined; base: string; own: string };
  const sizeOf = (p: Pick, ownBody?: unknown) => {
    const b = mainReq("minimal", "minimal", 0);
    const v = mainReq("full", "minimal", 0);
    const plan = planOf([b, v]);
    const results = [
      ok(b, mainBody({ effort: p.base })),
      ok(v, ownBody ?? mainBody({ effort: p.own })),
    ];
    return compare(plan, results, { ...meta, toolCalls: [p.toolCalls] }).variants["full"]?.size;
  };

  test("raised on a large turn", () => {
    expect(sizeOf({ toolCalls: 20, base: "low", own: "high" })?.large.raised).toBe(1);
  });

  test("lowered on a small turn", () => {
    expect(sizeOf({ toolCalls: 3, base: "high", own: "medium" })?.small.lowered).toBe(1);
  });

  test("same level", () => {
    expect(sizeOf({ toolCalls: 3, base: "medium", own: "medium" })?.small.same).toBe(1);
  });

  test("boundary 14 is small, 15 is large", () => {
    expect(sizeOf({ toolCalls: 14, base: "low", own: "high" })?.small.raised).toBe(1);
    expect(sizeOf({ toolCalls: 15, base: "low", own: "high" })?.large.raised).toBe(1);
  });

  test("unknown size", () => {
    const size = sizeOf({ toolCalls: undefined, base: "low", own: "high" });
    expect(size?.unknown).toBe(1);
    expect(size?.large).toEqual({ raised: 0, same: 0, lowered: 0 });
    expect(size?.small).toEqual({ raised: 0, same: 0, lowered: 0 });
  });

  test("miss not counted", () => {
    const zero = {
      large: { raised: 0, same: 0, lowered: 0 },
      small: { raised: 0, same: 0, lowered: 0 },
      unknown: 0,
    };
    const b = mainReq("minimal", "minimal", 0);
    const v = mainReq("full", "minimal", 0);
    const missed = compare(planOf([b, v]), [ok(b, mainBody({ effort: "low" })), miss(v)], {
      ...meta,
      toolCalls: [20],
    });
    expect(missed.variants["full"]?.size).toEqual(zero);
    expect(sizeOf({ toolCalls: 20, base: "low", own: "high" }, { answers: {} })).toEqual(zero);
  });

  test("bases carry no size", () => {
    const { plan, results } = flipPlan({ "rerun-a": 1, "rerun-b": 1, full: 1 });
    const agg = compare(plan, results, meta);
    for (const id of ["minimal", "rerun-a", "rerun-b"]) {
      expect(agg.variants[id] !== undefined && "size" in agg.variants[id]!).toBe(false);
    }
    expect(agg.variants["full"]?.size).toBeDefined();
  });

  test("size holds no text", () => {
    const b = mainReq("minimal", "minimal", 0);
    const v = mainReq("full", "minimal", 0);
    const agg = compare(
      planOf([b, v]),
      [ok(b, mainBody({ effort: "low" })), ok(v, mainBody({ effort: "high" }))],
      { ...meta, toolCalls: [20] },
    );
    const leaves = (x: unknown): unknown[] =>
      typeof x === "object" && x !== null ? Object.values(x).flatMap(leaves) : [x];
    const size = agg.variants["full"]?.size;
    expect(leaves(size).every((n) => Number.isInteger(n) && (n as number) >= 0)).toBe(true);
    expect(JSON.stringify(agg)).not.toContain(MARKER);
  });

  test("full-based noise", () => {
    const requests: PlannedRequest[] = [];
    const results: Result[] = [];
    const flips = { "rerun-a": 2, "rerun-b": 4 };
    for (let s = 0; s < 15; s++) {
      const min = mainReq("minimal", "minimal", s);
      const full = mainReq("full", "minimal", s);
      const role = mainReq("role-rule", "full", s);
      requests.push(min, full, role);
      results.push(ok(min, mainBody({ effort: "low" })), ok(full, mainBody({ effort: "low" })));
      results.push(ok(role, mainBody({ effort: s < 3 ? "high" : "low" })));
      for (const [v, n] of Object.entries(flips)) {
        const r = mainReq(v, "minimal", s);
        requests.push(r);
        results.push(ok(r, mainBody({ effort: s < n ? "high" : "low" })));
      }
    }
    const v = compare(planOf(requests), results, meta).variants["role-rule"];
    expect(v?.base).toBe("full");
    expect(v?.flips["effort"]).toBe(3);
    expect(v?.noise["effort"]).toBe(4);
    expect(v?.beyond).not.toContain("effort");
  });
});
