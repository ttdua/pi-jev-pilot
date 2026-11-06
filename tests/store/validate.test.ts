import { describe, expect, test } from "bun:test";
import {
  array,
  boolean,
  integer,
  joinPath,
  object,
  oneOf,
  string,
  type Issue,
} from "../../src/store/validate";
import { DEFAULTS, FEATURES, MODES, RESERVED_SLOT_NAMES, TIERS } from "../../src/store/defaults";

const SECRET = "sk-test-0123456789abcdef";

describe("validate", () => {
  test("joinPath formats dot and index", () => {
    expect(joinPath("", "a")).toBe("a");
    expect(joinPath("a", "b")).toBe("a.b");
    expect(joinPath("a", 2)).toBe("a[2]");
  });

  test("object reports every unknown key", () => {
    const issues: Issue[] = [];
    const out = object({ a: integer({ min: 0, max: 9 }) })({ a: 1, x: 1, y: 1 }, "", issues);
    expect(issues.map((i) => i.path)).toEqual(["x", "y"]);
    expect(out).toEqual({ a: 1 });
  });

  test("object rejects array and null", () => {
    for (const bad of [[], null, "s", 3]) {
      const issues: Issue[] = [];
      object({})(bad, "crew", issues);
      expect(issues.map((i) => i.path)).toEqual(["crew"]);
    }
  });

  test("object enforces required keys", () => {
    const issues: Issue[] = [];
    object({ a: boolean() }, { required: ["a"] })({}, "p", issues);
    expect(issues.map((i) => i.path)).toEqual(["p.a"]);
  });

  test("collects all issues", () => {
    const issues: Issue[] = [];
    object({ a: boolean(), b: boolean() })({ a: 1, b: 2 }, "", issues);
    expect(issues.map((i) => i.path)).toEqual(["a", "b"]);
  });

  test("messages never contain the value", () => {
    const issues: Issue[] = [];
    string({ pattern: /^[a-z]+$/ })(SECRET, "s", issues);
    string({ max: 3 })(SECRET, "s", issues);
    string({ min: 100 })(SECRET, "s", issues);
    integer({ min: 0, max: 5 })(SECRET, "i", issues);
    oneOf(["a", "b"])(SECRET, "o", issues);
    boolean()(SECRET, "b", issues);
    array(boolean())(SECRET, "arr", issues);
    object({})(SECRET, "obj", issues);
    object({})({ [SECRET]: 1 }, "obj", issues);
    expect(issues.length).toBe(9);
    for (const i of issues) expect(i.message).not.toContain(SECRET);
  });

  test("string trim and bounds", () => {
    const issues: Issue[] = [];
    expect(string({ trim: true, min: 1 })("  hi ", "s", issues)).toBe("hi");
    expect(string({ trim: true, min: 1 })("   ", "s", issues)).toBeUndefined();
    expect(issues.length).toBe(1);
  });

  test("integer rejects 1500.5 and bounds", () => {
    const v = integer({ min: 300, max: 5000 });
    const issues: Issue[] = [];
    expect(v(1500, "t", issues)).toBe(1500);
    expect(v(300, "t", issues)).toBe(300);
    expect(v(5000, "t", issues)).toBe(5000);
    expect(issues).toEqual([]);
    for (const bad of [1500.5, 299, 5001, "1500", Number.NaN]) {
      const is: Issue[] = [];
      expect(v(bad, "t", is)).toBeUndefined();
      expect(is.length).toBe(1);
    }
  });

  test("array uniqueBy reports the second duplicate at its index", () => {
    const issues: Issue[] = [];
    const v = array(object({ name: string({}) }), { uniqueBy: (x) => x.name ?? "" });
    v([{ name: "a" }, { name: "b" }, { name: "a" }], "slots", issues);
    expect(issues.map((i) => i.path)).toEqual(["slots[2]"]);
  });

  test("array max", () => {
    const issues: Issue[] = [];
    array(boolean(), { max: 1 })([true, false], "a", issues);
    expect(issues.map((i) => i.path)).toEqual(["a"]);
  });
});

describe("defaults", () => {
  test("constants", () => {
    expect(FEATURES).toEqual([
      "effort",
      "subagents",
      "skills",
      "strategy",
      "tools",
      "expert",
      "review",
      "status",
      "verbose",
    ]);
    expect(MODES).toEqual(["budget", "standard", "premium"]);
    expect(TIERS).toEqual(["fast", "balanced", "deep", "expert"]);
    expect(RESERVED_SLOT_NAMES).toEqual([
      "all",
      "budget",
      "cli-review",
      "default",
      "effort",
      "expert",
      "mode",
      "off",
      "on",
      "premium",
      "remove",
      "reset",
      "review",
      "skills",
      "standard",
      "status",
      "strategy",
      "subagents",
      "tools",
      "tune",
      "verbose",
    ]);
  });

  test("DEFAULTS", () => {
    expect(DEFAULTS.classifier).toEqual({
      url: "https://api.typesafe.ai/v1/systemone",
      model: "jev-latest",
      apiKeyEnv: "TYPESAFE_API_KEY",
      timeoutMs: 1500,
    });
    expect(DEFAULTS.effort.holdProviders).toEqual(["9router"]);
    expect(DEFAULTS.skills.inject).toBe("content");
    expect(DEFAULTS.tools.mode).toBe("observe");
    expect(DEFAULTS.state.parentRequest).toBe(false);
    expect(DEFAULTS.review.cli).toBe("codex");
    expect(DEFAULTS.mode).toBe("standard");
    for (const f of FEATURES) expect(DEFAULTS.switches[f]).toBe(f !== "verbose");
  });
});
