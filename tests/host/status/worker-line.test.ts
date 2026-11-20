import { describe, expect, test } from "bun:test";
import { logLine } from "../../../src/host/status/line.ts";

const worker = {
  v: 1,
  at: 1,
  session: "s1",
  mode: "standard",
  answered: true,
  kind: "worker",
  briefChars: 10,
  status: "completed",
  agent: "scout",
  reason: "choice",
};
const line = (over: Record<string, unknown>) => logLine({ ...worker, ...over });

describe("worker log line: head", () => {
  test("tier and effort", () => {
    expect(line({ tier: "deep", effort: "max" })).toBe("jev · scout → deep · max");
  });
  test("no tier, reason other than untouched, no effort", () => {
    expect(line({ reason: "miss", answered: false })).toBe("jev · scout → - · - · why miss");
  });
  test("untouched without a tier", () => {
    expect(line({ reason: "untouched" })).toBe("jev · scout → untouched · -");
  });
  test("a tier wins over the untouched label", () => {
    expect(line({ reason: "untouched", tier: "basic", effort: "low" })).toBe(
      "jev · scout → basic · low",
    );
  });
});

describe("worker log line: parts, in order", () => {
  test("duration is one decimal of seconds", () => {
    expect(line({ tier: "basic", ms: 0 })).toBe("jev · scout → basic · - · 0.0s");
    expect(line({ tier: "basic", ms: 1250 })).toBe("jev · scout → basic · - · 1.3s");
  });
  test("tier probabilities follow the tier order, extras after in key order", () => {
    expect(
      line({
        tier: "basic",
        tierP: { "slot::zeta": 0.1, frontier: 0.2, basic: 0.3, "slot::alpha": 0.4 },
      }),
    ).toBe("jev · scout → basic · - · p basic 0.30 frontier 0.20 slot::zeta 0.10 slot::alpha 0.40");
  });
  test("tier probabilities with every tier", () => {
    expect(
      line({ tier: "basic", tierP: { frontier: 0.1, deep: 0.2, broad: 0.3, basic: 0.4 } }),
    ).toBe("jev · scout → basic · - · p basic 0.40 broad 0.30 deep 0.20 frontier 0.10");
  });
  test("empty tier probabilities add nothing", () => {
    expect(line({ tier: "basic", tierP: {} })).toBe("jev · scout → basic · -");
  });
  test("reasons cut, choice and untouched are hidden; others shown", () => {
    for (const reason of ["cut", "choice", "untouched"]) {
      expect(line({ tier: "basic", reason })).toBe("jev · scout → basic · -");
    }
    expect(line({ tier: "basic", reason: "miss", answered: false })).toBe(
      "jev · scout → basic · - · why miss",
    );
    expect(line({ tier: "basic", reason: "frontier" })).toBe(
      "jev · scout → basic · - · why frontier",
    );
  });
  test("miss", () => {
    expect(line({ tier: "basic", miss: "timeout", answered: false })).toBe(
      "jev · scout → basic · - · miss timeout",
    );
  });
  test("fallback shows only when it differs from the tier", () => {
    expect(line({ tier: "basic", fallback: "basic" })).toBe("jev · scout → basic · -");
    expect(line({ tier: "basic", fallback: "deep" })).toBe(
      "jev · scout → basic · - · fallback deep",
    );
    expect(line({ reason: "untouched", fallback: "deep" })).toBe(
      "jev · scout → untouched · - · fallback deep",
    );
  });
  test("locked shows only when true", () => {
    expect(line({ tier: "basic", locked: true })).toBe("jev · scout → basic · - · locked");
    expect(line({ tier: "basic", locked: false })).toBe("jev · scout → basic · -");
  });
  test("a status other than completed is appended", () => {
    expect(line({ tier: "basic", status: "aborted" })).toBe("jev · scout → basic · - · aborted");
  });
  test("every part together", () => {
    expect(
      line({
        tier: "broad",
        effort: "high",
        ms: 480,
        tierP: { basic: 0.1, broad: 0.9 },
        reason: "frontier",
        answered: false,
        miss: "error",
        fallback: "deep",
        locked: true,
        status: "aborted",
      }),
    ).toBe(
      "jev · scout → broad · high · 0.5s · p basic 0.10 broad 0.90 · why frontier · miss error · fallback deep · locked · aborted",
    );
  });
});
