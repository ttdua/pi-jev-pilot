import { describe, expect, test } from "bun:test";
import { REPORT_MODES, routeStream } from "../../scripts/replay/report-route.ts";
import type { PlainConfig } from "../../scripts/replay/variants.ts";
import { BUILTIN_FLOORS } from "../../src/shared/turn-floors.ts";
import { cutPointsFor } from "../../src/policy/worker/cutpoints.ts";
import { SEED_CUTPOINTS } from "../../src/policy/worker/seed.ts";
import { routeLaunch } from "../../src/policy/worker/route.ts";
import { difficultyScore } from "../../src/policy/worker/score.ts";
import { offeredTiers } from "../../src/jev/questions.ts";
import { RUBRIC_VERSION } from "../../src/jev/rubrics.ts";
import { WINDOW_MAX, windowEntries, type WindowLine } from "../../src/policy/worker/cut-window.ts";
import { modelOfConfig, REPLAY_LAUNCH } from "../../scripts/replay/compare.ts";
import { workerAnswers } from "./helpers.ts";

const config: PlainConfig = {
  tiers: { basic: "a/b", broad: "b/c", deep: "c/d", frontier: "e/f" },
  slots: [{ name: "reviewer", model: "m/n", when: "for review" }],
  mode: "standard",
  frontierOn: true,
};
const noSlots: PlainConfig = { ...config, slots: [] };
const opts = (n: number, over = {}) => ({
  seed: SEED_CUTPOINTS.standard,
  config,
  mode: "standard" as const,
  routing: "tiers" as const,
  background: Array<boolean>(n).fill(false),
  ...over,
});

// Spread scores: tier distribution moves with i.
const spread = (i: number) => {
  const t = ["basic", "broad", "deep", "frontier"][i % 4] ?? "basic";
  return workerAnswers({ tier: t, tierP: { [t]: 1 }, effort: i % 2 ? "high" : "low" });
};

// Reference: routing one answer with explicit cuts, as the host would.
const recordOf = (a: ReturnType<typeof workerAnswers>, cuts = SEED_CUTPOINTS.standard) => {
  const r = routeLaunch({
    answers: a,
    launch: REPLAY_LAUNCH(false),
    offered: offeredTiers(config.tiers, config.frontierOn),
    cuts,
    forkLaunch: "untouched",
    canRun: () => true,
    thinkingOf: () => ({ reasoning: true }),
    modelOf: modelOfConfig(config),
    slots: [],
    floors: BUILTIN_FLOORS,
  });
  if (r.kind !== "routed") throw new Error("not routed");
  return r.record;
};
const fixed = (a: ReturnType<typeof workerAnswers>, cuts = SEED_CUTPOINTS.standard) =>
  recordOf(a, cuts).tier ?? "none";

