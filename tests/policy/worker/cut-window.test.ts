import { describe, expect, test } from "bun:test";
import {
  recentMix,
  windowEntries,
  WINDOW_MAX,
  type WindowLine,
} from "../../../src/policy/worker/cut-window.ts";

const line = (o: Partial<WindowLine> = {}): WindowLine => ({
  kind: "worker",
  at: 1,
  rubric: 3,
  score: 5,
  expertOffered: true,
  reason: "cut",
  tier: "balanced",
  ...o,
});

describe("windowEntries", () => {
  test("excludes slot, old rubric, not offered, miss and untouched", () => {
    const lines = [
      line({ tier: "slot-a" }),
      line({ rubric: 2 }),
      line({ expertOffered: false }),
      line({ reason: "miss" }),
      line({ reason: "untouched" }),
    ];
    expect(windowEntries(lines, 3)).toEqual([]);
  });
  test("slot fallback is excluded even with tier name", () => {
    expect(windowEntries([line({ fallback: "slot-a" })], 3)).toEqual([]);
  });
  test("250 lines give the latest 200", () => {
    const lines = Array.from({ length: 250 }, (_, i) => line({ at: i, score: i }));
    const out = windowEntries(lines, 3);
    expect(out).toHaveLength(WINDOW_MAX);
    expect(out[0]?.score).toBe(50);
  });
  test("fallback is the decided tier", () => {
    expect(windowEntries([line({ tier: "balanced", fallback: "deep" })], 3)[0]?.decided).toBe(
      "deep",
    );
  });
  test("ties on at: later input counts as later", () => {
    const lines = Array.from({ length: 201 }, (_, i) => line({ at: i < 2 ? 0 : i, score: i }));
    const out = windowEntries(lines, 3);
    expect(out).toHaveLength(200);
    expect(out[0]?.score).toBe(1);
  });
  test("effort argmax, ties to higher, default high", () => {
    const e = (effortP?: WindowLine["effortP"]) => windowEntries([line({ effortP })], 3)[0]?.effort;
    expect(e({ high: 0.5, xhigh: 0.5 })).toBe("xhigh");
    expect(e({ xhigh: 0.6 })).toBe("xhigh");
    expect(e(undefined)).toBe("high");
  });
});

describe("recentMix", () => {
  test("shares for fast, balanced, balanced, deep", () => {
    const w = (["fast", "balanced", "balanced", "deep"] as const).map((decided) => ({
      score: 1,
      effort: "high" as const,
      decided,
    }));
    expect(recentMix(w)).toEqual({
      n: 4,
      shares: { fast: 25, balanced: 50, deep: 25, expert: 0 },
    });
  });
  test("empty window", () => {
    expect(recentMix([])).toEqual({ n: 0 });
  });
});

describe("windowEntries slots", () => {
  test("slot lines do not displace eligible lines from the latest 200", () => {
    const lines = [
      ...Array.from({ length: 200 }, (_, i) => line({ at: i, score: i })),
      line({ at: 500, tier: "slot-a" }),
    ];
    expect(windowEntries(lines, 3)).toHaveLength(200);
  });
});
