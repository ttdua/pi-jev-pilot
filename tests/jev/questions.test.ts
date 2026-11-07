import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  buildToolQuestions,
  buildWorkerQuestions,
  mainQuestions,
  offeredTiers,
  skillBatchQuestions,
  type WireQuestion,
} from "../../src/jev/questions.ts";
import {
  CORRECTS_QUESTION,
  EXPERT_NEEDED_QUESTIONS,
  GATE_QUESTIONS,
  MAIN_EFFORT_INSTRUCTION,
  NONE_CRITERION,
  RISKY_QUESTION,
  TIER_CRITERIA,
  TIER_INSTRUCTION,
  WHICH_INSTRUCTION,
  WORKER_EFFORT_QUESTION,
} from "../../src/jev/rubrics.ts";
import { GATE_KEYS, skillCriterion } from "../../src/policy/skill.ts";
import { EFFORT_LEVELS } from "../../src/policy/effort.ts";
import { MODE_NAMES } from "../../src/policy/modes.ts";

const docs = readFileSync(new URL("../../docs/jev-questions.md", import.meta.url), "utf8");

describe("mainQuestions", () => {
  test.each([
    [true, true, ["effort", "risky", "tier", "strategy", "corrects"]],
    [false, true, ["tier", "strategy", "corrects"]],
    [true, false, ["effort", "risky", "corrects"]],
    [false, false, ["corrects"]],
  ] as const)("askEffort %p askStrategy %p gives %p", (askEffort, askStrategy, keys) => {
    const { wire, specs } = mainQuestions({ askEffort, askStrategy });
    expect(Object.keys(wire)).toEqual([...keys]);
    expect(Object.keys(specs)).toEqual([...keys]);
  });

  test("specs for effort, risky, tier, strategy and corrects", () => {
    const { specs } = mainQuestions({ askEffort: true, askStrategy: true });
    expect(specs["effort"]).toEqual({ type: "choice", options: EFFORT_LEVELS });
    expect(specs["risky"]).toEqual({ type: "noul" });
    expect(specs["tier"]).toEqual({ type: "choice", options: ["fast", "balanced", "deep"] });
    expect(specs["strategy"]).toEqual({
      type: "choice",
      options: ["direct", "delegate", "parallel", "graph"],
    });
    expect(specs["corrects"]).toEqual({ type: "noul" });
  });

  test("main tier uses the standard wording with no prefix and no expert", () => {
    const tier = mainQuestions({ askEffort: false, askStrategy: true }).wire["tier"]!;
    expect(tier.instructions).toBe(TIER_INSTRUCTION);
    expect(Object.keys(tier.criteria)).toEqual(["fast", "balanced", "deep"]);
    expect(tier.criteria["fast"]).toBe(TIER_CRITERIA.standard.fast);
    expect(tier.criteria["balanced"]).toBe(TIER_CRITERIA.standard.balanced);
    expect(tier.criteria["deep"]).toBe(TIER_CRITERIA.standard.deep);
    expect("expert" in tier.criteria).toBe(false);
  });

  test("effort has the choice wire shape with five ordered criteria", () => {
    const effort = mainQuestions({ askEffort: true, askStrategy: true }).wire["effort"]!;
    expect(Object.keys(effort).sort()).toEqual(["criteria", "instructions", "type"]);
    expect(effort.type).toBe("choice");
    expect(Object.keys(effort.criteria)).toEqual([...EFFORT_LEVELS]);
  });

  test("noul questions have true and false criteria", () => {
    const { wire } = mainQuestions({ askEffort: true, askStrategy: true });
    for (const key of ["risky", "corrects"]) {
      const q = wire[key]!;
      expect(q.type).toBe("noul");
      expect(Object.keys(q.criteria)).toEqual(["true", "false"]);
    }
  });

  test("askEffort false asks only corrects", () => {
    const { wire, specs } = mainQuestions({ askEffort: false, askStrategy: false });
    expect(Object.keys(wire)).toEqual(["corrects"]);
    expect(Object.keys(specs)).toEqual(["corrects"]);
  });

  test("every instruction and criterion appears verbatim in docs/jev-questions.md", () => {
    const { wire } = mainQuestions({ askEffort: true, askStrategy: true });
    for (const q of Object.values(wire)) {
      expect(docs).toContain(q.instructions);
      for (const text of Object.values(q.criteria)) {
        expect(text.length).toBeGreaterThan(0);
        expect(docs).toContain(text);
      }
    }
  });

  test("results are fresh objects: mutation does not leak into the next call", () => {
    const a = mainQuestions({ askEffort: true, askStrategy: true });
    a.wire["risky"]!.instructions = "changed";
    a.wire["risky"]!.criteria["true"] = "changed";
    a.wire["corrects"]!.criteria["false"] = "changed";
    a.wire["tier"]!.criteria["fast"] = "changed";
    a.wire["strategy"]!.criteria["direct"] = "changed";
    const b = mainQuestions({ askEffort: true, askStrategy: true });
    expect(b.wire["risky"]!.instructions).not.toBe("changed");
    expect(b.wire["risky"]!.criteria["true"]).not.toBe("changed");
    expect(b.wire["corrects"]!.criteria["false"]).not.toBe("changed");
    expect(b.wire["tier"]!.criteria["fast"]).not.toBe("changed");
    expect(b.wire["strategy"]!.criteria["direct"]).not.toBe("changed");
  });

  test("effort criteria match the docs table rows", () => {
    const effort = mainQuestions({ askEffort: true, askStrategy: true }).wire["effort"]!;
    for (const level of EFFORT_LEVELS) {
      expect(docs).toContain(
        `| \`${level}\` | ${(effort.criteria as Record<string, string>)[level]} |`,
      );
    }
  });
});

