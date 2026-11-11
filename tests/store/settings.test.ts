import { describe, expect, test } from "bun:test";
import { DEFAULTS } from "../../src/store/defaults.ts";
import { resolveSettings, type Settings, untunedTimeout } from "../../src/store/settings.ts";

describe("resolveSettings", () => {
  test("Forked launch from config", () => {
    const s = resolveSettings({ config: { subagents: { forkedLaunch: "thinking" } }, state: {} });
    expect(s.subagents.forkedLaunch).toBe("thinking");
  });

  test("Grant cut from config", () => {
    const s = resolveSettings({ config: { tools: { grantAt: 0.9 } }, state: {} });
    expect(s.tools.grantAt).toBe(0.9);
    expect(s.tools.mode).toBe("observe");
  });

  test("Everything defaulted", () => {
    expect(resolveSettings({ config: {}, state: {} })).toEqual({
      classifier: {
        url: "https://api.typesafe.ai/v1/systemone",
        model: "jev-latest",
        apiKeyEnv: "TYPESAFE_API_KEY",
        timeoutMs: 1500,
      },
      tiers: {},
      crew: { slots: [] },
      effort: { holdProviders: ["9router"] },
      skills: { inject: "content" },
      tools: { mode: "observe", grantAt: 0.8 },
      state: { parentRequest: false },
      subagents: { forkedLaunch: "untouched" },
      review: { cli: "codex", enabled: false },
      mode: "standard",
      modeSource: "global",
      globalMode: "standard",
      switches: {
        effort: true,
        subagents: true,
        skills: true,
        strategy: true,
        tools: true,
        expert: true,
        status: true,
        verbose: false,
      },
    });
  });

  test("Config over default", () => {
    const s = resolveSettings({ config: { classifier: { timeoutMs: 2000 } }, state: {} });
    expect(s.classifier.timeoutMs).toBe(2000);
    expect(s.classifier.model).toBe("jev-latest");
  });

  test("Tuning over config", () => {
    const s = resolveSettings({
      config: { classifier: { timeoutMs: 2000 } },
      state: {},
      tuning: { timeoutMs: { value: 2200, base: 2000 } },
    });
    expect(s.classifier.timeoutMs).toBe(2200);
  });

  test("Switch off", () => {
    const s = resolveSettings({ config: {}, state: { switches: { skills: false } } });
    expect(s.switches).toEqual({ ...DEFAULTS.switches, skills: false });
  });

  test("Mode from state", () => {
    const s = resolveSettings({ config: {}, state: { mode: "premium" } });
    expect(s.mode).toBe("premium");
    expect(s.modeSource).toBe("global");
    expect(s.globalMode).toBe("premium");
  });

  test("Directory mode over state", () => {
    const s = resolveSettings({
      config: {},
      state: { mode: "premium" },
      localMode: "budget",
    });
    expect(s.mode).toBe("budget");
    expect(s.modeSource).toBe("local");
    expect(s.globalMode).toBe("premium");
  });

  test("Directory mode over the default", () => {
    const s = resolveSettings({ config: {}, state: {}, localMode: "premium" });
    expect(s.mode).toBe("premium");
    expect(s.modeSource).toBe("local");
    expect(s.globalMode).toBe("standard");
  });

  test("Directory mode changes only the mode", () => {
    const state = { switches: { skills: false } };
    const without: Partial<Settings> = resolveSettings({ config: {}, state });
    const withSession: Partial<Settings> = resolveSettings({
      config: {},
      state,
      localMode: "premium",
    });
    for (const s of [without, withSession]) {
      delete s.mode;
      delete s.modeSource;
    }
    expect(withSession).toEqual(without);
  });

  test("CLI review default from state", () => {
    const s = resolveSettings({
      config: { review: { cli: "codex" } },
      state: { cliReview: { cli: "opencode" } },
    });
    expect(s.review).toEqual({ cli: "opencode", enabled: false });
    expect(Object.hasOwn(s.review, "model")).toBe(false);
    expect(Object.hasOwn(s.review, "effort")).toBe(false);
  });

  test("CLI review on from the config", () => {
    const s = resolveSettings({ config: { review: { enabled: true } }, state: {} });
    expect(s.review.enabled).toBe(true);
  });

  test("CLI review off from the state", () => {
    const s = resolveSettings({
      config: { review: { enabled: true } },
      state: { cliReviewEnabled: false },
    });
    expect(s.review.enabled).toBe(false);
  });

  test("Reviewer from state keeps the config's enabled", () => {
    const s = resolveSettings({
      config: { review: { cli: "codex", enabled: true } },
      state: { cliReview: { cli: "opencode" } },
    });
    expect(s.review).toEqual({ cli: "opencode", enabled: true });
  });

  test("Config review without state", () => {
    const s = resolveSettings({ config: { review: { cli: "opencode" } }, state: {} });
    expect(s.review.cli).toBe("opencode");
  });

  test("Non-integer tuning ignored", () => {
    const s = resolveSettings({
      config: {},
      state: {},
      tuning: { timeoutMs: { value: 1800.5, base: 1500 } },
    });
    expect(s.classifier.timeoutMs).toBe(1500);
  });

  test("Out-of-range tuning ignored", () => {
    for (const v of [9000, 299, 5001, "1800", Number.NaN]) {
      const s = resolveSettings({
        config: {},
        state: {},
        tuning: { timeoutMs: { value: v, base: 1500 } },
      });
      expect(s.classifier.timeoutMs).toBe(1500);
    }
    const edge = resolveSettings({
      config: { classifier: { timeoutMs: 300 } },
      state: {},
      tuning: { timeoutMs: { value: 5000, base: 300 } },
    });
    expect(edge.classifier.timeoutMs).toBe(5000);
  });

  test("Config edited after tuning", () => {
    const s = resolveSettings({
      config: { classifier: { timeoutMs: 2000 } },
      state: {},
      tuning: { timeoutMs: { value: 1700, base: 1500 } },
    });
    expect(s.classifier.timeoutMs).toBe(2000);
  });

  test("Tuned from the default", () => {
    const s = resolveSettings({
      config: {},
      state: {},
      tuning: { timeoutMs: { value: 1700, base: 1500 } },
    });
    expect(s.classifier.timeoutMs).toBe(1700);
  });

  test("Invalid base ignored", () => {
    const s = resolveSettings({
      config: {},
      state: {},
      tuning: { timeoutMs: { value: 1700, base: 1500.5 } },
    });
    expect(s.classifier.timeoutMs).toBe(1500);
  });

  test("Missing base ignored", () => {
    const s = resolveSettings({ config: {}, state: {}, tuning: { timeoutMs: { value: 1700 } } });
    expect(s.classifier.timeoutMs).toBe(1500);
  });

  test("result is fresh: mutation does not leak", () => {
    const config = {
      effort: { holdProviders: ["x"] },
      tiers: { fast: "m" },
      crew: { slots: [{ name: "a", model: "b", when: "w" }] },
    };
    const s = resolveSettings({ config, state: {} });
    s.effort.holdProviders.push("y");
    s.tiers.deep = "z";
    s.crew.slots[0]!.name = "changed";
    s.crew.slots.push({ name: "n", model: "m", when: "w" });
    expect(config.effort.holdProviders).toEqual(["x"]);
    expect(config.tiers).toEqual({ fast: "m" });
    expect(config.crew.slots).toEqual([{ name: "a", model: "b", when: "w" }]);

    const d = resolveSettings({ config: {}, state: {} });
    d.effort.holdProviders.push("y");
    d.switches.verbose = true;
    expect(DEFAULTS.effort.holdProviders).toEqual(["9router"]);
    expect(DEFAULTS.switches.verbose).toBe(false);
    expect(resolveSettings({ config: {}, state: {} }).effort.holdProviders).toEqual(["9router"]);
  });
});

describe("untunedTimeout", () => {
  test("defaults to 1500", () => {
    expect(untunedTimeout({})).toBe(1500);
  });
  test("uses the configured value", () => {
    expect(untunedTimeout({ classifier: { timeoutMs: 2000 } })).toBe(2000);
  });
});
