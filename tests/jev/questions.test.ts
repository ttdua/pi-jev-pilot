import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
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
    expect(specs["tier"]).toEqual({ type: "choice", options: ["basic", "broad", "deep"] });
    expect(specs["strategy"]).toEqual({
      type: "choice",
      options: ["direct", "delegate", "parallel", "graph"],
    });
    expect(specs["corrects"]).toEqual({ type: "noul" });
  });

  test("main effort instruction rates replies by context", () => {
    const text = MAIN_EFFORT_INSTRUCTION;
    expect(
      text.startsWith("How much step-by-step reasoning does the work this request asks for need?"),
    ).toBe(true);
    expect(
      text.endsWith(
        "A reply to the assistant's own question, proposal, review or approval request, such as approving it, picking an option, answering it or asking to continue, whatever its length and however it is formatted, takes the size of the work it approves or starts, judged from the recent conversation rather than from the reply's own text.",
      ),
    ).toBe(true);
    expect(text).not.toMatch(/\bshort\b/);
  });

  test("main effort criteria unchanged", () => {
    const effort = mainQuestions({ askEffort: true, askStrategy: false }).wire["effort"]!;
    expect(Object.keys(effort.criteria)).toEqual(["high", "medium", "xhigh", "low", "max"]);
    expect(effort.criteria).toEqual({
      low: "Answered from what is already known, or mechanical work with nothing to work out: a lookup, a single command, a rename or find-and-replace (even across many files), a search that lists what it finds, formatting, a one-line change.",
      medium:
        "An ordinary, well-specified change to one or a few files, or a direct question about code already in view.",
      high: "A change across several files that needs working out, a bug whose cause is described but has to be traced, writing tests, or reviewing a diff with care.",
      xhigh:
        "Design across several components, a bug whose cause is unknown, a refactor with many dependents, or careful reasoning about concurrency, performance or failure modes.",
      max: "Novel architecture, a security or data-integrity question, a failure that resisted earlier attempts, or work where a subtle mistake is costly and hard to undo.",
    });
    expect(effort.criteria).toEqual(WORKER_EFFORT_QUESTION.criteria);
  });

  test("worker effort instruction unchanged", () => {
    expect(WORKER_EFFORT_QUESTION.instructions).toBe(
      "How much step-by-step reasoning does a subagent need to carry out this brief? A brief that already names the files, the steps and the tests has done the design: carrying it out is execution. Rate higher only when the brief itself asks for design, an unknown cause, or reasoning that is not already written out. Rate the work, not how important the topic sounds: reviewing a small diff is medium, even for security.",
    );
  });

  test("main tier uses the main criteria with no prefix and no frontier", () => {
    const tier = mainQuestions({ askEffort: false, askStrategy: true }).wire["tier"]!;
    expect(tier.instructions).toBe(TIER_INSTRUCTION);
    expect(Object.keys(tier.criteria)).toEqual(["basic", "broad", "deep"]);
    expect(tier.criteria["basic"]).toBe(MAIN_TIER_CRITERIA.basic);
    expect(tier.criteria["broad"]).toBe(MAIN_TIER_CRITERIA.broad);
    expect(tier.criteria["deep"]).toBe(MAIN_TIER_CRITERIA.deep);
    expect("frontier" in tier.criteria).toBe(false);
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
    a.wire["tier"]!.criteria["basic"] = "changed";
    a.wire["strategy"]!.criteria["direct"] = "changed";
    const b = mainQuestions({ askEffort: true, askStrategy: true });
    expect(b.wire["risky"]!.instructions).not.toBe("changed");
    expect(b.wire["risky"]!.criteria["true"]).not.toBe("changed");
    expect(b.wire["corrects"]!.criteria["false"]).not.toBe("changed");
    expect(b.wire["tier"]!.criteria["basic"]).not.toBe("changed");
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
      "The main request's `tier` uses its own `basic`, `broad` and `deep` criteria, without the display-name prefix.",
    );
  });
});
const ALL = { basic: "a/b", broad: "c/d", deep: "e/f", frontier: "g/h" };

describe("Offered tiers", () => {
  test("Partial configuration", () => {
    expect(offeredTiers({ basic: "a/b", deep: "c/d" }, true)).toEqual(["basic", "deep"]);
  });
  test("Expert switched off", () => {
    expect(offeredTiers(ALL, false)).toEqual(["basic", "broad", "deep"]);
  });
  test("Empty value is not configured", () => {
    expect(offeredTiers({ basic: "", broad: "c/d" }, true)).toEqual(["broad"]);
  });
});

describe("Worker questions", () => {
  test("No tier configured", () => {
    const { questions } = buildWorkerQuestions([], {});
    expect(Object.keys(questions)).toEqual(["effort", "risky"]);
  });
  test("Expert offered", () => {
    const { questions, specs } = buildWorkerQuestions(["basic", "broad", "deep", "frontier"], {});
    expect(Object.keys(questions)).toEqual(["tier", "effort", "risky"]);
    expect(Object.keys(questions["tier"]!.criteria).at(-1)).toBe("frontier");
    expect(specs["risky"]).toEqual({ type: "noul" });
    expect(specs["effort"]).toEqual({
      type: "choice",
      options: ["high", "medium", "xhigh", "low", "max"],
    });
  });
  test("Asked and accepted agree", () => {
    const { questions, specs } = buildWorkerQuestions(["basic", "deep"], {});
    const spec = specs["tier"];
    expect(spec).toEqual({ type: "choice", options: ["basic", "deep"] });
    expect(Object.keys(questions["tier"]!.criteria)).toEqual(
      spec?.type === "choice" ? [...spec.options] : [],
    );
  });
});