const DOC = readFileSync(new URL("../../docs/jev-questions.md", import.meta.url), "utf8");

describe("Strategy docs", () => {
  test("docs state precedence", () => {
    const contract = readFileSync(new URL("../../docs/jev-contract.md", import.meta.url), "utf8");
    expect(contract).toContain(
      "User and project instructions and a loaded skill keep authority over this advice.",
    );
  });
  test("docs state no prefix", () => {
    expect(DOC).toContain(
      "The main request's `tier` uses these criteria for `fast`, `balanced` and `deep`, without the display-name prefix.",
    );
  });
});
const ALL = { fast: "a/b", balanced: "c/d", deep: "e/f", expert: "g/h" };

describe("Offered tiers", () => {
  test("Partial configuration", () => {
    expect(offeredTiers({ fast: "a/b", deep: "c/d" }, true)).toEqual(["fast", "deep"]);
  });
  test("Expert switched off", () => {
    expect(offeredTiers(ALL, false)).toEqual(["fast", "balanced", "deep"]);
  });
  test("Empty value is not configured", () => {
    expect(offeredTiers({ fast: "", balanced: "c/d" }, true)).toEqual(["balanced"]);
  });
});

describe("Worker questions", () => {
  test("No tier configured", () => {
    const { questions } = buildWorkerQuestions([], {}, "standard");
    expect(Object.keys(questions)).toEqual(["effort", "risky"]);
  });
  test("Expert offered", () => {
    const { questions, specs } = buildWorkerQuestions(
      ["fast", "balanced", "deep", "expert"],
      {},
      "standard",
    );
    expect(Object.keys(questions)).toEqual(["tier", "effort", "risky", "expert_needed"]);
    expect(Object.keys(questions["tier"]!.criteria).at(-1)).toBe("expert");
    expect(specs["risky"]).toEqual({ type: "noul" });
    expect(specs["expert_needed"]).toEqual({ type: "noul" });
    expect(specs["effort"]).toEqual({
      type: "choice",
      options: ["low", "medium", "high", "xhigh", "max"],
    });
  });
  test("Asked and accepted agree", () => {
    const { questions, specs } = buildWorkerQuestions(["fast", "deep"], {}, "standard");
    const spec = specs["tier"];
    expect(spec).toEqual({ type: "choice", options: ["fast", "deep"] });
    expect(Object.keys(questions["tier"]!.criteria)).toEqual(
      spec?.type === "choice" ? [...spec.options] : [],
    );
  });
});

