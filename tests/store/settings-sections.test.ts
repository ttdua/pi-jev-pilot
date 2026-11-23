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
  resolveTurnFloors,
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

  describe("turn floors", () => {
    const tuned = (band: string, value: unknown, base: unknown) => ({
      turnFloors: { [band]: { tuned: { value, base } } },
    });
    const BUILTIN = { medium: 40, long: 100, very_long: 200 };

    test("built-in floors without tuning", () => {
      expect(resolveTurnFloors(undefined)).toEqual(BUILTIN);
    });
    test("tuned floor applies", () => {
      expect(resolveTurnFloors(tuned("long", 80, 100))).toEqual({ ...BUILTIN, long: 80 });
    });
    test("base differs keeps built-in", () => {
      expect(resolveTurnFloors(tuned("long", 80, 90))).toEqual(BUILTIN);
    });
    test("out of range keeps built-in", () => {
      expect(resolveTurnFloors(tuned("medium", 100, 40))).toEqual(BUILTIN);
    });
    test("broken order resets all floors", () => {
      const t = {
        turnFloors: {
          medium: { tuned: { value: 80, base: 40 } },
          long: { tuned: { value: 60, base: 100 } },
        },
      };
      expect(resolveTurnFloors(t)).toEqual(BUILTIN);
    });
    test("non-integer values are ignored", () => {
      expect(resolveTurnFloors(tuned("long", 80.5, 100))).toEqual(BUILTIN);
      expect(resolveTurnFloors(tuned("long", "80", 100))).toEqual(BUILTIN);
    });
  });
});
