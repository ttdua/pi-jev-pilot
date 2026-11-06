import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { mainQuestions } from "../../src/jev/questions.ts";
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

  test("effort criteria match the docs table rows", () => {
    const effort = mainQuestions({ askEffort: true }).wire["effort"]!;
    for (const level of EFFORT_LEVELS) {
      expect(docs).toContain(
        `| \`${level}\` | ${(effort.criteria as Record<string, string>)[level]} |`,
      );
    }
  });
});
