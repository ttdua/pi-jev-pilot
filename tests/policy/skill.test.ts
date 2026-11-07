import { describe, expect, test } from "bun:test";

import { type SkillEntry, skillBatches, skillCriterion } from "../../src/policy/skill.ts";

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;

describe("skillCriterion", () => {
  test("Description and body", () => {
    const entry = { name: "debug", description: " Debug failures ", body: "x".repeat(400) };
    expect(skillCriterion(entry)).toBe("Debug failures — " + "x".repeat(300));
  });
  test("Body only", () => {
    expect(skillCriterion({ name: "a", body: " steps " })).toBe("steps");
  });
  test("Description only", () => {
    expect(skillCriterion({ name: "a", description: "Plan work", body: "" })).toBe("Plan work");
  });
  test("Neither", () => {
    expect(skillCriterion({ name: "notes" })).toBe("A skill named notes.");
  });
  test("Whitespace-only description", () => {
    expect(skillCriterion({ name: "a", description: "   ", body: "body text" })).toBe("body text");
  });
  test("Surrogate pairs are not split", () => {
    const excerpt = skillCriterion({ name: "a", body: "a".repeat(299) + "😀" + "tail" });
    expect(excerpt.endsWith("😀")).toBe(true);
    expect(Array.from(excerpt)).toHaveLength(300);
    expect(LONE_SURROGATE.test(excerpt)).toBe(false);
  });
});

function entries(n: number): SkillEntry[] {
  return Array.from({ length: n }, (_, i) => ({ name: `s${i}` }));
}

function sizes(n: number): number[] {
  return skillBatches(entries(n)).map((batch) => batch.length);
}

describe("skillBatches", () => {
  test("Small catalog", () => expect(sizes(78)).toEqual([78]));
  test("Exactly 254", () => expect(sizes(254)).toEqual([254]));
  test("Just over the limit", () => expect(sizes(255)).toEqual([128, 127]));
  test("Near-equal split", () => expect(sizes(302)).toEqual([151, 151]));
  test("Three batches", () => expect(sizes(509)).toEqual([170, 170, 169]));
  test("Empty catalog", () => expect(sizes(0)).toEqual([]));
  test("Order is preserved", () => {
    const names = skillBatches(entries(255)).flatMap((batch) => batch.map((e) => e.name));
    expect(names).toEqual(entries(255).map((e) => e.name));
  });
  test("Repeated name", () => {
    const batches = skillBatches([
      { name: "review", description: "first" },
      { name: "plan" },
      { name: "review", description: "second" },
    ]);
    expect(batches).toEqual([[{ name: "review", description: "first" }, { name: "plan" }]]);
  });
  test("Skill named none", () => {
    expect(skillBatches([{ name: "(none)" }, { name: "a" }])).toEqual([[{ name: "a" }]]);
  });
});
