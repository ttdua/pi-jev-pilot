import { describe, expect, test } from "bun:test";

import type { Answer } from "../../../src/policy/answers.ts";
import {
  flaggedTools,
  grantedTools,
  NEVER_CANDIDATES,
  toolCounts,
  toolPlan,
  type ToolSet,
} from "../../../src/policy/tools/assess.ts";

const noul = (value: number): Answer => ({ type: "noul", noul: value });

const DEFAULTS = ["read", "bash", "edit", "write", "grep", "find", "ls"];

function toolSet(over: Partial<ToolSet> = {}): ToolSet {
  return { declared: null, disallowed: [], defaults: DEFAULTS, parentTools: DEFAULTS, ...over };
}

describe("toolPlan", () => {
  test("Default and grant candidates", () => {
    const plan = toolPlan(toolSet({ parentTools: [...DEFAULTS, "web_search"] }));
    expect(plan).toEqual({ block: DEFAULTS, grant: ["web_search"] });
  });

  test("Declared agent has only grant candidates", () => {
    const plan = toolPlan(
      toolSet({ declared: ["read"], defaults: ["read"], parentTools: ["read", "web_search"] }),
    );
    expect(plan).toEqual({ block: [], grant: ["web_search"] });
  });

  test("Declared tools kept", () => {
    const plan = toolPlan(
      toolSet({
        declared: ["read", "edit"],
        defaults: ["read", "edit"],
        parentTools: ["read", "edit", "bash", "web_search"],
      }),
    );
    expect(plan).toEqual({ block: [], grant: ["bash", "web_search"] });
  });

  test("Disallowed tool never offered", () => {
    const plan = toolPlan(
      toolSet({ disallowed: ["web_search"], parentTools: [...DEFAULTS, "web_search"] }),
    );
    expect([...plan.block, ...plan.grant]).not.toContain("web_search");
  });

  test("a disallowed default is not a block candidate", () => {
    const plan = toolPlan(toolSet({ disallowed: ["bash"] }));
    expect(plan.block).not.toContain("bash");
  });

  test("Orchestration and review tools excluded", () => {
    const plan = toolPlan(
      toolSet({ declared: [], defaults: [], parentTools: ["subagent", "jev_review", "read"] }),
    );
    expect(plan).toEqual({ block: [], grant: ["read"] });
  });

  test("Protocol tools never candidates", () => {
    const plan = toolPlan(
      toolSet({
        defaults: ["read", "bash"],
        parentTools: ["read", "bash", "ask_parent", "notify_parent"],
      }),
    );
    expect(plan).toEqual({ block: ["read", "bash"], grant: [] });
  });

  test("Review tool never a candidate", () => {
    const plan = toolPlan(
      toolSet({ defaults: [...DEFAULTS, "jev_review"], parentTools: [...DEFAULTS, "jev_review"] }),
    );
    expect([...plan.block, ...plan.grant]).not.toContain("jev_review");
  });

  test("never-candidates cover review and every executor-owned tool", () => {
    expect<string[]>([...NEVER_CANDIDATES].sort()).toEqual(
      [
        "ask_parent",
        "get_subagent_result",
        "jev_review",
        "notify_parent",
        "steer_subagent",
        "subagent",
      ].sort(),
    );
  });

  test("Cap at 32", () => {
    const grants = Array.from({ length: 30 }, (_, i) => `g${i}`);
    const plan = toolPlan(toolSet({ parentTools: [...DEFAULTS, ...grants] }));
    expect(plan.block).toEqual(DEFAULTS);
    expect(plan.grant).toEqual(grants.slice(0, 25));
    const answers = Object.fromEntries(grants.map((g) => [`grant::${g}`, noul(1)]));
    const granted = grantedTools(answers, plan.grant, 0.8);
    for (const late of grants.slice(25)) expect(granted.has(late)).toBe(false);
  });

  test("block candidates beyond the cap stay allowed", () => {
    const many = Array.from({ length: 40 }, (_, i) => `t${i}`);
    const plan = toolPlan(toolSet({ defaults: many, parentTools: many }));
    expect(plan.block).toEqual(many.slice(0, 32));
    expect(plan.grant).toEqual([]);
  });

  test("duplicates are scored once", () => {
    const plan = toolPlan(
      toolSet({ defaults: ["read", "read"], parentTools: ["read", "web", "web"] }),
    );
    expect(plan).toEqual({ block: ["read"], grant: ["web"] });
  });

  test("custom exclusions replace the default list", () => {
    const plan = toolPlan(toolSet({ defaults: ["read", "x"], parentTools: ["read", "x"] }), ["x"]);
    expect(plan.block).toEqual(["read"]);
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

describe("grantedTools", () => {
  test("Grant threshold boundary", () => {
    const answers = { "grant::web_search": noul(0.8), "grant::codemode": noul(0.79) };
    expect(grantedTools(answers, ["web_search", "codemode"], 0.8)).toEqual(new Set(["web_search"]));
  });

  test("Invalid grant answer", () => {
    // readAnswers drops an out-of-range noul, so the answer is missing here.
    expect(grantedTools({}, ["web_search"], 0.8)).toEqual(new Set());
    const raw = { "grant::web_search": noul(1.2) };
    expect(grantedTools(raw, ["web_search"], 0.8)).toEqual(new Set());
  });

  test("Never adds a non-candidate", () => {
    expect(grantedTools({ "grant::ghost": noul(1) }, ["web"], 0.8)).toEqual(new Set());
  });

  test("a tool:: answer never grants", () => {
    expect(grantedTools({ "tool::web": noul(1) }, ["web"], 0.8)).toEqual(new Set());
  });
});

describe("toolCounts", () => {
  test("counts scored, flagged and granted", () => {
    const counts = toolCounts(["a", "b", "c", "d", "e", "f"], new Set(["a"]), new Set(["e", "f"]));
    expect(counts).toEqual({ toolsScored: 6, toolsFlagged: 1, toolsGranted: 2 });
  });
});
