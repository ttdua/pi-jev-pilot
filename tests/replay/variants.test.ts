import { describe, expect, test } from "bun:test";
import type { RichGroup } from "../../src/jev/state.ts";
import type { AgentFacts } from "../../src/policy/launch.ts";
import type { RebuiltMain, RebuiltWorker } from "../../scripts/replay/inputs.ts";
import { type PlainConfig, planPass } from "../../scripts/replay/variants.ts";

const main = (missing: RichGroup[] = []): RebuiltMain => ({
  sample: { session: "s", cwd: "/w", entryId: "e", prompt: "fix the bug", branch: [] },
  rich: {
    lastDecision: { effort: "high" },
    contextPercent: 40,
    git: { changed_files: 2, diff_lines: 10 },
    languages: ["ts"],
    capabilities: { tools: [{ name: "bash", description: "run" }], agents: [] },
  },
  missing,
  items: [],
  platforms: ["darwin"],
});

const agent: AgentFacts = {
  name: "scout",
  source: "global",
  description: "finds things",
  instructionsExcerpt: "look around",
  declaredTools: null,
  maxTurns: null,
  sets: { model: false, thinking: false },
};
const worker = (
  withAgent = true,
  over: Partial<RebuiltWorker["sample"]> = {},
  agentOver: Partial<AgentFacts> = {},
): RebuiltWorker => ({
  sample: {
    session: "s",
    agent: "scout",
    brief: "find x",
    description: "d",
    parentPrompt: "parent says",
    runInBackground: false,
    ...over,
  },
  ...(withAgent ? { agent: { ...agent, ...agentOver } } : {}),
});

const config: PlainConfig = {
  tiers: { fast: "a/b", deep: "c/d", expert: "e/f" },
  slots: [{ name: "slot", model: "m/n", when: "for x" }],
  mode: "standard",
  expertOn: true,
};

const plan1 = (over: Partial<Parameters<typeof planPass>[1]> = {}) =>
  planPass(1, { main: [main()], workers: [worker()], config, hasSnapshot: true, ...over });
const find = (p: ReturnType<typeof planPass>, variant: string, kind = "main") =>
  p.requests.filter((r) => r.variant === variant && r.kind === kind);
const ws = (r: { state: unknown } | undefined) =>
  ((r as { state: unknown }).state as { workspace: Record<string, unknown> }).workspace;
const conv = (r: { state: unknown } | undefined) =>
  ((r as { state: unknown }).state as { conversation: Record<string, unknown> }).conversation;

