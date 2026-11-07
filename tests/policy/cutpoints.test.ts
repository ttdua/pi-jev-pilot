import { describe, expect, test } from "bun:test";
import { cutPoints, type WindowEntry } from "../../src/policy/cutpoints.ts";
import type { EffortLevel } from "../../src/policy/effort.ts";
import { MODE_TARGETS } from "../../src/policy/modes.ts";

function entry(score: number, effort: EffortLevel = "high"): WindowEntry {
  return { score, effort, decided: "balanced" };
}

function tenths(): WindowEntry[] {
  return Array.from({ length: 10 }, (_, i) => entry((i + 1) / 10));
}

function hundredths(effortOf: (score: number) => EffortLevel): WindowEntry[] {
  return Array.from({ length: 100 }, (_, i) => {
    const score = (i + 1) / 100;
    return entry(score, effortOf(score));
  });
}

describe("cutPoints", () => {
  test("standard target on ten scores", () => {
    expect(cutPoints(tenths(), MODE_TARGETS.standard)).toEqual({
      fastMax: 0.2,
      balancedMax: 0.7,
      expertMin: Infinity,
    });
  });

  test("budget target on ten scores", () => {
    expect(cutPoints(tenths(), MODE_TARGETS.budget)).toEqual({
      fastMax: 0.5,
      balancedMax: 0.9,
      expertMin: Infinity,
    });
  });

  test("premium has no fast cut", () => {
    const cuts = cutPoints(tenths(), MODE_TARGETS.premium);
    expect(cuts.fastMax).toBe(-Infinity);
    expect(cuts.balancedMax).toBe(0.5);
  });

  test("expert cap", () => {
    const window = hundredths((s) => (s >= 0.95 ? "xhigh" : "high"));
    expect(cutPoints(window, MODE_TARGETS.premium).expertMin).toBe(0.96);
  });

  test("expert never below the balanced cut", () => {
    const window = hundredths((s) => (s <= 0.1 ? "xhigh" : "high"));
    expect(cutPoints(window, MODE_TARGETS.standard).expertMin).toBe(Infinity);
  });

  test("ties stay under the cap", () => {
    const window = [
      ...Array.from({ length: 97 }, () => entry(1.0)),
      ...Array.from({ length: 3 }, () => entry(2.5, "max")),
    ];
    expect(cutPoints(window, MODE_TARGETS.standard).expertMin).toBe(Infinity);
  });

  test("empty window", () => {
    expect(cutPoints([], MODE_TARGETS.standard)).toEqual({
      fastMax: Infinity,
      balancedMax: Infinity,
      expertMin: Infinity,
    });
  });

  test("order independent", () => {
    const window = hundredths((s) => (s >= 0.95 ? "xhigh" : "high"));
    const shuffled = [...window].sort((a, b) => ((a.score * 7919) % 1) - ((b.score * 7919) % 1));
    expect(shuffled).not.toEqual(window);
    expect(cutPoints(shuffled, MODE_TARGETS.premium)).toEqual(
      cutPoints(window, MODE_TARGETS.premium),
    );
  });
});
