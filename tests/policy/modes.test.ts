import { describe, expect, test } from "bun:test";
import type { Answer } from "../../src/policy/answers.ts";
import { expertAdmitted, MODE_NAMES, MODE_TARGETS, type ModeName } from "../../src/policy/modes.ts";
import { MODES } from "../../src/store/defaults.ts";

interface Spec {
  tier?: string;
  expert?: number;
  effort?: string;
  needed?: number;
}

function build(s: Spec): Record<string, Answer> {
  const out: Record<string, Answer> = {};
  if (s.tier !== undefined) {
    out["tier"] = {
      type: "choice",
      choice: s.tier,
      probabilities: s.expert === undefined ? {} : { expert: s.expert },
    };
  }
  if (s.effort !== undefined) {
    out["effort"] = { type: "choice", choice: s.effort, probabilities: {} };
  }
  if (s.needed !== undefined) out["expert_needed"] = { type: "noul", noul: s.needed };
  return out;
}

function gate(mode: ModeName, s: Spec): boolean {
  return expertAdmitted(mode, build(s));
}

describe("Mode names", () => {
  test("Policy and store agree", () => {
    expect([...MODE_NAMES]).toEqual([...MODES]);
  });
});

describe("Expert gate per mode", () => {
  test("Standard gate passes", () => {
    expect(gate("standard", { tier: "expert", needed: 0.95 })).toBe(true);
  });
  test("Standard gate boundary", () => {
    expect(gate("standard", { tier: "expert", needed: 0.9 })).toBe(false);
  });
  test("Budget uses the standard gate", () => {
    expect(gate("budget", { tier: "expert", needed: 0.95 })).toBe(true);
    expect(gate("budget", { tier: "expert", needed: 0.9 })).toBe(false);
  });
  test("Standard gate ignores effort", () => {
    expect(gate("standard", { tier: "deep", expert: 0.4, effort: "max", needed: 0.5 })).toBe(false);
  });
  test("Premium gate from a deep choice", () => {
    expect(gate("premium", { tier: "deep", expert: 0.1, effort: "xhigh" })).toBe(true);
  });
  test("Premium gate from an expert choice", () => {
    expect(gate("premium", { tier: "expert", expert: 0.6, effort: "max", needed: 0.1 })).toBe(true);
  });
  test("Premium probability boundary", () => {
    expect(gate("premium", { tier: "deep", expert: 0.099, effort: "max" })).toBe(false);
  });
  test("Premium needs high effort", () => {
    expect(gate("premium", { tier: "expert", expert: 0.7, effort: "high" })).toBe(false);
  });
  test("Premium needs a deep or expert choice", () => {
    expect(gate("premium", { tier: "balanced", expert: 0.3, effort: "max" })).toBe(false);
  });
  test("Premium effort unanswered", () => {
    expect(gate("premium", { tier: "deep", expert: 0.3 })).toBe(false);
  });
  test("Expert probability missing", () => {
    const answers: Record<string, Answer> = {
      tier: { type: "choice", choice: "deep", probabilities: { deep: 0.9 } },
      effort: { type: "choice", choice: "xhigh", probabilities: {} },
    };
    expect(expertAdmitted("premium", answers)).toBe(false);
  });
  test("Wrong answer type for effort counts as unanswered", () => {
    const answers: Record<string, Answer> = {
      ...build({ tier: "deep", expert: 0.5 }),
      effort: { type: "noul", noul: 1 },
    };
    expect(expertAdmitted("premium", answers)).toBe(false);
  });
  test("Wrong answer type for tier counts as unanswered", () => {
    const answers: Record<string, Answer> = {
      tier: { type: "noul", noul: 1 },
      expert_needed: { type: "noul", noul: 0.99 },
    };
    expect(expertAdmitted("standard", answers)).toBe(false);
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
