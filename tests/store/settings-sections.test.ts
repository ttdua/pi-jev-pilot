import { describe, expect, test } from "bun:test";
import { DEFAULTS } from "../../src/store/defaults.ts";
import {
  resolveClassifier,
  resolveCrew,
  resolveEffort,
  resolveMode,
  resolveSkills,
  resolveStateSection,
  resolveSubagents,
  resolveSwitches,
  resolveTiers,
} from "../../src/store/settings-sections.ts";

describe("settings sections", () => {
  test("classifier: per-field fallback and tuning", () => {
    expect(resolveClassifier({}, undefined)).toEqual(DEFAULTS.classifier);
    const tuning = { timeoutMs: { value: 900, base: 1500 } };
    expect(resolveClassifier({ classifier: { model: "m" } }, tuning)).toEqual({
      ...DEFAULTS.classifier,
      model: "m",
      timeoutMs: 900,
    });
  });

  test("switches: only booleans override, result is fresh", () => {
    const s = resolveSwitches({ switches: { effort: false, skills: 1 as never } });
    expect(s).toEqual({ ...DEFAULTS.switches, effort: false });
    expect(s).not.toBe(DEFAULTS.switches);
  });

  test("mode: directory beats global", () => {
    expect(resolveMode({ mode: "budget" }, "premium")).toEqual({
      mode: "premium",
      modeSource: "local",
      globalMode: "budget",
    });
    expect(resolveMode({}, undefined)).toEqual({
      mode: "standard",
      modeSource: "global",
      globalMode: "standard",
    });
  });

  test("copy sections are fresh", () => {
    const config = {
      tiers: { basic: "x" },
      crew: { slots: [{ name: "a", model: "m", when: "w" }] },
      effort: { holdProviders: ["p"] },
    };
    expect(resolveTiers(config)).not.toBe(config.tiers);
    expect(resolveCrew(config).slots[0]).not.toBe(config.crew.slots[0]);
    expect(resolveEffort(config).holdProviders).not.toBe(config.effort.holdProviders);
    expect(resolveEffort({}).holdProviders).not.toBe(DEFAULTS.effort.holdProviders);
  });

  test("scalar sections fall back to defaults", () => {
    expect(resolveSkills({})).toEqual({ inject: "content" });
    expect(resolveStateSection({})).toEqual({ parentRequest: false });
    expect(resolveSubagents({})).toEqual({ forkLaunch: "untouched" });
  });
});