describe("planPass", () => {
  test("add-one", () => {
    const p = plan1();
    const [min] = find(p, "minimal");
    const [add] = find(p, "+languages");
    expect(add?.base).toBe("minimal");
    expect(ws(add)).toEqual({ ...ws(min), languages: ["ts"] });
    expect(conv(add)).toEqual(conv(min));
  });

  test("leave-one-out", () => {
    const p = plan1();
    const [full] = find(p, "full");
    const [out] = find(p, "full-languages");
    expect(out?.base).toBe("full");
    const { languages: _l, ...rest } = ws(full);
    expect(ws(out)).toEqual(rest);
    expect(conv(out)).toEqual(conv(full));
  });

  test("reversed options", () => {
    const p = plan1();
    const [rev] = find(p, "effort-reversed");
    const [min] = find(p, "minimal");
    const q = rev?.questions as { effort: { criteria: object } };
    expect(Object.keys(q.effort.criteria)).toEqual(["max", "xhigh", "high", "medium", "low"]);
    expect(rev?.specs["effort"]).toEqual({
      type: "choice",
      options: ["max", "xhigh", "high", "medium", "low"],
    });
    expect(rev?.state).toEqual(min?.state);
    expect(rev?.base).toBe("minimal");
  });

  test("reruns present", () => {
    const p = plan1();
    for (const v of ["rerun-a", "rerun-b"]) {
      expect(find(p, v)[0]?.base).toBe("minimal");
      expect(find(p, v, "worker")[0]?.base).toBe("base");
    }
  });

  test("no capabilities snapshot", () => {
    const p = plan1({ hasSnapshot: false });
    expect(find(p, "+capabilities")).toEqual([]);
    expect(find(p, "full-capabilities")).toEqual([]);
    expect(p.requests.some((r) => r.kind === "worker")).toBe(false);
    expect(JSON.stringify(find(p, "full")[0]?.state)).not.toContain("capabilities");
    expect(p.skipped).toEqual(["capabilities", "workers"]);
  });

  test("missing inputs excluded", () => {
    const p = plan1({ main: [main(["languages"]), main()] });
    expect(find(p, "+languages").map((r) => r.sample)).toEqual([1]);
    expect(find(p, "full-languages").map((r) => r.sample)).toEqual([1]);
    expect(p.excluded["+languages"]).toBe(1);
  });

  test("full-G pairs with full: same sample set", () => {
    const p = plan1({ main: [main(["languages"]), main(["last_decision"])] });
    expect(find(p, "full")).toEqual([]);
    expect(find(p, "full-languages")).toEqual([]);
    expect(find(p, "full-last_decision")).toEqual([]);
    expect(p.excluded["full"]).toBe(2);
    expect(p.excluded["full-languages"]).toBe(2);
    expect(p.excluded["full-last_decision"]).toBe(2);
    expect(find(p, "+languages").map((r) => r.sample)).toEqual([1]);
    expect(find(p, "+last_decision").map((r) => r.sample)).toEqual([0]);
    expect(p.excluded["+languages"]).toBe(1);
    expect(p.excluded["+last_decision"]).toBe(1);
  });

  test("pass 2 variants", () => {
    const p = planPass(2, {
      main: [main()],
      workers: [worker()],
      config,
      hasSnapshot: true,
      kept: ["languages"],
    });
    expect([...new Set(p.requests.map((r) => r.variant))]).toEqual([
      "minimal",
      "rerun-a",
      "rerun-b",
      "full",
      "+git",
      "full-git",
    ]);
    expect(ws(find(p, "full")[0])).toMatchObject({ languages: ["ts"], git: expect.anything() });
    expect(ws(find(p, "full-git")[0])).toHaveProperty("languages");
    expect(ws(find(p, "full-git")[0])).not.toHaveProperty("git");
    expect(find(p, "full-git")[0]?.base).toBe("full");
    expect(p.skipped).toEqual([]);
  });

  test("worker variants", () => {
    const p = plan1();
    const get = (v: string) => find(p, v, "worker")[0]?.state as Record<string, any>;
    const base = get("base");
    expect(get("parent-request")).toEqual({ ...base, parent_request: "parent says" });
    expect(get("no-description")).toEqual({
      ...base,
      agent: { ...base["agent"], description: "" },
    });
    expect(get("no-instructions")).toEqual({
      ...base,
      agent: { ...base["agent"], instructions_excerpt: "" },
    });
    const q = find(p, "base", "worker")[0];
    expect(Object.keys(q?.specs ?? {})).toEqual(["tier", "effort", "risky", "expert_needed"]);
    expect(find(p, "parent-request", "worker")[0]?.base).toBe("base");
  });

  test("no-op worker variants are excluded", () => {
    const p = plan1({
      workers: [
        worker(true, { description: "", parentPrompt: undefined }, { instructionsExcerpt: "" }),
      ],
    });
    expect(find(p, "parent-request", "worker")).toEqual([]);
    expect(find(p, "no-description", "worker")).toEqual([]);
    expect(find(p, "no-instructions", "worker")).toEqual([]);
    expect(find(p, "base", "worker")).toHaveLength(1);
    expect(p.excluded["parent-request"]).toBe(1);
    expect(p.excluded["no-description"]).toBe(1);
    expect(p.excluded["no-instructions"]).toBe(1);
  });

  test("shared questions and specs are frozen", () => {
    const p = plan1();
    for (const r of p.requests) {
      expect(Object.isFrozen(r.questions)).toBe(true);
      expect(Object.isFrozen(r.specs)).toBe(true);
    }
  });

  test("worker without agent is excluded", () => {
    const p = plan1({ workers: [worker(false)] });
    expect(p.requests.some((r) => r.kind === "worker")).toBe(false);
    expect(p.excluded["parent-request"]).toBe(1);
  });

  test("skills never asked", () => {
    const [min] = find(plan1(), "minimal");
    expect(min?.questions).not.toHaveProperty("which");
  });
});
