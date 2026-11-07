import { describe, expect, test } from "bun:test";
import { buildRichInputs } from "../../src/host/rich.ts";
import type { AgentFacts } from "../../src/policy/launch.ts";

const agent = { name: "a", description: "d", declaredTools: ["read"] } as AgentFacts;

function sources(over: Partial<Parameters<typeof buildRichInputs>[0]> = {}) {
  const calls: string[] = [];
  return {
    calls,
    i: {
      groups: [],
      cwd: "/nonexistent-rich",
      tools: () => (calls.push("tools"), [{ name: "t", description: "D." }]),
      agents: () => (calls.push("agents"), [agent]),
      ...over,
    } satisfies Parameters<typeof buildRichInputs>[0],
  };
}

describe("buildRichInputs", () => {
  test("only listed groups built", async () => {
    const s = sources({ groups: ["last_decision"], last: { effort: "low" } });
    expect(await buildRichInputs(s.i)).toEqual({ lastDecision: { effort: "low" } });
    expect(s.calls).toEqual([]);
  });
  test("a throwing group is omitted, others kept", async () => {
    const s = sources({
      groups: ["last_decision", "capabilities"],
      last: { effort: "low" },
      tools: () => {
        throw new Error("boom");
      },
    });
    expect(await buildRichInputs(s.i)).toEqual({ lastDecision: { effort: "low" } });
  });
  test("capabilities map agents to declared tools", async () => {
    const s = sources({ groups: ["capabilities"] });
    expect((await buildRichInputs(s.i)).capabilities?.agents).toEqual([
      { name: "a", description: "d", tools: ["read"] },
    ]);
  });
  test("git awaited and last decision passed", async () => {
    const s = sources({
      groups: ["git", "last_decision"],
      git: Promise.resolve({ changed_files: 1, diff_lines: 2 }),
      last: { effort: "high" },
    });
    expect(await buildRichInputs(s.i)).toEqual({
      git: { changed_files: 1, diff_lines: 2 },
      lastDecision: { effort: "high" },
    });
  });
});