describe("Question wording", () => {
  test("Wording matches the docs", () => {
    const { questions } = buildWorkerQuestions(
      ["fast", "balanced", "deep", "expert"],
      {},
      "standard",
    );
    const texts: string[] = [TIER_INSTRUCTION];
    for (const q of [WORKER_EFFORT_QUESTION, RISKY_QUESTION, EXPERT_NEEDED_QUESTIONS.standard]) {
      texts.push(q.instructions, ...Object.values(q.criteria));
    }
    texts.push(...Object.values(TIER_CRITERIA.standard));
    for (const text of texts) {
      expect(text.length).toBeGreaterThan(0);
      expect(DOC).toContain(text);
    }
    for (const q of Object.values(questions)) {
      expect(q.instructions.length).toBeGreaterThan(0);
      expect(DOC).toContain(q.instructions);
      for (const c of Object.values(q.criteria)) expect(DOC).toContain(c);
    }
    expect(questions["tier"]!.instructions).toBe(TIER_INSTRUCTION);
    expect(Object.keys(RISKY_QUESTION.criteria)).toEqual(["true", "false"]);
    expect(Object.keys(EXPERT_NEEDED_QUESTIONS.standard.criteria)).toEqual(["true", "false"]);
    expect(Object.keys(WORKER_EFFORT_QUESTION.criteria)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    const quote = DOC.split("**Worker instruction:**")[1]!.split("\n")[2]!.replace(/^> /, "");
    expect(WORKER_EFFORT_QUESTION.instructions).toBe(quote);
  });
  test("Display name prefix", () => {
    const { questions } = buildWorkerQuestions(["fast"], { fast: "Claude Haiku 5.5" }, "standard");
    expect(
      questions["tier"]!.criteria["fast"]!.startsWith("Claude Haiku 5.5. Fast and low cost"),
    ).toBe(true);
  });
  test("Missing display name", () => {
    const { questions } = buildWorkerQuestions(["balanced"], {}, "standard");
    expect(questions["tier"]!.criteria["balanced"]).toBe(TIER_CRITERIA.standard.balanced);
  });
});

describe("Modes", () => {
  const all = ["fast", "balanced", "deep", "expert"] as const;
  test("Wording matches the docs in every mode", () => {
    for (const mode of MODE_NAMES) {
      const { questions } = buildWorkerQuestions(all, {}, mode);
      for (const q of Object.values(questions)) {
        expect(DOC).toContain(q.instructions);
        for (const c of Object.values(q.criteria)) expect(DOC).toContain(c);
      }
    }
  });
  test("Standard request unchanged", () => {
    expect(
      TIER_CRITERIA.standard.fast.startsWith(
        "Fast and low cost, for bounded work with nothing to decide",
      ),
    ).toBe(true);
    const section = docs.split("### `standard`")[1]!.split("\n### ")[0]!;
    const rows = [...section.matchAll(/^\| `(\w+)` \| (.+) \|$/gm)];
    expect(rows.map((r) => r[1])).toEqual(["fast", "balanced", "deep", "expert"]);
    for (const [, tier, text] of rows) {
      expect(TIER_CRITERIA.standard[tier as "fast"]).toBe(text!);
    }
    const afterMarker = docs.split("**In `budget` and `standard`:**")[1]!;
    const quoted = /^> (.+)$/m.exec(afterMarker)![1]!;
    expect(EXPERT_NEEDED_QUESTIONS.standard.instructions).toBe(quoted);
  });
  test("Budget expert criterion", () => {
    expect(TIER_CRITERIA.budget.expert).toBe(TIER_CRITERIA.standard.expert);
    expect(EXPERT_NEEDED_QUESTIONS.budget).toBe(EXPERT_NEEDED_QUESTIONS.standard);
  });
  test("Premium wording", () => {
    expect(TIER_CRITERIA.premium.deep.startsWith("The default for real engineering")).toBe(true);
    expect(
      EXPERT_NEEDED_QUESTIONS.premium.instructions.startsWith(
        "This task needs the strongest available reasoning",
      ),
    ).toBe(true);
  });
  test("Expert still asked in premium", () => {
    const { questions } = buildWorkerQuestions(all, {}, "premium");
    expect(Object.keys(questions)).toEqual(["tier", "effort", "risky", "expert_needed"]);
  });
  test("Only the tier criteria and expert wording differ", () => {
    const b = buildWorkerQuestions(all, {}, "budget");
    const p = buildWorkerQuestions(all, {}, "premium");
    expect(b.questions["tier"]!.instructions).toBe(p.questions["tier"]!.instructions);
    expect(b.questions["tier"]!.criteria).not.toEqual(p.questions["tier"]!.criteria);
    expect(b.questions["effort"]).toEqual(p.questions["effort"]);
    expect(b.questions["risky"]).toEqual(p.questions["risky"]);
    expect(b.specs).toEqual(p.specs);
  });
  test("Main request ignores the mode", () => {
    const main = mainQuestions({ askEffort: true });
    expect(main.wire).toEqual({
      effort: {
        type: "choice",
        instructions: MAIN_EFFORT_INSTRUCTION,
        criteria: { ...WORKER_EFFORT_QUESTION.criteria },
      },
      risky: RISKY_QUESTION,
      corrects: CORRECTS_QUESTION,
    });
    expect(main.wire).not.toHaveProperty("tier");
  });
});

describe("Skill wording", () => {
  test("which instruction and none criterion are verbatim in the docs", () => {
    expect(docs).toContain(`> ${WHICH_INSTRUCTION}\n`);
    expect(docs).toContain(`> ${NONE_CRITERION}\n`);
  });
  for (const key of GATE_KEYS) {
    test(`gate ${key} is bare noul and verbatim`, () => {
      const q = GATE_QUESTIONS[key];
      expect(Object.keys(q).sort()).toEqual(["instructions", "type"]);
      expect(q.type).toBe("noul");
      const tail = key === "gate::prose_suffices" ? " Inverted when averaged. |" : " |";
      expect(docs).toContain(`| \`${key}\` | ${q.instructions}${tail}`);
    });
  }
});

describe("skill questions", () => {
  const skills = [
    { name: "debug", description: "Debug failures" },
    { name: "plan" },
    { name: "review" },
  ];
  const gateKeys = [...GATE_KEYS];

  test("First batch with effort", () => {
    const { wire, specs } = mainQuestions({ askEffort: true, skills });
    const keys = ["effort", "risky", "corrects", "which", ...gateKeys];
    expect(Object.keys(wire)).toEqual(keys);
    expect(Object.keys(specs)).toEqual(keys);
  });

  test("First batch without effort", () => {
    const { wire, specs } = mainQuestions({ askEffort: false, skills });
    const keys = ["corrects", "which", ...gateKeys];
    expect(Object.keys(wire)).toEqual(keys);
    expect(Object.keys(specs)).toEqual(keys);
  });

  test("Which option order", () => {
    const { wire, specs } = mainQuestions({ askEffort: false, skills });
    const which = wire["which"] as WireQuestion;
    const order = ["debug", "plan", "review", "(none)"];
    expect(which.type).toBe("choice");
    expect(which.instructions).toBe(WHICH_INSTRUCTION);
    expect(Object.keys(which.criteria)).toEqual(order);
    expect(specs["which"]).toEqual({ type: "choice", options: order });
    expect(which.criteria["debug"]).toBe(skillCriterion(skills[0]!));
    expect(which.criteria["plan"]).toBe(skillCriterion(skills[1]!));
    expect(which.criteria["(none)"]).toBe(NONE_CRITERION);
  });

  test("which options keep catalog order for integer-like names", () => {
    const { specs } = skillBatchQuestions([{ name: "debug" }, { name: "123" }, { name: "plan" }]);
    expect(specs["which"]).toEqual({
      type: "choice",
      options: ["debug", "123", "plan", "(none)"],
    });
  });

  test("which keeps a skill named __proto__", () => {
    const { wire, specs } = skillBatchQuestions([{ name: "__proto__" }, { name: "plan" }]);
    const which = wire["which"] as WireQuestion;
    expect(Object.keys(which.criteria)).toContain("__proto__");
    expect(specs["which"]).toEqual({
      type: "choice",
      options: ["__proto__", "plan", "(none)"],
    });
  });

  test("Later batch", () => {
    const { wire, specs } = skillBatchQuestions(skills);
    expect(Object.keys(wire)).toEqual(["which"]);
    expect(Object.keys(specs)).toEqual(["which"]);
    expect(specs["which"]).toEqual({
      type: "choice",
      options: ["debug", "plan", "review", "(none)"],
    });
  });

  test("Skills not asked", () => {
    for (const askEffort of [true, false]) {
      const base = mainQuestions({ askEffort });
      expect(Object.keys(base.wire)).toEqual(
        askEffort ? ["effort", "risky", "corrects"] : ["corrects"],
      );
      expect(base.wire["corrects"]).toEqual(CORRECTS_QUESTION);
      expect(mainQuestions({ askEffort, skills: undefined })).toEqual(base);
      expect(mainQuestions({ askEffort, skills: [] })).toEqual(base);
    }
  });

  test("Skill gate shape", () => {
    const { wire, specs } = mainQuestions({ askEffort: false, skills });
    for (const key of GATE_KEYS) {
      expect(Object.keys(wire[key]!).sort()).toEqual(["instructions", "type"]);
      expect(wire[key]).toEqual({ type: "noul", instructions: GATE_QUESTIONS[key].instructions });
      expect(specs[key]).toEqual({ type: "noul" });
    }
  });

  test("returns fresh copies per call", () => {
    const first = mainQuestions({ askEffort: false, skills });
    first.wire["gate::prose_suffices"]!.instructions = "changed";
    (first.wire["which"] as WireQuestion).criteria["debug"] = "changed";
    const second = mainQuestions({ askEffort: false, skills });
    expect(second.wire["gate::prose_suffices"]!.instructions).toBe(
      GATE_QUESTIONS["gate::prose_suffices"].instructions,
    );
    expect((second.wire["which"] as WireQuestion).criteria["debug"]).toBe(
      skillCriterion(skills[0]!),
    );
    expect(GATE_QUESTIONS["gate::prose_suffices"].instructions).not.toBe("changed");
  });
});

describe("buildToolQuestions", () => {
  test("One noul per candidate", () => {
    const { questions, specs } = buildToolQuestions(["read", "edit", "bash"]);
    expect(Object.keys(questions)).toEqual(["tool::read", "tool::edit", "tool::bash"]);
    expect(Object.keys(specs)).toEqual(["tool::read", "tool::edit", "tool::bash"]);
    for (const key of Object.keys(questions)) {
      expect(questions[key]!.type).toBe("noul");
      expect(specs[key]).toEqual({ type: "noul" });
    }
    const edit = questions["tool::edit"]!;
    expect(edit.instructions).toContain("`tools.edit`");
    const section = docs.split("## Tool assessment")[1]!.split("\n## ")[0]!;
    expect(edit.criteria["true"]).toBe(section.match(/^- `true`: (.*)$/m)![1]!);
    expect(edit.criteria["false"]).toBe(section.match(/^- `false`: (.*)$/m)![1]!);
    const quote = section.match(/^> (.*)$/m)![1]!;
    expect(edit.instructions).toBe(quote.replace("`tools.<name>`", "`tools.edit`"));
  });
  test("Fresh objects per call", () => {
    const first = buildToolQuestions(["read"]);
    first.questions["tool::read"]!.criteria["true"] = "x";
    first.questions["tool::read"]!.instructions = "x";
    first.specs["tool::read"] = { type: "choice", options: [] };
    const next = buildToolQuestions(["read"]);
    expect(next.questions["tool::read"]!.criteria["true"]).not.toBe("x");
    expect(next.questions["tool::read"]!.instructions).not.toBe("x");
    expect(next.specs["tool::read"]).toEqual({ type: "noul" });
  });
});
