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
import type { QuestionSpec } from "../../src/policy/answers.ts";
import { readWorkerOutcome } from "../../src/policy/worker/answers.ts";
import {
  CORRECTS_QUESTION,
  GATE_QUESTIONS,
  MAIN_EFFORT_INSTRUCTION,
  NONE_CRITERION,
  RISKY_QUESTION,
  SLOT_CRITERION_INFIX,
  MAIN_TIER_CRITERIA,
  MAIN_TIER_QUESTION,
  RUBRIC_VERSION,
  TIER_INSTRUCTION,
  WORKER_TIER_CRITERIA,
  WHICH_INSTRUCTION,
  WORKER_EFFORT_QUESTION,
} from "../../src/jev/rubrics.ts";
import { GATE_KEYS, skillCriterion } from "../../src/policy/main/skill.ts";
import { EFFORT_LEVELS, EFFORT_OPTION_ORDER } from "../../src/policy/effort.ts";

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
    expect(specs["effort"]).toEqual({ type: "choice", options: EFFORT_OPTION_ORDER });
    expect(specs["risky"]).toEqual({ type: "noul" });
    expect(specs["tier"]).toEqual({ type: "choice", options: ["fast", "balanced", "deep"] });
    expect(specs["strategy"]).toEqual({
      type: "choice",
      options: ["direct", "delegate", "parallel", "graph"],
    });
    expect(specs["corrects"]).toEqual({ type: "noul" });
  });

  test("main tier uses the main criteria with no prefix and no expert", () => {
    const tier = mainQuestions({ askEffort: false, askStrategy: true }).wire["tier"]!;
    expect(tier.instructions).toBe(TIER_INSTRUCTION);
    expect(Object.keys(tier.criteria)).toEqual(["fast", "balanced", "deep"]);
    expect(tier.criteria["fast"]).toBe(MAIN_TIER_CRITERIA.fast);
    expect(tier.criteria["balanced"]).toBe(MAIN_TIER_CRITERIA.balanced);
    expect(tier.criteria["deep"]).toBe(MAIN_TIER_CRITERIA.deep);
    expect("expert" in tier.criteria).toBe(false);
  });

  test("effort has the choice wire shape with five ordered criteria", () => {
    const effort = mainQuestions({ askEffort: true, askStrategy: true }).wire["effort"]!;
    expect(Object.keys(effort).sort()).toEqual(["criteria", "instructions", "type"]);
    expect(effort.type).toBe("choice");
    expect(Object.keys(effort.criteria)).toEqual(["high", "medium", "xhigh", "low", "max"]);
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
      "The main request's `tier` uses its own `fast`, `balanced` and `deep` criteria, without the display-name prefix.",
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
    const { questions } = buildWorkerQuestions([], {});
    expect(Object.keys(questions)).toEqual(["effort", "risky"]);
  });
  test("Expert offered", () => {
    const { questions, specs } = buildWorkerQuestions(["fast", "balanced", "deep", "expert"], {});
    expect(Object.keys(questions)).toEqual(["tier", "effort", "risky"]);
    expect(Object.keys(questions["tier"]!.criteria).at(-1)).toBe("expert");
    expect(specs["risky"]).toEqual({ type: "noul" });
    expect(specs["effort"]).toEqual({
      type: "choice",
      options: ["high", "medium", "xhigh", "low", "max"],
    });
  });
  test("Asked and accepted agree", () => {
    const { questions, specs } = buildWorkerQuestions(["fast", "deep"], {});
    const spec = specs["tier"];
    expect(spec).toEqual({ type: "choice", options: ["fast", "deep"] });
    expect(Object.keys(questions["tier"]!.criteria)).toEqual(
      spec?.type === "choice" ? [...spec.options] : [],
    );
  });
});

