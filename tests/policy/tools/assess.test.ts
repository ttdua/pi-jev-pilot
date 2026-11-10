import { describe, expect, test } from "bun:test";

import type { Answer } from "../../../src/policy/answers.ts";
import { flaggedTools, toolCandidates, toolCounts } from "../../../src/policy/tools/assess.ts";

const noul = (value: number): Answer => ({ type: "noul", noul: value });

describe("toolCandidates", () => {
  test("Protocol tools never candidates", () => {
    const result = toolCandidates(["read", "bash", "ask_parent", "notify_parent"]);
    expect(result.scored).toEqual(["read", "bash"]);
    expect(result.kept).toEqual([]);
  });

  test("Cap at 32", () => {
    const names = Array.from({ length: 40 }, (_, i) => `t${i}`);
    const result = toolCandidates(names);
    expect(result.scored).toEqual(names.slice(0, 32));
    expect(result.kept).toEqual(names.slice(32));
  });
});

describe("flaggedTools", () => {
  test("Threshold boundary", () => {
    const answers = { "tool::edit": noul(0.5), "tool::bash": noul(0.49) };
    expect(flaggedTools(answers, ["edit", "bash"])).toEqual(new Set(["edit"]));
  });

  test("One bad answer", () => {
    const answers = { "tool::bash": noul(0.9) };
    expect(flaggedTools(answers, ["edit", "bash"])).toEqual(new Set(["bash"]));
  });

  test("Never adds", () => {
    expect(flaggedTools({ "tool::ghost": noul(0.9) }, ["read"])).toEqual(new Set());
  });

  test("ignores choice answers", () => {
    const choice: Answer = { type: "choice", choice: "a", probabilities: { a: 1 } };
    expect(flaggedTools({ "tool::read": choice }, ["read"])).toEqual(new Set());
  });
});

describe("toolCounts", () => {
  test("counts scored and flagged", () => {
    const counts = toolCounts(["a", "b", "c", "d", "e"], new Set(["a", "b"]));
    expect(counts).toEqual({ toolsScored: 5, toolsFlagged: 2 });
  });
});
