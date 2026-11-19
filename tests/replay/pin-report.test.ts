import { describe, expect, test } from "bun:test";
import type { Result } from "../../scripts/replay/compare.ts";
import { reportCases } from "../../scripts/replay/report-compare.ts";
import { SEED_CUTPOINTS } from "../../src/policy/worker/seed.ts";
import { routeStreamRecords } from "../../scripts/replay/report-route.ts";
import {
  workerQuestions,
  type PlannedRequest,
  type PlainConfig,
} from "../../scripts/replay/variants.ts";
import { mainBody, mainReq, miss, ok, planOf, workerAnswers } from "./helpers.ts";

const config: PlainConfig = {
  tiers: { basic: "a/b", broad: "b/c", deep: "c/d", frontier: "e/f" },
  slots: [{ name: "reviewer", model: "m/n", when: "for review" }],
  mode: "standard",
  frontierOn: true,
};
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
const choice = (opts: readonly string[], pick: string) => ({
  type: "choice",
  choice: pick,
  probabilities: Object.fromEntries(opts.map((o) => [o, o === pick ? 1 : 0])),
});
const workerBody = (tier: string) => {
  const t = specs["tier"];
  const e = specs["effort"];
  return {
    answers: {
      tier: choice(t?.type === "choice" ? t.options : [], tier),
      effort: choice(e?.type === "choice" ? e.options : [], "low"),
      risky: { type: "noul", noul: 0.1 },
    },
  };
};
const text = (kind: "main" | "worker", s: number) => `${kind}-${s}`;

type Cell = {
  main?: [string | undefined, string | undefined];
  worker?: [string | undefined, string | undefined];
};
/** Sample i: `report`/`rerun` answers; `undefined` is a miss, a missing entry is an unplanned sample. */
function build(cells: Cell[]) {
  const requests: PlannedRequest[] = [];
  const results: Result[] = [];
  const side = (kind: "main" | "worker", v: number, variant: string) =>
    cells.forEach((c, i) => {
      const pair = c[kind];
      if (!pair) return;
      const r = kind === "main" ? mainReq(variant, "report", i) : workerReq(variant, i);
      requests.push(r);
      const pick = pair[v];
      results.push(
        pick === undefined
          ? miss(r)
          : ok(r, kind === "main" ? mainBody({ effort: pick }) : workerBody(pick)),
      );
    });
  for (const kind of ["main", "worker"] as const) {
    side(kind, 0, "report");
    side(kind, 1, "rerun");
  }
  return reportCases(planOf(requests), results, config, text);
}
// Candidates come from the run's own answers: identical filler samples give the changed ones a spread to differ against.
const FILLER: Cell[] = Array.from({ length: 20 }, (_, i) => {
  const t = ["basic", "broad", "deep", "frontier"][i % 4];
  return { worker: [t, t] };
});
const brief = (cs: ReturnType<typeof build>) =>
  cs.map((c) => [c.variant, c.key, c.base, c.value, c.text]);