describe("Question wording", () => {
  const all = ["fast", "balanced", "deep", "expert"] as const;
  const workerSection = (): string => DOC.split("### Worker rubric")[1]!.split("\n#")[0]!;

  test("worker questions never include expert_needed", () => {
    const { questions, specs } = buildWorkerQuestions(all, {});
    expect(Object.keys(questions)).toEqual(["tier", "effort", "risky"]);
    expect(Object.keys(specs)).toEqual(["tier", "effort", "risky"]);
  });
  test("Wording matches the docs", () => {
    const { questions } = buildWorkerQuestions(all, {});
    for (const q of Object.values(questions)) {
      expect(q.instructions.length).toBeGreaterThan(0);
      expect(DOC).toContain(q.instructions);
      for (const c of Object.values(q.criteria)) expect(DOC).toContain(c);
    }
    expect(questions["tier"]!.instructions).toBe(TIER_INSTRUCTION);
    expect(Object.keys(RISKY_QUESTION.criteria)).toEqual(["true", "false"]);
    expect(Object.keys(WORKER_EFFORT_QUESTION.criteria)).toEqual([
      "high",
      "medium",
      "xhigh",
      "low",
      "max",
    ]);
    const quote = DOC.split("**Worker instruction:**")[1]!.split("\n")[2]!.replace(/^> /, "");
    expect(WORKER_EFFORT_QUESTION.instructions).toBe(quote);
  });
  test("worker tier criteria equal the docs worker rubric", () => {
    const section = workerSection();
    const rows = [...section.matchAll(/^\| `(\w+)` \| (.+) \|$/gm)];
    expect(rows.map((r) => r[1])).toEqual(["fast", "balanced", "deep", "expert"]);
    for (const [, tier, text] of rows) {
      expect(WORKER_TIER_CRITERIA[tier as "fast"]).toBe(text!);
    }
    expect(
      WORKER_TIER_CRITERIA.fast.startsWith(
        "Fast and low cost, for bounded work with nothing to decide",
      ),
    ).toBe(true);
    expect(WORKER_TIER_CRITERIA.deep.startsWith("For careful judgment or long work")).toBe(true);
    expect(
      WORKER_TIER_CRITERIA.expert.startsWith(
        "Rare. Choose only for exceptionally difficult architectural or advisory reasoning",
      ),
    ).toBe(true);
  });
  test("rubric version 2 pins the wording", () => {
    expect(RUBRIC_VERSION).toBe(2);
    expect({ instruction: TIER_INSTRUCTION, criteria: WORKER_TIER_CRITERIA }).toEqual({
      instruction: "Which is the cheapest tier that can complete this coding task well?",
      criteria: {
        fast: "Fast and low cost, for bounded work with nothing to decide. Choose when the task itself says exactly what to do and a mistake is cheap to spot: searching or reading and reporting what is there, running commands and reporting the result, mechanical edits such as a rename, a typo, a config value, applying changes already written out in the brief, or a small change to one file that a named check confirms.",
        balanced:
          "The default for ordinary engineering. Choose when some working out is needed inside a clear spec: a feature or fix across a few files with a test, build or type check that shows it works, a bug whose cause is known, writing tests for existing code, a scoped refactor, reviewing a small or medium diff, or summarizing and explaining code.",
        deep: "For careful judgment or long work. Choose when the spec is open or nothing can check the result, the cause of a bug is unknown, the change spans many components or needs design decisions, or it touches security, data migrations, concurrency, production or money. A large cross-cutting review belongs here too.",
        expert:
          "Rare. Choose only for exceptionally difficult architectural or advisory reasoning that resolves a specific unresolved technical decision with tightly interacting constraints or conflicting evidence, where the expected result is a reusable diagnosis, decision or plan. Ordinary design, review, implementation, long tasks and security or production labels are not expert work; an agent's title grants no eligibility.",
      },
    });
  });
  test("main criteria are separate data", () => {
    expect(MAIN_TIER_CRITERIA).not.toBe(WORKER_TIER_CRITERIA);
    for (const tier of ["fast", "balanced", "deep"] as const) {
      expect(MAIN_TIER_CRITERIA[tier]).toBe(WORKER_TIER_CRITERIA[tier]);
    }
    expect(MAIN_TIER_QUESTION.criteria).toEqual(MAIN_TIER_CRITERIA);
  });
  test("no slot: tier options are the four tiers", () => {
    const { specs } = buildWorkerQuestions(all, {});
    expect(specs["tier"]).toEqual({ type: "choice", options: [...all] });
  });
  test("Display name prefix", () => {
    const { questions } = buildWorkerQuestions(["fast"], { fast: "Claude Haiku 5.5" });
    expect(
      questions["tier"]!.criteria["fast"]!.startsWith("Claude Haiku 5.5. Fast and low cost"),
    ).toBe(true);
  });
  test("Missing display name", () => {
    const { questions } = buildWorkerQuestions(["balanced"], {});
    expect(questions["tier"]!.criteria["balanced"]).toBe(WORKER_TIER_CRITERIA.balanced);
  });
});