describe("routeStream", () => {
  test("three modes, two routings", () => {
    const out = REPORT_MODES.flatMap((mode) =>
      (["slots", "tiers"] as const).map((routing) =>
        routeStream([workerAnswers()], opts(1, { mode, routing })),
      ),
    );
    expect(out).toHaveLength(6);
    for (const t of out) expect(t).toHaveLength(1);
    for (const t of out) expect(t[0]).toBeDefined();
  });

  test("Seed then window", () => {
    // Skewed stream: window cuts differ from the seed once 100 entries exist.
    const answers = Array.from({ length: 150 }, (_, i) =>
      workerAnswers({
        tier: "deep",
        tierP: { deep: 0.6, broad: 0.3, basic: 0.1 },
        effort: i % 3 ? "medium" : "low",
      }),
    );
    const mixed = answers.map((a, i) => (i % 5 === 0 ? spread(i) : a));
    const lines: WindowLine[] = [];
    const rolling: string[] = [];
    const seedOnly: string[] = [];
    mixed.forEach((a, i) => {
      const cuts = cutPointsFor(
        windowEntries(lines.slice(-WINDOW_MAX), RUBRIC_VERSION),
        "standard",
      );
      const r = recordOf(a, cuts);
      rolling.push(r.tier ?? "none");
      seedOnly.push(fixed(a));
      const effort = a.answers["effort"];
      lines.push({
        kind: "worker",
        at: i,
        rubric: RUBRIC_VERSION,
        frontierOffered: true,
        score: difficultyScore(a.answers) as number,
        reason: r.reason,
        ...(r.tier !== undefined ? { tier: r.tier } : {}),
        ...(r.fallback !== undefined ? { fallback: r.fallback } : {}),
        effortP: { [effort?.type === "choice" ? effort.choice : "high"]: 1 },
      });
    });
    // The oracle must discriminate: seed-only differs from rolling after the seed phase, never before.
    expect(rolling.slice(0, 100)).toEqual(seedOnly.slice(0, 100));
    expect(rolling.slice(100)).not.toEqual(seedOnly.slice(100));
    expect(routeStream(mixed, opts(150))).toEqual(rolling);
  });

  test("seed then window: the candidate replaces the shipped seed", () => {
    const seed = { basicMax: -Infinity, broadMax: -Infinity, frontierMin: -Infinity };
    const answers = Array.from({ length: 150 }, (_, i) => spread(i));
    const out = routeStream(answers, opts(150, { seed }));
    // Every launch before the 100th window entry routes on the candidate (all at or above frontierMin).
    expect(out.slice(0, 100)).toEqual(Array(100).fill("frontier"));
    expect(out.slice(100)).not.toEqual(Array(50).fill("frontier"));
  });

  test("seed for a short stream", () => {
    const answers = Array.from({ length: 20 }, (_, i) => spread(i));
    expect(routeStream(answers, opts(20))).toEqual(answers.map((a) => fixed(a)));
  });

  test("slot launch skips the window", () => {
    // A slot answer that would be a valid window entry (score, ladder probabilities) if it were added.
    const slot = workerAnswers({
      tier: "slot::reviewer",
      tierP: { "slot::reviewer": 0.9, deep: 0.1 },
      effort: "high",
    });
    const rest = Array.from({ length: 130 }, (_, i) => spread(i));
    const slots = Array.from({ length: 100 }, () => slot);
    const withSlots = routeStream([...slots, ...rest], opts(230, { routing: "slots" }));
    expect(withSlots.slice(0, 100)).toEqual(Array(100).fill("slot::reviewer"));
    const without = routeStream(rest, opts(130, { routing: "slots" }));
    // Oracle: had the slots filled the window (100 entries), the first rest answers would use window cuts.
    const filled = routeStream(
      [...Array.from({ length: 100 }, () => spread(3)), ...rest],
      opts(230),
    );
    expect(filled.slice(100)).not.toEqual(without);
    expect(withSlots.slice(100)).toEqual(without);
  });

  test("no-slot routing", () => {
    const slot = workerAnswers({
      tier: "slot::reviewer",
      tierP: { "slot::reviewer": 0.9, basic: 0.1 },
    });
    const got = routeStream([slot], opts(1, { routing: "tiers" }));
    expect(["basic", "broad", "deep", "frontier"]).toContain(got[0] as string);
  });

  test("no slot configured", () => {
    const answers = Array.from({ length: 120 }, (_, i) => spread(i));
    const a = routeStream(answers, opts(120, { config: noSlots, routing: "slots" }));
    const b = routeStream(answers, opts(120, { config: noSlots, routing: "tiers" }));
    expect(a).toEqual(b);
  });

  test("miss stays undefined", () => {
    const answers = Array.from({ length: 120 }, (_, i) => spread(i));
    const plain = routeStream(answers, opts(120));
    const holes = routeStream([undefined, ...answers], opts(121));
    expect(holes[0]).toBeUndefined();
    expect(holes.slice(1)).toEqual(plain);
  });
});