describe("reportCases characterization", () => {
  test("main cases come first, then worker cases by mode then routing, sample ascending", () => {
    const cases = build([
      { main: ["low", "high"], worker: ["basic", "deep"] },
      { main: ["low", "low"], worker: ["basic", "basic"] },
      { main: ["medium", "xhigh"], worker: ["basic", "deep"] },
      ...FILLER,
    ]);
    const keys = cases.map((c) => c.key);
    expect(keys.slice(0, 2)).toEqual(["effort", "effort"]);
    expect(cases.filter((c) => c.key === "effort").map((c) => c.text)).toEqual([
      "main-0",
      "main-2",
    ]);
    const workerKeys = [...new Set(keys.slice(2))];
    expect(workerKeys).toEqual([
      "budget/slots",
      "budget/tiers",
      "standard/slots",
      "standard/tiers",
      "premium/slots",
      "premium/tiers",
    ]);
    // The rerun's other answers move its candidate, so later samples may differ too; sample order holds.
    const std = cases.filter((c) => c.key === "standard/tiers");
    expect([std[0]!.base, std[0]!.text]).toEqual(["basic", "worker-0"]);
    expect(std[0]!.value).not.toBe("basic");
    const samples = std.map((c) => Number(c.text.slice("worker-".length)));
    expect(samples).toEqual([...samples].sort((a, b) => a - b));
    expect(Object.keys(cases[0]!)).toEqual([
      "variant",
      "text",
      "key",
      "base",
      "value",
      "baseAnswer",
      "answer",
    ]);
    expect(cases.every((c) => c.variant === "rerun")).toBe(true);
  });

  test("identical runs yield no cases", () => {
    expect(build([{ main: ["low", "low"], worker: ["basic", "basic"] }])).toEqual([]);
  });

  test("a miss on either side is not a difference", () => {
    expect(
      build([
        { main: [undefined, "high"], worker: [undefined, "deep"] },
        { main: ["high", undefined], worker: ["deep", undefined] },
      ]),
    ).toEqual([]);
  });

  test("worker-only and main-only plans", () => {
    expect(brief(build([{ main: ["low", "high"] }]))).toEqual([
      ["rerun", "effort", "low", "high", "main-0"],
    ]);
    const w = build([{ worker: ["basic", "deep"] }, ...FILLER]);
    expect(w.length).toBeGreaterThan(0);
    expect(w.some((c) => c.text === "worker-0")).toBe(true);
    expect(w.every((c) => c.text.startsWith("worker-") && c.key.includes("/"))).toBe(true);
  });

  test("answers are the raw effort choice (main) and the tier answer (worker)", () => {
    const [m, ...all] = build([{ main: ["low", "high"], worker: ["basic", "deep"] }, ...FILLER]);
    expect(m!.baseAnswer).toMatchObject({ type: "choice", choice: "low" });
    expect(m!.answer).toMatchObject({ type: "choice", choice: "high" });
    const rest = all.filter((c) => c.text === "worker-0");
    expect(rest[0]!.baseAnswer).toMatchObject({ type: "choice", choice: "basic" });
    expect(rest[0]!.answer).toMatchObject({ type: "choice", choice: "deep" });
  });

  test("sampleText is called with kind and sample, once per case, in output order", () => {
    const calls: string[] = [];
    const requests = [mainReq("report", "report", 0), mainReq("rerun", "report", 0)];
    const results = [
      ok(requests[0]!, mainBody({ effort: "low" })),
      ok(requests[1]!, mainBody({ effort: "high" })),
    ];
    reportCases(planOf(requests), results, config, (k, s) => (calls.push(`${k}:${s}`), "t"));
    expect(calls).toEqual(["main:0"]);
  });
});

/** Stable string digest so a long routed stream can be pinned in one line. */
function digest(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
const spread = (i: number) => {
  const t = ["basic", "broad", "deep", "frontier"][i % 4] ?? "basic";
  return workerAnswers({ tier: t, tierP: { [t]: 1 }, effort: i % 2 ? "high" : "low" });
};
const stream = (n: number) =>
  Array.from({ length: n }, (_, i) => (i % 17 === 5 ? undefined : spread(i * 7)));
const opts = (n: number, over: { mode?: "budget" | "premium" } = {}) => ({
  seed: SEED_CUTPOINTS[over.mode ?? "standard"],
  config,
  mode: "standard" as const,
  routing: "tiers" as const,
  background: Array.from({ length: n }, (_, i) => i % 3 === 0),
  ...over,
});

describe("routeStreamRecords characterization", () => {
  test("record shape and misses", () => {
    const out = routeStreamRecords([undefined, spread(0), spread(1)], opts(3));
    expect(out[0]).toBeUndefined();
    expect(Object.keys(out[1]!)).toEqual(["target", "reason"]);
    expect(typeof out[1]!.reason).toBe("string");
  });

  const cases: [string, object, string][] = [
    ["tiers standard", {}, "e5112d53"],
    ["slots standard", { routing: "slots" }, "e5112d53"],
    ["budget", { mode: "budget" }, "9e02e30f"],
    ["premium slots", { mode: "premium", routing: "slots" }, "7e3d60d5"],
    ["no tiers, no slots", { config: { ...config, tiers: {}, slots: [] } }, "ef48b183"],
    ["tiers, frontier off", { config: { ...config, frontierOn: false, slots: [] } }, "80aaac29"],
    ["slots only", { config: { ...config, tiers: {} }, routing: "slots" }, "ef48b183"],
  ];
  for (const [name, over, gold] of cases) {
    test(`digest of 160-answer stream: ${name}`, () => {
      const out = routeStreamRecords(stream(160), opts(160, over));
      expect(digest(JSON.stringify(out))).toBe(gold);
    });
  }
});
