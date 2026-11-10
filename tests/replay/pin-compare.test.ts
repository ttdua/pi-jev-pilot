import { describe, expect, test } from "bun:test";
import { compare, type Result } from "../../scripts/replay/compare.ts";
import type { PlannedRequest } from "../../scripts/replay/variants.ts";
import { config, mainBody, mainReq, ok, planOf } from "./helpers.ts";

const meta = { runId: "r", pass: 1 as const, samples: { main: 1, workers: 0 }, config };

type Pick = { strategy: string; tier?: string; risky?: number };
/** Base `minimal` answers direct/first tier/0.1; each variant answers per sample via `pick`. */
function run(variants: Record<string, (s: number) => Pick | undefined>, n = 6) {
  const requests: PlannedRequest[] = [];
  const results: Result[] = [];
  for (let s = 0; s < n; s++) {
    const b = mainReq("minimal", "minimal", s);
    requests.push(b);
    results.push(ok(b, mainBody({ strategy: "direct" })));
    for (const [v, pick] of Object.entries(variants)) {
      const r = mainReq(v, "minimal", s);
      requests.push(r);
      const p = pick(s);
      if (p) results.push(ok(r, mainBody(p)));
    }
  }
  return compare(planOf(requests), results, meta).variants;
}
const flipFirst =
  (k: number, strategy = "graph") =>
  (s: number): Pick => ({
    strategy: s < k ? strategy : "direct",
  });

describe("noise characterization (addNoise via compare)", () => {
  test("noise is the max of rerun-a and rerun-b flips for every key", () => {
    const v = run({ "rerun-a": flipFirst(2), "rerun-b": flipFirst(4), full: flipFirst(1) });
    expect(v["full"]!.noise).toEqual({ effort: 0, tier: 0, strategy: 4, risky: 0, corrects: 0 });
    expect(Object.keys(v["full"]!.noise)).toEqual([
      "effort",
      "tier",
      "strategy",
      "risky",
      "corrects",
    ]);
  });

  test("flips equal to noise are not beyond; one more is", () => {
    const v = run({
      "rerun-a": flipFirst(3),
      "rerun-b": flipFirst(1),
      equal: flipFirst(3),
      over: flipFirst(4),
    });
    expect(v["equal"]!.beyond).toEqual([]);
    expect(v["over"]!.beyond).toEqual(["strategy"]);
  });

  test("beyond lists keys in KEYS order", () => {
    const v = run({
      full: (s) => ({ strategy: s < 2 ? "graph" : "direct", risky: s < 2 ? 0.9 : 0.1 }),
    });
    expect(v["full"]!.flips["strategy"]).toBe(2);
    expect(v["full"]!.flips["risky"]).toBe(2);
    expect(v["full"]!.beyond).toEqual(["effort", "strategy", "risky"]);
  });

  test("missing reruns give zero noise, so any flip is beyond", () => {
    const v = run({ full: flipFirst(1) });
    expect(v["full"]!.noise["strategy"]).toBe(0);
    expect(v["full"]!.beyond).toEqual(["strategy"]);
  });

  test("only one rerun present uses it alone", () => {
    const v = run({ "rerun-b": flipFirst(3), full: flipFirst(2) });
    expect(v["full"]!.noise["strategy"]).toBe(3);
    expect(v["full"]!.beyond).toEqual([]);
  });

  test("rerun variants themselves get no noise and no beyond", () => {
    const v = run({ "rerun-a": flipFirst(5), "rerun-b": flipFirst(5) });
    expect(v["rerun-a"]!.noise).toEqual({});
    expect(v["rerun-a"]!.beyond).toEqual([]);
    expect(v["rerun-b"]!.noise).toEqual({});
  });

  test("the minimal base variant gets zero noise", () => {
    const v = run({ "rerun-a": flipFirst(2) });
    expect(v["minimal"]!.noise["strategy"]).toBe(2);
    expect(v["minimal"]!.beyond).toEqual([]);
  });

  test("worker variants use worker rerun keys only, over tier and effort", () => {
    const v = run({ "rerun-a": flipFirst(2), full: flipFirst(1) });
    expect(Object.keys(v).sort()).toEqual(["full", "minimal", "rerun-a"]);
    const plan = planOf([], {
      excluded: { "worker:alt": 2, "worker:rerun-a": 1, "worker:rerun-b": 1 },
    });
    const w = compare(plan, [], meta).variants;
    expect(w["worker:alt"]!.noise).toEqual({ tier: 0, effort: 0 });
    expect(w["worker:alt"]!.beyond).toEqual([]);
    expect(w["worker:rerun-a"]!.noise).toEqual({});
  });
});
