import { describe, expect, test } from "bun:test";
import { MODE_NAMES, MODE_TARGETS } from "../../../src/policy/worker/modes.ts";
import { MODES } from "../../../src/store/defaults.ts";

describe("Mode names", () => {
  test("Policy and store agree", () => {
    expect([...MODE_NAMES]).toEqual([...MODES]);
  });
});

describe("MODE_TARGETS", () => {
  test("targets sum to 100", () => {
    for (const mode of MODE_NAMES) {
      const t = MODE_TARGETS[mode];
      expect(t.basic + t.broad + t.deep + t.frontierCap).toBe(100);
    }
  });

  test("budget has no frontier cap", () => {
    expect(MODE_TARGETS.budget.frontierCap).toBe(0);
  });

  test("values", () => {
    expect(MODE_TARGETS).toEqual({
      budget: { basic: 50, broad: 40, deep: 10, frontierCap: 0 },
      standard: { basic: 20, broad: 53, deep: 26, frontierCap: 1 },
      premium: { basic: 0, broad: 50, deep: 47, frontierCap: 3 },
    });
  });
});
