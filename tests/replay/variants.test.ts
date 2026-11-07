import { describe, expect, test } from "bun:test";
import type { RichGroup } from "../../src/jev/state.ts";
import type { AgentFacts } from "../../src/policy/launch.ts";
import type { RebuiltMain, RebuiltWorker } from "../../scripts/replay/inputs.ts";
import { type PlainConfig, planPass } from "../../scripts/replay/variants.ts";

const main = (missing: RichGroup[] = []): RebuiltMain => ({
  sample: { session: "s", cwd: "/w", entryId: "e", prompt: "fix the bug", branch: [] },
  rich: {
    lastDecision: { effort: "high" },
    git: { changed_files: 2, diff_lines: 10 },
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
    const [add] = find(p, "+last_decision");
    expect(add?.base).toBe("minimal");
    expect(ws(add)).toEqual(ws(min));
    expect(conv(add)).toEqual({ ...conv(min), last_decision: { effort: "high" } });
  });

  test("leave-one-out", () => {
    const p = plan1();
    const [full] = find(p, "full");
    const [out] = find(p, "full-last_decision");
    expect(out?.base).toBe("full");
    const { last_decision: _l, ...rest } = conv(full);
    expect(conv(out)).toEqual(rest);
    expect(ws(out)).toEqual(ws(full));
  });

  test("reversed options", () => {
    const p = plan1();
    const [rev] = find(p, "effort-reversed");
    const [min] = find(p, "minimal");
    const q = rev?.questions as { effort: { criteria: object } };
    expect(Object.keys(q.effort.criteria)).toEqual(["max", "low", "xhigh", "medium", "high"]);
    expect(rev?.specs["effort"]).toEqual({
      type: "choice",
      options: ["max", "low", "xhigh", "medium", "high"],
    });
    expect(rev?.state).toEqual(min?.state);
    expect(rev?.base).toBe("minimal");
  });

  test("pass 1 variant order ends with the reversed order", () => {
    const ids = [
      ...new Set(
        plan1()
          .requests.filter((r) => r.kind === "main")
          .map((r) => r.variant),
      ),
    ];
    expect(ids.slice(-1)).toEqual(["effort-reversed"]);
  });

  test("--only keeps the bases, reruns and listed variants", () => {
    const p = plan1({ only: ["effort-reversed"] });
    const ids = (kind: string) => [
      ...new Set(p.requests.filter((r) => r.kind === kind).map((r) => r.variant)),
    ];
    expect(ids("main")).toEqual(["minimal", "rerun-a", "rerun-b", "effort-reversed"]);
    expect(ids("worker")).toEqual(["base", "rerun-a", "rerun-b"]);
  });

  test("--only without a snapshot plans no worker variants", () => {
    const p = plan1({ only: ["effort-reversed"], hasSnapshot: false });
    expect(p.requests.some((r) => r.kind === "worker")).toBe(false);
    expect([...new Set(p.requests.map((r) => r.variant))]).toEqual([
      "minimal",
      "rerun-a",
      "rerun-b",
      "effort-reversed",
    ]);
  });

  test("--only accepts a full-G base through its listed variant", () => {
    const p = plan1({ only: ["full-last_decision", "full"] });
    expect([...new Set(p.requests.filter((r) => r.kind === "main").map((r) => r.variant))]).toEqual(
      ["minimal", "rerun-a", "rerun-b", "full", "full-last_decision"],
    );
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
    const p = plan1({ main: [main(["capabilities"]), main()] });
    expect(find(p, "+capabilities").map((r) => r.sample)).toEqual([1]);
    expect(find(p, "full-capabilities").map((r) => r.sample)).toEqual([1]);
    expect(p.excluded["+capabilities"]).toBe(1);
  });

  test("full-G pairs with full: same sample set", () => {
    const p = plan1({ main: [main(["capabilities"]), main(["last_decision"])] });
    expect(find(p, "full")).toEqual([]);
    expect(find(p, "full-capabilities")).toEqual([]);
    expect(find(p, "full-last_decision")).toEqual([]);
    expect(p.excluded["full"]).toBe(2);
    expect(p.excluded["full-capabilities"]).toBe(2);
    expect(p.excluded["full-last_decision"]).toBe(2);
    expect(find(p, "+capabilities").map((r) => r.sample)).toEqual([1]);
    expect(find(p, "+last_decision").map((r) => r.sample)).toEqual([0]);
    expect(p.excluded["+capabilities"]).toBe(1);
    expect(p.excluded["+last_decision"]).toBe(1);
  });

  test("pass 2 variants", () => {
    const p = planPass(2, {
      main: [main()],
      workers: [worker()],
      config,
      hasSnapshot: true,
      kept: ["capabilities"],
    });
    expect([...new Set(p.requests.map((r) => r.variant))]).toEqual([
      "minimal",
      "rerun-a",
      "rerun-b",
      "full",
      "+git",
      "full-git",
    ]);
    expect(ws(find(p, "full")[0])).toHaveProperty("git");
    expect(JSON.stringify(find(p, "full-git")[0]?.state)).toContain('"capabilities"');
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
    expect(p.excluded["worker:parent-request"]).toBe(1);
    expect(p.excluded["worker:no-description"]).toBe(1);
    expect(p.excluded["worker:no-instructions"]).toBe(1);
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
    expect(p.excluded["worker:parent-request"]).toBe(1);
  });

  test("skills never asked", () => {
    const [min] = find(plan1(), "minimal");
    expect(min?.questions).not.toHaveProperty("which");
  });
});
