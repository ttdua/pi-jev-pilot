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
  frontierOffered: true,
  reason: "cut",
  tier: "broad",
  ...o,
});

describe("windowEntries", () => {
  test("excludes slot and old rubric", () => {
    expect(windowEntries([line({ tier: "slot-a" }), line({ rubric: 2 })], 3)).toEqual([]);
  });
  test("Setup without expert left out", () => {
    const legacy: Record<string, unknown> = { ...line(), expertOffered: true };
    delete legacy["frontierOffered"];
    const lines = [line({ frontierOffered: false }), legacy as unknown as WindowLine];
    expect(windowEntries(lines, 3)).toEqual([]);
  });
  test("Miss and untouched left out", () => {
    const lines = [
      line({ reason: "miss" }),
      line({ reason: "untouched" }),
      line({ reason: "risky" }),
      line({ reason: "expert" }),
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
    expect(windowEntries([line({ tier: "broad", fallback: "deep" })], 3)[0]?.decided).toBe("deep");
  });
  test("ties on at: later input counts as later", () => {
    const lines = Array.from({ length: 201 }, (_, i) => line({ at: i < 2 ? 0 : i, score: i }));
    const out = windowEntries(lines, 3);
    expect(out).toHaveLength(200);
    expect(out[0]?.score).toBe(1);
  });
  test("Effort tie", () => {
    const out = windowEntries([line({ effortP: { high: 0.5, xhigh: 0.5 } })], 3);
    expect(out).toEqual([{ score: 5, decided: "broad" }]);
  });
  test("Effort from the distribution", () => {
    const out = windowEntries(
      [line({ effortP: { xhigh: 0.6 } }), line({ effortP: { low: 0.9 } })],
      3,
    );
    expect(out[0]).toEqual(out[1]!);
  });
});

describe("recentMix", () => {
  test("shares for basic, broad, broad, deep", () => {
    const w = (["basic", "broad", "broad", "deep"] as const).map((decided) => ({
      score: 1,
      decided,
    }));
    expect(recentMix(w)).toEqual({
      n: 4,
      shares: { basic: 25, broad: 50, deep: 25, frontier: 0 },
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