describe("Modes", () => {
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

describe("Slot questions", () => {
  const reviewer = {
    name: "reviewer",
    model: "9router/gpt-6.1-sol",
    when: "Choose for reviews. Not for fixing.",
    displayName: "GPT-6.1 Sol",
  };
  const bulk = { name: "bulk", model: "a/b", when: "Bulk." };
  const optionsOf = (s: QuestionSpec | undefined): string[] =>
    s?.type === "choice" ? [...s.options] : [];

  test("Slots after tiers", () => {
    const { questions, specs } = buildWorkerQuestions(["fast", "balanced"], {}, [reviewer, bulk]);
    const expected = ["fast", "balanced", "slot::reviewer", "slot::bulk"];
    expect(optionsOf(specs["tier"])).toEqual(expected);
    expect(Object.keys(questions["tier"]!.criteria)).toEqual(expected);
  });
  test("No slot, request unchanged", () => {
    const names = { fast: "Haiku" };
    const a = buildWorkerQuestions(["fast", "deep", "expert"], names);
    const b = buildWorkerQuestions(["fast", "deep", "expert"], names, []);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  test("Slot alone", () => {
    const { questions, specs } = buildWorkerQuestions([], {}, [reviewer]);
    expect(Object.keys(questions)).toEqual(["tier", "effort", "risky"]);
    expect(optionsOf(specs["tier"])).toEqual(["slot::reviewer"]);
  });
  test("Reviewer criterion", () => {
    const { questions } = buildWorkerQuestions([], {}, [reviewer]);
    expect(questions["tier"]!.criteria["slot::reviewer"]).toBe(
      "GPT-6.1 Sol (a custom model). Choose for reviews. Not for fixing.",
    );
  });
  test("No display name", () => {
    const { questions } = buildWorkerQuestions([], {}, [
      bulk,
      { ...reviewer, displayName: undefined },
    ]);
    expect(
      questions["tier"]!.criteria["slot::reviewer"]!.startsWith(
        "9router/gpt-6.1-sol (a custom model). ",
      ),
    ).toBe(true);
  });
  test("Same on every build", () => {
    const build = (): string | undefined =>
      buildWorkerQuestions([], {}, [reviewer]).questions["tier"]!.criteria["slot::reviewer"];
    expect(build()).toBe(build());
  });
  test("Slot answer read", () => {
    const { specs } = buildWorkerQuestions(["fast"], {}, [reviewer]);
    const body = {
      answers: {
        tier: {
          type: "choice",
          choice: "slot::reviewer",
          probabilities: { fast: 0.1, "slot::reviewer": 0.9 },
        },
      },
    };
    const r = readWorkerOutcome({ kind: "ok", body }, specs);
    if (r.kind !== "read") throw new Error("expected read");
    const tier = r.answers["tier"];
    if (tier?.type !== "choice") throw new Error("expected choice");
    expect(tier.choice).toBe("slot::reviewer");
    expect(tier.probabilities).toEqual({ fast: 0.1, "slot::reviewer": 0.9 });
  });
  test("Main request with a slot configured", () => {
    const { wire } = mainQuestions({ askEffort: true, askStrategy: true });
    expect(JSON.stringify(wire)).not.toContain("slot::");
  });
  test("Expert offered", () => {
    const { questions } = buildWorkerQuestions(["fast", "expert"], {}, [reviewer]);
    expect(Object.keys(questions["tier"]!.criteria)).toEqual(["fast", "expert", "slot::reviewer"]);
    expect(Object.keys(questions)).not.toContain("expert_needed");
  });
  test("Asked and accepted agree with a slot", () => {
    const { questions, specs } = buildWorkerQuestions(["fast", "deep"], {}, [reviewer]);
    const expected = ["fast", "deep", "slot::reviewer"];
    expect(optionsOf(specs["tier"])).toEqual(expected);
    expect(Object.keys(questions["tier"]!.criteria)).toEqual(expected);
  });
  test("No tier and no slot", () => {
    const { questions } = buildWorkerQuestions([], {}, []);
    expect(Object.keys(questions)).toEqual(["effort", "risky"]);
  });
  test("Wording matches the docs", () => {
    expect(docs).toContain(SLOT_CRITERION_INFIX);
  });
});
