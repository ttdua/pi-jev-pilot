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
  return { score, effort, decided: "broad" };
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

  test("frontier cap", () => {
    const window = hundredths((s) => (s >= 0.95 ? "xhigh" : "high"));
    expect(cutPoints(window, MODE_TARGETS.premium).frontierMin).toBe(0.96);
  });

  test("frontier never below the broad cut", () => {
    const window = hundredths((s) => (s <= 0.1 ? "xhigh" : "high"));
    expect(cutPoints(window, MODE_TARGETS.standard).frontierMin).toBe(Infinity);
  });

  test("ties stay under the cap", () => {
    const window = [
      ...Array.from({ length: 97 }, () => entry(1.0)),
      ...Array.from({ length: 3 }, () => entry(2.5, "max")),
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
      expect(seed.basicMax).toBeLessThanOrEqual(seed.broadMax);
      expect(seed.broadMax).toBeLessThan(seed.frontierMin);
    }
    expect(SEED_CUTPOINTS.premium.basicMax).toBe(-Infinity);
    expect(SEED_CUTPOINTS.budget.frontierMin).toBe(Infinity);
  });
});

const EVIDENCE_NOTE = "docs/evidence/2026-11-07-tier-mix.md";

function parseCut(cell: string): number {
  if (cell === "−∞") return -Infinity;
  if (cell === "+∞") return Infinity;
  return Number(cell);
}

// Rows of the note's "Seed cut points" table: | `mode` | basicMax | broadMax | frontierMin |
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
      basicMax: parseCut(cells[1] ?? ""),
      broadMax: parseCut(cells[2] ?? ""),
      frontierMin: parseCut(cells[3] ?? ""),
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
