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
      low: "Little or no work: a lookup, a single command, a rename or find-and-replace (even across many files), a search that lists what it finds, formatting, or a one-line change. Nothing to trace; the output is the check.",
      medium:
        "A few steps: an ordinary, well-specified change to one or a few files with a check to run, or a direct question about code already in view.",
      high: "Several steps with tracing: a change across several files that needs working out, a bug whose cause is described but has to be traced, writing tests, or reviewing a diff with care.",
      xhigh:
        "Long reasoning and verification: design across several components, a bug whose cause is unknown, a refactor with many dependents to verify, or careful reasoning about concurrency, performance or failure modes.",
      max: "Heavy care: a failure that resisted earlier attempts, or work where a subtle mistake is costly and hard to undo, such as a security or data-integrity question that must be verified step by step.",
    });
    expect(effort.criteria).toEqual(WORKER_EFFORT_QUESTION.criteria);
  });

  test("worker effort instruction unchanged", () => {
    expect(WORKER_EFFORT_QUESTION.instructions).toBe(
      "How much work and care does a subagent need to put into carrying out this brief? Count the steps, the tracing, the tool calls and the verification. A brief that already names the files, the steps and the tests has done the design: carrying it out is execution. Rate higher only when the brief itself asks for design, tracing an unknown cause, or reasoning that is not already written out. Rare knowledge is a tier matter, not an effort signal. Rate the work, not how important the topic sounds: reviewing a small diff is medium, even for security.",
    );
  });

  test("main tier uses the main criteria with no prefix and no frontier", () => {
    const tier = mainQuestions({ askEffort: false, askStrategy: true }).wire["tier"]!;
    expect(tier.instructions).toBe(MAIN_TIER_QUESTION.instructions);
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
    expect(DOC).toContain("It has no display-name prefix, no slots and no `expert`.");
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
    expect(WORKER_TIER_CRITERIA.basic.startsWith("Common, well-documented knowledge.")).toBe(true);
    expect(WORKER_TIER_CRITERIA.frontier.startsWith("Rare, frontier-level expertise.")).toBe(true);
  });
  test("Version of this rubric", () => {
    expect(RUBRIC_VERSION).toBe(3);
  });
  test("Wording pinned to the version", () => {
    expect({ instruction: TIER_INSTRUCTION, criteria: WORKER_TIER_CRITERIA }).toEqual({
      instruction:
        "Which is the least knowledgeable model tier that has the knowledge this task needs?",
      criteria: {
        basic:
          "Common, well-documented knowledge. The syntax, standard library and tools most programmers know or can look up in the official docs. Choose when the task needs nothing beyond that. Length, number of steps, care and risk are effort, not tier.",
        broad:
          "Broad engineering knowledge across stacks and libraries: how common frameworks, databases, build tools and test runners behave, and the usual patterns for them. Choose when the task needs that knowledge, even across several of them. Length, number of steps, care and risk are effort, not tier.",
        deep: "Specialist depth in one domain: the internals, edge cases and conventions of a particular system, runtime or protocol, which a generalist would get wrong without study. Choose when the task needs that depth. Length, number of steps, care and risk are effort, not tier.",
        frontier:
          "Rare, frontier-level expertise. Knowledge that few practitioners hold and that weaker models are likely to get wrong, such as subtle interactions between systems or unusual failure modes. Choose only when the task needs that knowledge. Length, number of steps, care and risk are effort, not tier.",
      },
    });
  });
  test("main criteria are separate data and unchanged", () => {
    expect(MAIN_TIER_CRITERIA).not.toBe(WORKER_TIER_CRITERIA);
    expect(MAIN_TIER_CRITERIA.basic.startsWith("Fast and low cost, for bounded work")).toBe(true);
    expect(MAIN_TIER_CRITERIA.deep.startsWith("For careful judgment or long work")).toBe(true);
    expect(MAIN_TIER_QUESTION.instructions).toBe(
      "Which is the cheapest tier that can complete this coding task well?",
    );
    expect(MAIN_TIER_QUESTION.criteria).toEqual(MAIN_TIER_CRITERIA);
  });
  test("no slot: tier options are the four tiers", () => {
    const { specs } = buildWorkerQuestions(all, {});
    expect(specs["tier"]).toEqual({ type: "choice", options: [...all] });
  });
  test("Premium wording", () => {
    const { questions } = buildWorkerQuestions(all, {});
    expect(
      questions["tier"]!.instructions.startsWith(
        "Which is the least knowledgeable model tier that has the knowledge this task needs?",
      ),
    ).toBe(true);
  });
  test("Standard request unchanged", () => {
    const { questions } = buildWorkerQuestions(["basic"], {});
    expect(
      questions["tier"]!.criteria["basic"]!.startsWith("Common, well-documented knowledge."),
    ).toBe(true);
  });
  test("Budget expert criterion", () => {
    const { questions } = buildWorkerQuestions(all, {});
    expect(
      questions["tier"]!.criteria["frontier"]!.startsWith("Rare, frontier-level expertise."),
    ).toBe(true);
    expect(Object.keys(questions)).not.toContain("expert_needed");
  });
  test("Effort instruction asks about work", () => {
    const { questions } = buildWorkerQuestions(all, {});
    expect(
      questions["effort"]!.instructions.startsWith(
        "How much work and care does a subagent need to put into carrying out this brief",
      ),
    ).toBe(true);
  });
  test("Main criteria held apart", () => {
    const disclaimer = "Length, number of steps, care and risk are effort, not tier.";
    for (const text of Object.values(WORKER_TIER_CRITERIA)) {
      expect(text).toContain(disclaimer);
      expect(text.replace(disclaimer, "")).not.toMatch(
        /unknown|cause|files|steps|security|production/i,
      );
    }
  });
  test("Role rule in the main instruction", () => {
    expect(docs).toContain(`> ${MAIN_EFFORT_INSTRUCTION}\n`);
  });
  test("Display name prefix", () => {
    const { questions } = buildWorkerQuestions(["basic"], { basic: "Claude Haiku 5.5" });
    expect(
      questions["tier"]!.criteria["basic"]!.startsWith(
        "Claude Haiku 5.5. Common, well-documented knowledge.",
      ),
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
