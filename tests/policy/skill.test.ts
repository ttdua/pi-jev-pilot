import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import type { Answer, ChoiceAnswer, ReadResult } from "../../src/policy/answers.ts";
import {
  type SkillEntry,
  batchLeader,
  deliveryForm,
  deliveryText,
  gateMean,
  pickSkill,
  skillBatches,
  skillCriterion,
} from "../../src/policy/skill.ts";

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

function choice(probabilities: Record<string, number>, picked = ""): ChoiceAnswer {
  return { type: "choice", choice: picked, probabilities };
}

function read(
  answers: Record<string, Answer>,
  unanswered: Record<string, "missing"> = {},
): ReadResult {
  return { kind: "read", answers, unanswered };
}

function noul(value: number): Answer {
  return { type: "noul", noul: value };
}

const OPTIONS = ["debug", "plan", "(none)"];

describe("batchLeader", () => {
  test("Leader is a skill", () => {
    const answer = choice({ debug: 0.6, plan: 0.1, "(none)": 0.3 });
    expect(batchLeader(OPTIONS, answer)).toEqual({ name: "debug", p: 0.6 });
  });
  test("Leader is none", () => {
    expect(batchLeader(["debug", "(none)"], choice({ debug: 0.3, "(none)": 0.7 }))).toBeUndefined();
  });
  test("Tie within a batch", () => {
    const answer = choice({ "(none)": 0.2, plan: 0.4, debug: 0.4 });
    expect(batchLeader(OPTIONS, answer)).toEqual({ name: "debug", p: 0.4 });
  });
  test("Choice field ignored", () => {
    const answer = choice({ debug: 0.5, plan: 0.2, "(none)": 0.3 }, "plan");
    expect(batchLeader(OPTIONS, answer)?.name).toBe("debug");
  });
});

describe("gateMean", () => {
  test("All gates", () => {
    const mean = gateMean({
      "gate::acts_on_user_system": noul(0.8),
      "gate::would_follow_documented_procedure": noul(0.9),
      "gate::prose_suffices": noul(0.1),
    });
    expect(mean).toBeCloseTo(0.8667, 4);
  });
  test("One gate missing", () => {
    const mean = gateMean({
      "gate::acts_on_user_system": noul(0.6),
      "gate::prose_suffices": noul(0.2),
    });
    expect(mean).toBeCloseTo(0.7, 10);
  });
  test("No gate", () => {
    expect(gateMean({})).toBeUndefined();
  });
});

function whichRead(probs: Record<string, number>, gates: Record<string, Answer> = {}): ReadResult {
  return read({ which: choice(probs), ...gates });
}

function gateOnly(value: number): Record<string, Answer> {
  return { "gate::acts_on_user_system": noul(value) };
}

