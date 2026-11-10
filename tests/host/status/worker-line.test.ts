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
    expect(line({ reason: "untouched", tier: "fast", effort: "low" })).toBe(
      "jev · scout → fast · low",
    );
  });
});

describe("worker log line: parts, in order", () => {
  test("duration is one decimal of seconds", () => {
    expect(line({ tier: "fast", ms: 0 })).toBe("jev · scout → fast · - · 0.0s");
    expect(line({ tier: "fast", ms: 1250 })).toBe("jev · scout → fast · - · 1.3s");
  });
  test("tier probabilities follow the tier order, extras after in key order", () => {
    expect(
      line({
        tier: "fast",
        tierP: { "slot::zeta": 0.1, expert: 0.2, fast: 0.3, "slot::alpha": 0.4 },
      }),
    ).toBe("jev · scout → fast · - · p fast 0.30 expert 0.20 slot::zeta 0.10 slot::alpha 0.40");
  });
  test("tier probabilities with every tier", () => {
    expect(
      line({ tier: "fast", tierP: { expert: 0.1, deep: 0.2, balanced: 0.3, fast: 0.4 } }),
    ).toBe("jev · scout → fast · - · p fast 0.40 balanced 0.30 deep 0.20 expert 0.10");
  });
  test("empty tier probabilities add nothing", () => {
    expect(line({ tier: "fast", tierP: {} })).toBe("jev · scout → fast · -");
  });
  test("reasons cut, choice and untouched are hidden; others shown", () => {
    for (const reason of ["cut", "choice", "untouched"]) {
      expect(line({ tier: "fast", reason })).toBe("jev · scout → fast · -");
    }
    expect(line({ tier: "fast", reason: "miss", answered: false })).toBe(
      "jev · scout → fast · - · why miss",
    );
    expect(line({ tier: "fast", reason: "expert" })).toBe("jev · scout → fast · - · why expert");
  });
  test("miss", () => {
    expect(line({ tier: "fast", miss: "timeout", answered: false })).toBe(
      "jev · scout → fast · - · miss timeout",
    );
  });
  test("fallback shows only when it differs from the tier", () => {
    expect(line({ tier: "fast", fallback: "fast" })).toBe("jev · scout → fast · -");
    expect(line({ tier: "fast", fallback: "deep" })).toBe("jev · scout → fast · - · fallback deep");
    expect(line({ reason: "untouched", fallback: "deep" })).toBe(
      "jev · scout → untouched · - · fallback deep",
    );
  });
  test("locked shows only when true", () => {
    expect(line({ tier: "fast", locked: true })).toBe("jev · scout → fast · - · locked");
    expect(line({ tier: "fast", locked: false })).toBe("jev · scout → fast · -");
  });
  test("a status other than completed is appended", () => {
    expect(line({ tier: "fast", status: "aborted" })).toBe("jev · scout → fast · - · aborted");
  });
  test("every part together", () => {
    expect(
      line({
        tier: "balanced",
        effort: "high",
        ms: 480,
        tierP: { fast: 0.1, balanced: 0.9 },
        reason: "expert",
        answered: false,
        miss: "error",
        fallback: "deep",
        locked: true,
        status: "aborted",
      }),
    ).toBe(
      "jev · scout → balanced · high · 0.5s · p fast 0.10 balanced 0.90 · why expert · miss error · fallback deep · locked · aborted",
    );
  });
});
