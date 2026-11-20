import { describe, expect, test } from "bun:test";
import { DEFAULTS } from "../../src/store/defaults.ts";
import { resolveSettings, type Settings, untunedTimeout } from "../../src/store/settings.ts";
import { readConfig } from "../../src/store/config.ts";
import { readState } from "../../src/store/state-file.ts";
import { tempDir } from "../helpers.ts";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

describe("resolveSettings", () => {
  test("Hold provider from config", () => {
    const s = resolveSettings({ config: { effort: { holdProviders: ["9router"] } }, state: {} });
    expect(s.effort.holdProviders).toEqual(["9router"]);
  });

  test("Retired CLI review ignored", () => {
    const dir = tempDir("settings-retired-");
    try {
      writeFileSync(join(dir, "config.json"), '{"review":{"cli":"opencode","enabled":true}}');
      writeFileSync(join(dir, "state.json"), '{"version":1,"cliReviewEnabled":true}');
      const read = readConfig(dir);
      const state = readState(dir);
      if (read.kind !== "ok" || state.kind !== "ok") throw new Error("expected ok reads");
      expect(resolveSettings({ config: read.config, state: state.state })).toEqual(
        resolveSettings({ config: {}, state: {} }),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("Forked launch from config", () => {
    const s = resolveSettings({ config: { subagents: { forkLaunch: "thinking" } }, state: {} });
    expect(s.subagents.forkLaunch).toBe("thinking");
  });

  test("Fork launch from the deprecated key", () => {
    const s = resolveSettings({ config: { subagents: { forkedLaunch: "thinking" } }, state: {} });
    expect(s.subagents.forkLaunch).toBe("thinking");
  });

  test("Ignored tools section", () => {
    const base = resolveSettings({ config: {}, state: {} });
    const s = resolveSettings({ config: { tools: { grantAt: 0.9 } } as never, state: {} });
    expect(s).toEqual(base);
    expect("tools" in s).toBe(false);
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
      effort: { holdProviders: [] },
      skills: { inject: "content" },
      state: { parentRequest: false },
      subagents: { forkLaunch: "untouched" },
      mode: "standard",
      modeSource: "global",
      globalMode: "standard",
      switches: {
        effort: true,
        subagents: true,
        skills: true,
        strategy: true,
        frontier: true,
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
      tiers: { basic: "m" },
      crew: { slots: [{ name: "a", model: "b", when: "w" }] },
    };
    const s = resolveSettings({ config, state: {} });
    s.effort.holdProviders.push("y");
    s.tiers.deep = "z";
    s.crew.slots[0]!.name = "changed";
    s.crew.slots.push({ name: "n", model: "m", when: "w" });
    expect(config.effort.holdProviders).toEqual(["x"]);
    expect(config.tiers).toEqual({ basic: "m" });
    expect(config.crew.slots).toEqual([{ name: "a", model: "b", when: "w" }]);

    const d = resolveSettings({ config: {}, state: {} });
    d.effort.holdProviders.push("y");
    d.switches.verbose = true;
    expect(DEFAULTS.effort.holdProviders).toEqual([]);
    expect(DEFAULTS.switches.verbose).toBe(false);
    expect(resolveSettings({ config: {}, state: {} }).effort.holdProviders).toEqual([]);
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
