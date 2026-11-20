import { describe, expect, test } from "bun:test";
import { DEFAULTS, FEATURES } from "../../src/store/defaults.ts";
import { resolveSettings } from "../../src/store/settings.ts";

const TOP_KEYS = [
  "classifier",
  "tiers",
  "crew",
  "effort",
  "skills",
  "state",
  "subagents",
  "mode",
  "modeSource",
  "globalMode",
  "switches",
];

describe("resolveSettings key order", () => {
  test("top-level and nested sections keep their key order", () => {
    const s = resolveSettings({ config: {}, state: {} });
    expect(Object.keys(s)).toEqual(TOP_KEYS);
    expect(Object.keys(s.classifier)).toEqual(["url", "model", "apiKeyEnv", "timeoutMs"]);
    expect(Object.keys(s.switches)).toEqual([...FEATURES]);
  });
});

describe("resolveSettings precedence", () => {
  test("directory mode beats global mode and marks the source local", () => {
    const s = resolveSettings({
      config: {},
      state: { mode: "budget" },
      localMode: "premium",
    });
    expect([s.mode, s.modeSource, s.globalMode]).toEqual(["premium", "local", "budget"]);
  });

  test("global mode comes from state, else default, with source global", () => {
    const a = resolveSettings({ config: {}, state: { mode: "budget" } });
    expect([a.mode, a.modeSource, a.globalMode]).toEqual(["budget", "global", "budget"]);
    const b = resolveSettings({ config: {}, state: {} });
    expect([b.mode, b.globalMode]).toEqual([DEFAULTS.mode, DEFAULTS.mode]);
  });

  test("config values override defaults in every section", () => {
    const s = resolveSettings({
      config: {
        classifier: { url: "u", model: "m", apiKeyEnv: "K", timeoutMs: 700 },
        tiers: { basic: "x" },
        effort: { holdProviders: ["a"] },
        skills: { inject: "suggest" },
        state: { parentRequest: true },
        subagents: { forkLaunch: "thinking" },
      },
      state: {},
    });
    expect(s.classifier).toEqual({
      url: "u",
      model: "m",
      apiKeyEnv: "K",
      timeoutMs: 700,
    });
    expect(s.tiers).toEqual({ basic: "x" });
    expect(s.effort.holdProviders).toEqual(["a"]);
    expect(s.skills.inject).toBe("suggest");
    expect(s.state.parentRequest).toBe(true);
    expect(s.subagents.forkLaunch).toBe("thinking");
  });

  test("partial classifier config falls back per field", () => {
    const s = resolveSettings({
      config: { classifier: { model: "m" } },
      state: {},
    });
    expect(s.classifier).toEqual({ ...DEFAULTS.classifier, model: "m" });
  });
});

describe("resolveSettings switches", () => {
  test("only boolean state values override the defaults", () => {
    const s = resolveSettings({
      config: {},
      state: {
        switches: {
          effort: false,
          skills: "no",
          tools: 1,
          frontier: null,
          verbose: true,
        } as never,
      },
    });
    expect(s.switches).toEqual({
      ...DEFAULTS.switches,
      effort: false,
      verbose: true,
    });
  });
});

describe("resolveSettings timeout tuning", () => {
  const timeout = (config: object, tuning: object) =>
    resolveSettings({ config, state: {}, tuning }).classifier.timeoutMs;

  test("tuned value applies while base equals the untuned default", () => {
    expect(timeout({}, { timeoutMs: { value: 900, base: 1500 } })).toBe(900);
  });

  test("tuned value applies while base equals the config value", () => {
    const config = { classifier: { timeoutMs: 800 } };
    expect(timeout(config, { timeoutMs: { value: 900, base: 800 } })).toBe(900);
  });

  test("stale base, out-of-range or non-integer values leave the untuned value", () => {
    const config = { classifier: { timeoutMs: 800 } };
    expect(timeout(config, { timeoutMs: { value: 900, base: 1500 } })).toBe(800);
    expect(timeout({}, { timeoutMs: { value: 299, base: 1500 } })).toBe(1500);
    expect(timeout({}, { timeoutMs: { value: 5001, base: 1500 } })).toBe(1500);
    expect(timeout({}, { timeoutMs: { value: 900.5, base: 1500 } })).toBe(1500);
    expect(timeout({}, { timeoutMs: { value: "900", base: 1500 } })).toBe(1500);
    expect(timeout({}, {})).toBe(1500);
  });
});

describe("resolveSettings freshness", () => {
  test("arrays and objects share no reference with the inputs or DEFAULTS", () => {
    const config = {
      tiers: { basic: "x" },
      crew: { slots: [{ name: "a", model: "m", when: "w" }] },
      effort: { holdProviders: ["p"] },
    };
    const s = resolveSettings({ config, state: {} });
    expect(s.tiers).not.toBe(config.tiers);
    expect(s.crew.slots).not.toBe(config.crew.slots);
    expect(s.crew.slots[0]).not.toBe(config.crew.slots[0]);
    expect(s.effort.holdProviders).not.toBe(config.effort.holdProviders);
    const d = resolveSettings({ config: {}, state: {} });
    expect(d.effort.holdProviders).not.toBe(DEFAULTS.effort.holdProviders);
    expect(d.switches).not.toBe(DEFAULTS.switches);
    expect(d).not.toBe(resolveSettings({ config: {}, state: {} }));
    d.effort.holdProviders.push("mutated");
    d.switches.effort = false;
    expect(DEFAULTS.effort.holdProviders).toEqual([]);
    expect(DEFAULTS.switches.effort).toBe(true);
  });

  test("classifier and tiers are fresh per call", () => {
    const a = resolveSettings({ config: {}, state: {} });
    const b = resolveSettings({ config: {}, state: {} });
    expect(a.classifier).not.toBe(b.classifier);
    expect(a.tiers).not.toBe(b.tiers);
  });
});
