import { describe, expect, test } from "bun:test";
import type { RichInputs } from "../../src/jev/state.ts";
import { mainState, pickRich, SHIPPED_MAIN_GROUPS } from "../../src/jev/state.ts";
import type { AgentFacts } from "../../src/policy/launch.ts";
import type { RebuiltMain, RebuiltWorker } from "../../scripts/replay/inputs.ts";
import { planReport } from "../../scripts/replay/report.ts";
import type { PlainConfig, Plan } from "../../scripts/replay/variants.ts";

const rich: RichInputs = {
  lastDecision: { effort: "high", strategy: "direct" },
  capabilities: { tools: [{ name: "bash", description: "run" }], agents: [] },
};

const main = (
  missing: RebuiltMain["missing"] = [],
  over: Partial<RebuiltMain> = {},
): RebuiltMain => ({
  sample: { session: "s", cwd: "/w", entryId: "e", prompt: "fix the bug", branch: [] },
  rich,
  missing,
  items: [],
  platforms: ["darwin"],
  ...over,
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

const worker = (kind: string = "scout"): RebuiltWorker => ({
  sample: {
    session: "s",
    agent: kind,
    brief: "find x",
    description: "d",
    runInBackground: false,
  },
  agent: { ...agent, name: kind },
});

const config: PlainConfig = {
  tiers: { fast: "a/b", balanced: "b/c", deep: "c/d", expert: "e/f" },
  slots: [{ name: "reviewer", model: "m/n", when: "for review" }],
  mode: "standard",
  expertOn: true,
};

const plan = (over: Partial<Parameters<typeof planReport>[0]> = {}): Plan =>
  planReport({ main: [main()], workers: [worker()], config, hasSnapshot: true, ...over });

const reqs = (p: Plan, variant: string, kind: "main" | "worker" = "main") =>
  p.requests.filter((r) => r.variant === variant && r.kind === kind);

describe("planReport", () => {
  test("shipped main state", () => {
    const p = plan();
    const expected = mainState({
      prompt: "fix the bug",
      items: [],
      platforms: ["darwin"],
      rich: pickRich(rich, SHIPPED_MAIN_GROUPS),
    });
    expect(reqs(p, "report")[0]?.state).toEqual(expected);
    expect(reqs(p, "rerun")[0]?.state).toEqual(expected);
    expect(reqs(p, "report")[0]?.base).toBe("report");
  });

  test("one worker request per variant", () => {
    const workers = Array.from({ length: 10 }, () => worker());
    const p = plan({ main: [], workers });
    expect(reqs(p, "report", "worker")).toHaveLength(10);
    expect(reqs(p, "rerun", "worker")).toHaveLength(10);
    expect(reqs(p, "report", "worker")[0]?.base).toBe("report");
  });

  test("worker request has no parent request", () => {
    const p = plan({
      main: [],
      workers: [{ ...worker(), sample: { ...worker().sample, parentPrompt: "parent" } }],
    });
    const [r] = reqs(p, "report", "worker");
    expect(r?.state).not.toHaveProperty("parent_request");
  });

  test("configured worker targets", () => {
    const p = plan({ main: [], workers: [worker()] });
    const [r] = reqs(p, "report", "worker");
    const specs = r?.specs["tier"];
    expect(specs).toEqual({
      type: "choice",
      options: ["fast", "balanced", "deep", "expert", "slot::reviewer"],
    });
  });

  test("no snapshot skips workers", () => {
    const p = plan({ hasSnapshot: false });
    expect(p.requests.some((r) => r.kind === "worker")).toBe(false);
    expect(p.skipped).toEqual(["workers"]);
    expect(reqs(p, "report")).toHaveLength(1);
    expect(reqs(p, "rerun")).toHaveLength(1);
  });

  test("sample missing capabilities is excluded without a snapshot", () => {
    const p = plan({ main: [main(["capabilities"]), main()], hasSnapshot: false });
    expect(reqs(p, "report").map((r) => r.sample)).toEqual([1]);
    expect(reqs(p, "rerun").map((r) => r.sample)).toEqual([1]);
    expect(p.excluded["report"]).toBe(1);
    expect(p.excluded["rerun"]).toBe(1);
  });

  test("missing group excluded", () => {
    const p = plan({ main: [main(["last_decision"]), main()] });
    expect(reqs(p, "report").map((r) => r.sample)).toEqual([1]);
    expect(reqs(p, "rerun").map((r) => r.sample)).toEqual([1]);
    expect(p.excluded["report"]).toBe(1);
    expect(p.excluded["rerun"]).toBe(1);
  });

  test("worker without agent is excluded under both variants", () => {
    const p = plan({ main: [], workers: [{ sample: worker().sample }] });
    expect(p.requests.some((r) => r.kind === "worker")).toBe(false);
    expect(p.excluded["worker:report"]).toBe(1);
    expect(p.excluded["worker:rerun"]).toBe(1);
  });
});
