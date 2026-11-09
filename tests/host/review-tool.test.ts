import { afterEach, describe, expect, test } from "bun:test";
import { Value } from "typebox/value";
import { CHILDREN_KEY } from "../../src/host/child.ts";
import {
  hideReviewInChild,
  registerReviewTool,
  REVIEW_OFF_MESSAGE,
  REVIEW_TOOL,
  syncReviewTool,
} from "../../src/host/review.ts";
import type { Exec } from "../../src/policy/review/cli.ts";
import type { Snapshot } from "../../src/host/readiness.ts";

type Tool = {
  name: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: unknown;
  execute: (
    id: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: unknown,
  ) => Promise<{ content: { type: string; text: string }[]; details?: unknown; isError?: true }>;
};

type Review = { cli: "codex" | "opencode"; enabled: boolean; model?: string; effort?: string };
const snap = (review: Review, extra: Record<string, unknown> = {}) =>
  ({
    config: { valid: false, issues: [] },
    state: { kind: "missing", issues: [] },
    settings: { review },
    keyVar: "X",
    keySet: false,
    executor: false,
    ...extra,
  }) as unknown as Snapshot;

function setupTool(review: Review | "throw", calls: { cmd: string; args: string[] }[] = []) {
  let tool: Tool | undefined;
  const pi = {
    registerTool: (t: Tool) => {
      tool = t;
    },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    getAllTools: () => [],
  };
  const exec: Exec = async (cmd, args) => {
    calls.push({ cmd, args });
    return { stdout: "looks fine", stderr: "", code: 0, killed: false } as never;
  };
  registerReviewTool(pi as never, {
    exec,
    load: () => {
      if (review === "throw") throw new Error("boom");
      return snap(review);
    },
  });
  return tool!;
}

const ctx = (id: string) => ({ cwd: process.cwd(), sessionManager: { getSessionId: () => id } });
const registry = () => {
  const g = globalThis as Record<symbol, Set<string> | undefined>;
  return (g[CHILDREN_KEY] ??= new Set<string>());
};

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[CHILDREN_KEY];
});

describe("jev_review tool", () => {
  test("tool schema", () => {
    const t = setupTool({ cli: "codex", enabled: true });
    expect(t.name).toBe(REVIEW_TOOL);
    const ok = (v: unknown) => Value.Check(t.parameters as never, v);
    expect(ok({ brief: "x" })).toBe(true);
    expect(ok({ brief: "x".repeat(20000) })).toBe(true);
    expect(ok({ brief: "x".repeat(20001) })).toBe(false);
    expect(ok({ brief: "" })).toBe(false);
    expect(ok({ brief: "x", model: "-x" })).toBe(false);
    expect(ok({ brief: "x", model: "p/m:1" })).toBe(true);
    expect(ok({ brief: "x", effort: "high" })).toBe(true);
    expect(ok({ brief: "x", effort: "a b" })).toBe(false);
    expect(ok({ brief: "x", reviewer: "opencode" })).toBe(true);
    expect(ok({ brief: "x", reviewer: "claude" })).toBe(false);
  });

  test("description and guideline name jev_review", () => {
    const t = setupTool({ cli: "codex", enabled: true });
    const g = (t.promptGuidelines ?? []).join("\n");
    expect(g).toContain("jev_review");
    expect(g).toMatch(/only when the user asks for a review by Codex or OpenCode/);
    expect(t.description).toMatch(/Codex|OpenCode/);
    expect(t.promptSnippet).toBeTruthy();
  });

  test("refused in a child", async () => {
    const calls: { cmd: string; args: string[] }[] = [];
    const t = setupTool({ cli: "codex", enabled: true }, calls);
    registry().add("kid");
    const r = await t.execute("1", { brief: "b" }, undefined, undefined, ctx("kid"));
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toBe("jev_review is not available in a subagent session.");
    expect(calls).toEqual([]);
  });

  test("independent of key and switches", async () => {
    const calls: { cmd: string; args: string[] }[] = [];
    const t = setupTool({ cli: "codex", enabled: true }, calls);
    const r = await t.execute("1", { brief: "b" }, undefined, undefined, ctx("main"));
    expect(r.isError).toBeUndefined();
    expect(calls.at(-1)!.cmd).toBe("codex");
    expect(r.content[0]!.text).toContain("looks fine");
  });

  test("Refused while off", async () => {
    const calls: { cmd: string; args: string[] }[] = [];
    const t = setupTool({ cli: "codex", enabled: false }, calls);
    const r = await t.execute("1", { brief: "b" }, undefined, undefined, ctx("main"));
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toBe(REVIEW_OFF_MESSAGE);
    expect(calls).toEqual([]);
  });

  test("Unreadable setting counts as off", async () => {
    const calls: { cmd: string; args: string[] }[] = [];
    const t = setupTool("throw", calls);
    const r = await t.execute("1", { brief: "b" }, undefined, undefined, ctx("main"));
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toBe(REVIEW_OFF_MESSAGE);
    expect(calls).toEqual([]);
  });

  test("child refusal comes first", async () => {
    const t = setupTool({ cli: "codex", enabled: false });
    registry().add("kid");
    const r = await t.execute("1", { brief: "b" }, undefined, undefined, ctx("kid"));
    expect(r.content[0]!.text).toBe("jev_review is not available in a subagent session.");
  });

  test("enabled never reaches the CLI", async () => {
    const t = setupTool({ cli: "codex", enabled: true });
    const r = await t.execute("1", { brief: "b" }, undefined, undefined, ctx("main"));
    expect(JSON.stringify(r.details)).not.toContain("enabled");
  });

  test("default from state reaches the CLI", async () => {
    const calls: { cmd: string; args: string[] }[] = [];
    const t = setupTool({ cli: "opencode", enabled: true, model: "p/m" }, calls);
    await t.execute("1", { brief: "b" }, undefined, undefined, ctx("main"));
    const c = calls.at(-1)!;
    expect(c.cmd).toBe("opencode");
    const i = c.args.indexOf("-m");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(c.args[i + 1]).toBe("p/m");
  });

  test("nothing set reaches the CLI", async () => {
    const calls: { cmd: string; args: string[] }[] = [];
    const t = setupTool({ cli: "codex", enabled: true }, calls);
    await t.execute("1", { brief: "b" }, undefined, undefined, ctx("main"));
    const c = calls.at(-1)!;
    expect(c.cmd).toBe("codex");
    expect(c.args).not.toContain("-m");
  });
});

