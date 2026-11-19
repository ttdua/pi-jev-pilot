import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cutPoints, cutPointsFor, type WindowEntry } from "../../../src/policy/worker/cutpoints.ts";
import { WINDOW_MIN } from "../../../src/policy/worker/cut-window.ts";
import { MODE_NAMES, MODE_TARGETS } from "../../../src/policy/worker/modes.ts";
import { SEED_CUTPOINTS } from "../../../src/policy/worker/seed.ts";
import { REPO_ROOT } from "../../helpers";

const FIXTURE = join(REPO_ROOT, "tests/fixtures/seed/provisional-scores.json");

function entry(score: number): WindowEntry {
  return { score, decided: "broad" };
}

function tenths(): WindowEntry[] {
  return Array.from({ length: 10 }, (_, i) => entry((i + 1) / 10));
}

function hundredths(): WindowEntry[] {
  return Array.from({ length: 100 }, (_, i) => entry((i + 1) / 100));
}

describe("cutPoints", () => {
  test("standard target on ten scores", () => {
    expect(cutPoints(tenths(), MODE_TARGETS.standard)).toEqual({
      basicMax: 0.2,
      broadMax: 0.7,
      frontierMin: Infinity,
    });
  });

  test("budget target on ten scores", () => {
    expect(cutPoints(tenths(), MODE_TARGETS.budget)).toEqual({
      basicMax: 0.5,
      broadMax: 0.9,
      frontierMin: Infinity,
    });
  });

  test("premium has no basic cut", () => {
    const cuts = cutPoints(tenths(), MODE_TARGETS.premium);
    expect(cuts.basicMax).toBe(-Infinity);
    expect(cuts.broadMax).toBe(0.5);
  });

  test("Expert cap", () => {
    expect(cutPoints(hundredths(), MODE_TARGETS.premium).frontierMin).toBe(0.98);
  });

  test("Frontier cap in standard", () => {
    expect(cutPoints(hundredths(), MODE_TARGETS.standard).frontierMin).toBe(1);
  });

  test("Expert never below the balanced cut", () => {
    const window = Array.from({ length: 100 }, () => entry(0.5));
    expect(cutPoints(window, MODE_TARGETS.premium).frontierMin).toBe(Infinity);
  });

  test("Ties stay under the cap", () => {
    const window = [
      ...Array.from({ length: 97 }, () => entry(1.0)),
      ...Array.from({ length: 3 }, () => entry(2.5)),
    ];
    expect(cutPoints(window, MODE_TARGETS.standard).frontierMin).toBe(Infinity);
  });

  test("empty window", () => {
    expect(cutPoints([], MODE_TARGETS.standard)).toEqual({
      basicMax: Infinity,
      broadMax: Infinity,
      frontierMin: Infinity,
    });
  });

  test("order independent", () => {
    const window = hundredths();
    const shuffled = [...window].sort((a, b) => ((a.score * 7919) % 1) - ((b.score * 7919) % 1));
    expect(shuffled).not.toEqual(window);
    expect(cutPoints(shuffled, MODE_TARGETS.premium)).toEqual(
      cutPoints(window, MODE_TARGETS.premium),
    );
  });
});

describe("cutPointsFor", () => {
  const shortWindow = Array.from({ length: WINDOW_MIN - 1 }, (_, i) => entry(i / 100));
  const fullWindow = Array.from({ length: WINDOW_MIN }, (_, i) => entry(i / 100));

  test("short window uses the seed", () => {
    expect(cutPointsFor(shortWindow, "standard")).toEqual(SEED_CUTPOINTS.standard);
  });

  test("full window computed", () => {
    expect(cutPointsFor(fullWindow, "standard")).toEqual(
      cutPoints(fullWindow, MODE_TARGETS.standard),
    );
  });

  test("Seed is a valid result", () => {
    for (const mode of MODE_NAMES) {
      const seed = SEED_CUTPOINTS[mode];
      expect(seed.basicMax).toBeLessThanOrEqual(seed.broadMax);
      expect(seed.broadMax).toBeLessThan(seed.frontierMin);
    }
    expect(SEED_CUTPOINTS.premium.basicMax).toBe(-Infinity);
    expect(SEED_CUTPOINTS.budget.frontierMin).toBe(Infinity);
  });

  test("seed is recomputed from the provisional fixture", () => {
    const scores = JSON.parse(readFileSync(FIXTURE, "utf8")) as number[];
    const window = scores.map(entry);
    for (const mode of MODE_NAMES) {
      expect(SEED_CUTPOINTS[mode]).toEqual(cutPoints(window, MODE_TARGETS[mode]));
    }
  });
});

describe("seed evidence", () => {
  // Task 7 publishes the evidence note and the final seed; until then the seed is provisional.
  test.todo("seed matches the evidence note");
});
