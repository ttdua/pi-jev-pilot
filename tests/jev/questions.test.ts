import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { buildWorkerQuestions, mainQuestions, offeredTiers } from "../../src/jev/questions.ts";
import {
  EXPERT_NEEDED_QUESTION,
  RISKY_QUESTION,
  STANDARD_TIER_CRITERIA,
  TIER_INSTRUCTION,
  WORKER_EFFORT_QUESTION,
} from "../../src/jev/rubrics.ts";
import { EFFORT_LEVELS } from "../../src/policy/effort.ts";

const docs = readFileSync(new URL("../../docs/jev-questions.md", import.meta.url), "utf8");

describe("mainQuestions", () => {
  test("askEffort true gives effort, risky, corrects in order", () => {
    const { wire, specs } = mainQuestions({ askEffort: true });
    expect(Object.keys(wire)).toEqual(["effort", "risky", "corrects"]);
    expect(Object.keys(specs)).toEqual(["effort", "risky", "corrects"]);
    expect(specs["effort"]).toEqual({ type: "choice", options: EFFORT_LEVELS });
    expect(specs["risky"]).toEqual({ type: "noul" });
    expect(specs["corrects"]).toEqual({ type: "noul" });
  });

  test("effort has the choice wire shape with five ordered criteria", () => {
    const effort = mainQuestions({ askEffort: true }).wire["effort"]!;
    expect(Object.keys(effort).sort()).toEqual(["criteria", "instructions", "type"]);
    expect(effort.type).toBe("choice");
    expect(Object.keys(effort.criteria)).toEqual([...EFFORT_LEVELS]);
  });

  test("noul questions have true and false criteria", () => {
    const { wire } = mainQuestions({ askEffort: true });
    for (const key of ["risky", "corrects"]) {
      const q = wire[key]!;
      expect(q.type).toBe("noul");
      expect(Object.keys(q.criteria)).toEqual(["true", "false"]);
    }
  });

  test("askEffort false asks only corrects", () => {
    const { wire, specs } = mainQuestions({ askEffort: false });
    expect(Object.keys(wire)).toEqual(["corrects"]);
    expect(Object.keys(specs)).toEqual(["corrects"]);
  });

  test("every instruction and criterion appears verbatim in docs/jev-questions.md", () => {
    const { wire } = mainQuestions({ askEffort: true });
    for (const q of Object.values(wire)) {
      expect(docs).toContain(q.instructions);
      for (const text of Object.values(q.criteria)) {
        expect(text.length).toBeGreaterThan(0);
        expect(docs).toContain(text);
      }
    }
  });

  test("results are fresh objects: mutation does not leak into the next call", () => {
    const a = mainQuestions({ askEffort: true });
    a.wire["risky"]!.instructions = "changed";
    a.wire["risky"]!.criteria["true"] = "changed";
    a.wire["corrects"]!.criteria["false"] = "changed";
    const b = mainQuestions({ askEffort: true });
    expect(b.wire["risky"]!.instructions).not.toBe("changed");
    expect(b.wire["risky"]!.criteria["true"]).not.toBe("changed");
    expect(b.wire["corrects"]!.criteria["false"]).not.toBe("changed");
  });

  test("effort criteria match the docs table rows", () => {
    const effort = mainQuestions({ askEffort: true }).wire["effort"]!;
    for (const level of EFFORT_LEVELS) {
      expect(docs).toContain(
        `| \`${level}\` | ${(effort.criteria as Record<string, string>)[level]} |`,
      );
    }
  });
});

const DOC = readFileSync(new URL("../../docs/jev-questions.md", import.meta.url), "utf8");
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
    const { questions, specs } = buildWorkerQuestions(["fast", "deep"], {});
    const spec = specs["tier"];
    expect(spec).toEqual({ type: "choice", options: ["fast", "deep"] });
    expect(Object.keys(questions["tier"]!.criteria)).toEqual(
      spec?.type === "choice" ? [...spec.options] : [],
    );
  });
});

describe("Question wording", () => {
  test("Wording matches the docs", () => {
    const { questions } = buildWorkerQuestions(["fast", "balanced", "deep", "expert"], {});
    const texts: string[] = [TIER_INSTRUCTION];
    for (const q of [WORKER_EFFORT_QUESTION, RISKY_QUESTION, EXPERT_NEEDED_QUESTION]) {
      texts.push(q.instructions, ...Object.values(q.criteria));
    }
    texts.push(...Object.values(STANDARD_TIER_CRITERIA));
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
    expect(Object.keys(EXPERT_NEEDED_QUESTION.criteria)).toEqual(["true", "false"]);
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
    const { questions } = buildWorkerQuestions(["fast"], { fast: "Claude Haiku 5.5" });
    expect(
      questions["tier"]!.criteria["fast"]!.startsWith("Claude Haiku 5.5. Fast and low cost"),
    ).toBe(true);
  });
  test("Missing display name", () => {
    const { questions } = buildWorkerQuestions(["balanced"], {});
    expect(questions["tier"]!.criteria["balanced"]).toBe(STANDARD_TIER_CRITERIA.balanced);
  });
});
