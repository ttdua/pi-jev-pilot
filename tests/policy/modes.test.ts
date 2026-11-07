import { describe, expect, test } from "bun:test";
import { MODE_NAMES, MODE_TARGETS } from "../../src/policy/modes.ts";
import { MODES } from "../../src/store/defaults.ts";

describe("Mode names", () => {
  test("Policy and store agree", () => {
    expect([...MODE_NAMES]).toEqual([...MODES]);
  });
});

describe("MODE_TARGETS", () => {
  test("targets sum to 100", () => {
    for (const mode of MODE_NAMES) {
      const t = MODE_TARGETS[mode];
      expect(t.fast + t.balanced + t.deep + t.expertCap).toBe(100);
    }
  });

  test("budget has no expert cap", () => {
    expect(MODE_TARGETS.budget.expertCap).toBe(0);
  });

  test("values", () => {
    expect(MODE_TARGETS).toEqual({
      budget: { fast: 50, balanced: 40, deep: 10, expertCap: 0 },
      standard: { fast: 20, balanced: 53, deep: 25, expertCap: 2 },
      premium: { fast: 0, balanced: 50, deep: 45, expertCap: 5 },
    });
  });
});