describe("Question wording", () => {
  const all = ["basic", "broad", "deep", "frontier"] as const;
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
    expect(rows.map((r) => r[1])).toEqual(["basic", "broad", "deep", "frontier"]);
    for (const [, tier, text] of rows) {
      expect(WORKER_TIER_CRITERIA[tier as "basic"]).toBe(text!);
    }
    expect(
      WORKER_TIER_CRITERIA.basic.startsWith(
        "Fast and low cost, for bounded work with nothing to decide",
      ),
    ).toBe(true);
    expect(WORKER_TIER_CRITERIA.deep.startsWith("For careful judgment or long work")).toBe(true);
    expect(
      WORKER_TIER_CRITERIA.frontier.startsWith(
        "Rare. Choose only for exceptionally difficult architectural or advisory reasoning",
      ),
    ).toBe(true);
  });
  test("rubric version 2 pins the wording", () => {
    expect(RUBRIC_VERSION).toBe(2);
    expect({ instruction: TIER_INSTRUCTION, criteria: WORKER_TIER_CRITERIA }).toEqual({
      instruction: "Which is the cheapest tier that can complete this coding task well?",
      criteria: {
        basic:
          "Fast and low cost, for bounded work with nothing to decide. Choose when the task itself says exactly what to do and a mistake is cheap to spot: searching or reading and reporting what is there, running commands and reporting the result, mechanical edits such as a rename, a typo, a config value, applying changes already written out in the brief, or a small change to one file that a named check confirms.",
        broad:
          "The default for ordinary engineering. Choose when some working out is needed inside a clear spec: a feature or fix across a few files with a test, build or type check that shows it works, a bug whose cause is known, writing tests for existing code, a scoped refactor, reviewing a small or medium diff, or summarizing and explaining code.",
        deep: "For careful judgment or long work. Choose when the spec is open or nothing can check the result, the cause of a bug is unknown, the change spans many components or needs design decisions, or it touches security, data migrations, concurrency, production or money. A large cross-cutting review belongs here too.",
        frontier:
          "Rare. Choose only for exceptionally difficult architectural or advisory reasoning that resolves a specific unresolved technical decision with tightly interacting constraints or conflicting evidence, where the expected result is a reusable diagnosis, decision or plan. Ordinary design, review, implementation, long tasks and security or production labels are not expert work; an agent's title grants no eligibility.",
      },
    });
  });
  test("main criteria are separate data", () => {
    expect(MAIN_TIER_CRITERIA).not.toBe(WORKER_TIER_CRITERIA);
    for (const tier of ["basic", "broad", "deep"] as const) {
      expect(MAIN_TIER_CRITERIA[tier]).toBe(WORKER_TIER_CRITERIA[tier]);
    }
    expect(MAIN_TIER_QUESTION.criteria).toEqual(MAIN_TIER_CRITERIA);
  });
  test("no slot: tier options are the four tiers", () => {
    const { specs } = buildWorkerQuestions(all, {});
    expect(specs["tier"]).toEqual({ type: "choice", options: [...all] });
  });
  test("Display name prefix", () => {
    const { questions } = buildWorkerQuestions(["basic"], { basic: "Claude Haiku 5.5" });
    expect(
      questions["tier"]!.criteria["basic"]!.startsWith("Claude Haiku 5.5. Fast and low cost"),
    ).toBe(true);
  });
  test("Missing display name", () => {
    const { questions } = buildWorkerQuestions(["broad"], {});
    expect(questions["tier"]!.criteria["broad"]).toBe(WORKER_TIER_CRITERIA.broad);
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
    const { questions, specs } = buildWorkerQuestions(["basic", "broad"], {}, [reviewer, bulk]);
    const expected = ["basic", "broad", "slot::reviewer", "slot::bulk"];
    expect(optionsOf(specs["tier"])).toEqual(expected);
    expect(Object.keys(questions["tier"]!.criteria)).toEqual(expected);
  });
  test("No slot, request unchanged", () => {
    const names = { basic: "Haiku" };
    const a = buildWorkerQuestions(["basic", "deep", "frontier"], names);
    const b = buildWorkerQuestions(["basic", "deep", "frontier"], names, []);
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
    const { specs } = buildWorkerQuestions(["basic"], {}, [reviewer]);
    const body = {
      answers: {
        tier: {
          type: "choice",
          choice: "slot::reviewer",
          probabilities: { basic: 0.1, "slot::reviewer": 0.9 },
        },
      },
    };
    const r = readWorkerOutcome({ kind: "ok", body }, specs);
    if (r.kind !== "read") throw new Error("expected read");
    const tier = r.answers["tier"];
    if (tier?.type !== "choice") throw new Error("expected choice");
    expect(tier.choice).toBe("slot::reviewer");
    expect(tier.probabilities).toEqual({ basic: 0.1, "slot::reviewer": 0.9 });
  });
  test("Main request with a slot configured", () => {
    const { wire } = mainQuestions({ askEffort: true, askStrategy: true });
    expect(JSON.stringify(wire)).not.toContain("slot::");
  });
  test("Expert offered", () => {
    const { questions } = buildWorkerQuestions(["basic", "frontier"], {}, [reviewer]);
    expect(Object.keys(questions["tier"]!.criteria)).toEqual([
      "basic",
      "frontier",
      "slot::reviewer",
    ]);
    expect(Object.keys(questions)).not.toContain("expert_needed");
  });
  test("Asked and accepted agree with a slot", () => {
    const { questions, specs } = buildWorkerQuestions(["basic", "deep"], {}, [reviewer]);
    const expected = ["basic", "deep", "slot::reviewer"];
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
