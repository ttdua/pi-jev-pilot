import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cutPoints,
  cutPointsFor,
  type CutPoints,
  type WindowEntry,
} from "../../../src/policy/worker/cutpoints.ts";
import { WINDOW_MIN } from "../../../src/policy/worker/cut-window.ts";
import type { EffortLevel } from "../../../src/policy/effort.ts";
import { MODE_NAMES, MODE_TARGETS } from "../../../src/policy/worker/modes.ts";
import { SEED_CUTPOINTS } from "../../../src/policy/worker/seed.ts";
import { REPO_ROOT } from "../../helpers";

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

  test("seed is a valid result", () => {
    for (const mode of MODE_NAMES) {
      const seed = SEED_CUTPOINTS[mode];
      expect(seed.fastMax).toBeLessThanOrEqual(seed.balancedMax);
      expect(seed.balancedMax).toBeLessThan(seed.expertMin);
    }
    expect(SEED_CUTPOINTS.premium.fastMax).toBe(-Infinity);
    expect(SEED_CUTPOINTS.budget.expertMin).toBe(Infinity);
  });
});

const EVIDENCE_NOTE = "docs/evidence/2026-11-07-tier-mix.md";

function parseCut(cell: string): number {
  if (cell === "−∞") return -Infinity;
  if (cell === "+∞") return Infinity;
  return Number(cell);
}

// Rows of the note's "Seed cut points" table: | `mode` | fastMax | balancedMax | expertMin |
function publishedSeed(text: string): Record<string, CutPoints> {
  const section = text.split("## Seed cut points")[1]?.split("\n## ")[0] ?? "";
  const rows: Record<string, CutPoints> = {};
  for (const line of section.split("\n")) {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    const mode = /^`(\w+)`$/.exec(cells[0] ?? "")?.[1];
    if (mode === undefined || cells.length !== 4) continue;
    rows[mode] = {
      fastMax: parseCut(cells[1] ?? ""),
      balancedMax: parseCut(cells[2] ?? ""),
      expertMin: parseCut(cells[3] ?? ""),
    };
  }
  return rows;
}

describe("seed evidence", () => {
  test("seed matches the evidence note", () => {
    const published = publishedSeed(readFileSync(join(REPO_ROOT, EVIDENCE_NOTE), "utf8"));
    expect(published).toEqual({ ...SEED_CUTPOINTS });
  });
});
