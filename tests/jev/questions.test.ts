import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildWorkerQuestions, offeredTiers } from "../../src/jev/questions.ts";
import {
  EXPERT_NEEDED_QUESTION,
  RISKY_QUESTION,
  STANDARD_TIER_CRITERIA,
  TIER_INSTRUCTION,
  WORKER_EFFORT_QUESTION,
} from "../../src/jev/rubrics.ts";

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