describe("pickSkill", () => {
  const options = ["debug", "(none)"];

  test("Sure pick", () => {
    const r = whichRead({ debug: 0.5, "(none)": 0.5 }, gateOnly(0.1));
    expect(pickSkill([{ options, read: r }])).toEqual({
      kind: "picked",
      name: "debug",
      p: 0.5,
      gate: 0.1,
    });
  });
  test("Gate supports a weaker pick", () => {
    const r = whichRead(
      { debug: 0.3, "(none)": 0.2 },
      {
        "gate::acts_on_user_system": noul(0.3),
        "gate::would_follow_documented_procedure": noul(0.3),
      },
    );
    expect(pickSkill([{ options, read: r }]).kind).toBe("picked");
  });
  test("Gate too low", () => {
    const pick = pickSkill([
      { options, read: whichRead({ debug: 0.45, "(none)": 0.1 }, gateOnly(0.29)) },
    ]);
    expect(pick).toMatchObject({ kind: "none", reason: "below", p: 0.45 });
    expect(pick.kind === "none" && pick.reason === "below" ? pick.gate : 0).toBeCloseTo(0.29, 10);
  });
  test("Probability too low", () => {
    const r = whichRead({ debug: 0.29, "(none)": 0.1 }, gateOnly(0.9));
    expect(pickSkill([{ options, read: r }])).toMatchObject({ kind: "none", reason: "below" });
  });
  test("No gate and a weaker pick", () => {
    const pick = pickSkill([{ options, read: whichRead({ debug: 0.4, "(none)": 0.1 }) }]);
    expect(pick).toEqual({ kind: "none", reason: "below", p: 0.4 });
    expect("gate" in pick).toBe(false);
  });
  test("Every batch led by none", () => {
    const r = whichRead({ debug: 0.1, "(none)": 0.9 });
    const pick = pickSkill([
      { options, read: r },
      { options, read: r },
    ]);
    expect(pick).toEqual({ kind: "none", reason: "none-leads" });
  });
  test("None leads carries the gate mean", () => {
    const r = whichRead({ debug: 0.1, "(none)": 0.9 }, gateOnly(0.6));
    expect(pickSkill([{ options, read: r }])).toEqual({
      kind: "none",
      reason: "none-leads",
      gate: 0.6,
    });
  });
  test("No batch", () => {
    const pick = pickSkill([]);
    expect(pick).toEqual({ kind: "none", reason: "no-batch" });
    expect("p" in pick).toBe(false);
    expect("gate" in pick).toBe(false);
  });
  test("Best across batches", () => {
    const pick = pickSkill([
      { options: ["plan", "(none)"], read: whichRead({ plan: 0.55, "(none)": 0.1 }) },
      { options: ["deploy", "(none)"], read: whichRead({ deploy: 0.7, "(none)": 0.1 }) },
    ]);
    expect(pick).toMatchObject({ kind: "picked", name: "deploy", p: 0.7 });
  });
  test("Tie across batches", () => {
    const pick = pickSkill([
      { options: ["plan", "(none)"], read: whichRead({ plan: 0.6, "(none)": 0.1 }) },
      { options: ["deploy", "(none)"], read: whichRead({ deploy: 0.6, "(none)": 0.1 }) },
    ]);
    expect(pick).toMatchObject({ kind: "picked", name: "plan" });
  });
  test("Jev failure on a later batch", () => {
    const pick = pickSkill([
      { options, read: whichRead({ debug: 0.9, "(none)": 0.1 }) },
      { options, read: undefined },
    ]);
    expect(pick).toEqual({ kind: "none", reason: "failed" });
  });
  test("Schema miss on a batch", () => {
    const pick = pickSkill([{ options, read: { kind: "miss", miss: "schema" } }]);
    expect(pick).toEqual({ kind: "none", reason: "failed" });
    expect("p" in pick).toBe(false);
    expect("gate" in pick).toBe(false);
  });
  test("Which answered with a noul", () => {
    const pick = pickSkill([{ options, read: read({ which: noul(0.9) }, {}) }]);
    expect(pick).toEqual({ kind: "none", reason: "failed" });
    expect("p" in pick).toBe(false);
    expect("gate" in pick).toBe(false);
  });
  test("Unreadable which", () => {
    const pick = pickSkill([{ options, read: read({}, { which: "missing" }) }]);
    expect(pick).toEqual({ kind: "none", reason: "failed" });
  });
});

describe("deliveryForm", () => {
  const base = { name: "debug", fingerprint: "f1" };
  test("First pick on the branch", () => {
    expect(deliveryForm({ ...base, inject: "content", loaded: [] })).toBe("content");
  });
  test("Same body already in context", () => {
    const loaded = [{ name: "debug", fingerprint: "f1" }];
    expect(deliveryForm({ ...base, inject: "content", loaded })).toBe("reference");
  });
  test("Skill edited since", () => {
    const loaded = [{ name: "debug", fingerprint: "f0" }];
    expect(deliveryForm({ ...base, inject: "content", loaded })).toBe("content");
  });
  test("Suggest configured", () => {
    expect(deliveryForm({ ...base, inject: "suggest", loaded: [] })).toBe("suggest");
  });
  test("Another skill in context", () => {
    const loaded = [{ name: "plan", fingerprint: "f1" }];
    expect(deliveryForm({ ...base, inject: "content", loaded })).toBe("content");
  });
});

describe("deliveryText", () => {
  const skill = {
    name: "debug",
    path: "/s/debug/SKILL.md",
    baseDir: "/s/debug",
    body: "Step one.",
  };
  const docs = readFileSync(new URL("../../docs/jev-questions.md", import.meta.url), "utf8");
  function template(form: string): string {
    const at = docs.indexOf(`**\`${form}\`**`);
    expect(at).toBeGreaterThan(-1);
    const open = docs.indexOf("```text\n", at) + "```text\n".length;
    return docs.slice(open, docs.indexOf("\n```", open));
  }
  function expected(form: string, s: typeof skill): string {
    return template(form)
      .split("<name>")
      .join(s.name)
      .split("<path>")
      .join(s.path)
      .split("<baseDir>")
      .join(s.baseDir)
      .split("<body>")
      .join(s.body);
  }
  test("Content form", () => {
    const text = deliveryText("content", skill);
    expect(text).toBe(expected("content", skill));
    expect(text.split("Step one.").length - 1).toBe(1);
  });
  test("Suggest form", () => {
    const text = deliveryText("suggest", skill);
    expect(text).toBe(expected("suggest", skill));
    expect(text).not.toContain("Step one.");
  });
  test("Reference form", () => {
    const text = deliveryText("reference", skill);
    expect(text).toBe(expected("reference", skill));
    expect(text).not.toContain(skill.path);
  });
  test("Special characters in a path", () => {
    const odd = { ...skill, path: "/s/$&/$1/SKILL.md", body: "cost $& more" };
    const text = deliveryText("content", odd);
    expect(text).toContain('location="/s/$&/$1/SKILL.md"');
    expect(text).toContain("cost $& more");
    expect(text).toBe(expected("content", odd));
  });
});