describe("hideReviewInChild", () => {
  const ev = (tools?: string[]) =>
    ({ systemPromptOptions: tools === undefined ? {} : { selectedTools: tools } }) as never;

  test("removes from a child, keeps for main, tolerates missing", () => {
    registry().add("kid");
    const a = ev(["read", REVIEW_TOOL, "bash"]);
    hideReviewInChild(a, "kid");
    expect(
      (a as never as { systemPromptOptions: { selectedTools: string[] } }).systemPromptOptions
        .selectedTools,
    ).toEqual(["read", "bash"]);
    const b = ev(["read", REVIEW_TOOL]);
    hideReviewInChild(b, "main");
    expect(
      (b as never as { systemPromptOptions: { selectedTools: string[] } }).systemPromptOptions
        .selectedTools,
    ).toEqual(["read", REVIEW_TOOL]);
    expect(() => hideReviewInChild(ev(), "kid")).not.toThrow();
    expect(() => hideReviewInChild({} as never, "kid")).not.toThrow();
  });
});

describe("syncReviewTool", () => {
  const fake = (active: string[] | "throw", all: string[]) => {
    const calls: string[][] = [];
    const pi = {
      getActiveTools: () => {
        if (active === "throw") throw new Error("boom");
        return active;
      },
      setActiveTools: (n: string[]) => calls.push(n),
      getAllTools: () => all.map((name) => ({ name })),
    };
    return { pi: pi as never, calls };
  };

  test("Other tools untouched", () => {
    const f = fake(["read", REVIEW_TOOL, "bash"], [REVIEW_TOOL]);
    syncReviewTool(f.pi, false);
    expect(f.calls).toEqual([["read", "bash"]]);
  });

  test("adds at the end when on", () => {
    const f = fake(["read", "bash"], [REVIEW_TOOL]);
    syncReviewTool(f.pi, true);
    expect(f.calls).toEqual([["read", "bash", REVIEW_TOOL]]);
  });

  test("no call when already in sync", () => {
    const a = fake(["read"], [REVIEW_TOOL]);
    syncReviewTool(a.pi, false);
    const b = fake(["read", REVIEW_TOOL], [REVIEW_TOOL]);
    syncReviewTool(b.pi, true);
    expect(a.calls).toEqual([]);
    expect(b.calls).toEqual([]);
  });

  test("not registered, no add", () => {
    const f = fake(["read"], ["read"]);
    syncReviewTool(f.pi, true);
    expect(f.calls).toEqual([]);
  });

  test("never throws", () => {
    const f = fake("throw", [REVIEW_TOOL]);
    expect(() => syncReviewTool(f.pi, true)).not.toThrow();
    expect(f.calls).toEqual([]);
  });
});
