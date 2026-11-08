import { describe, expect, test } from "bun:test";
import { REPORT_MODES, routeStream } from "../../scripts/replay/report-route.ts";
import type { PlainConfig } from "../../scripts/replay/variants.ts";
import { cutPointsFor } from "../../src/policy/cutpoints.ts";
import { SEED_CUTPOINTS } from "../../src/policy/seed.ts";
import { routeLaunch } from "../../src/policy/route.ts";
import { difficultyScore } from "../../src/policy/score.ts";
import { offeredTiers } from "../../src/jev/questions.ts";
import { RUBRIC_VERSION } from "../../src/jev/rubrics.ts";
import { WINDOW_MAX, windowEntries, type WindowLine } from "../../src/policy/cut-window.ts";
import { modelOfConfig, REPLAY_LAUNCH } from "../../scripts/replay/compare.ts";
import { workerAnswers } from "./helpers.ts";

const config: PlainConfig = {
  tiers: { fast: "a/b", balanced: "b/c", deep: "c/d", expert: "e/f" },
  slots: [{ name: "reviewer", model: "m/n", when: "for review" }],
  mode: "standard",
  expertOn: true,
};
const noSlots: PlainConfig = { ...config, slots: [] };
const opts = (n: number, over = {}) => ({
  config,
  mode: "standard" as const,
  routing: "tiers" as const,
  background: Array<boolean>(n).fill(false),
  ...over,
});

// Spread scores: tier distribution moves with i.
const spread = (i: number) => {
  const t = ["fast", "balanced", "deep", "expert"][i % 4] ?? "fast";
  return workerAnswers({ tier: t, tierP: { [t]: 1 }, effort: i % 2 ? "high" : "low" });
};

// Reference: routing one answer with explicit cuts, as the host would.
const recordOf = (a: ReturnType<typeof workerAnswers>, cuts = SEED_CUTPOINTS.standard) => {
  const r = routeLaunch({
    answers: a,
    launch: REPLAY_LAUNCH(false),
    offered: offeredTiers(config.tiers, config.expertOn),
    cuts,
    forkedLaunch: "untouched",
    canRun: () => true,
    thinkingOf: () => ({ reasoning: true }),
    modelOf: modelOfConfig(config),
    slots: [],
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

  test("seed then window", () => {
    // Skewed stream: window cuts differ from the seed once 100 entries exist.
    const answers = Array.from({ length: 150 }, (_, i) =>
      workerAnswers({
        tier: "deep",
        tierP: { deep: 0.6, balanced: 0.3, fast: 0.1 },
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
        expertOffered: true,
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
      tierP: { "slot::reviewer": 0.9, fast: 0.1 },
    });
    const got = routeStream([slot], opts(1, { routing: "tiers" }));
    expect(["fast", "balanced", "deep", "expert"]).toContain(got[0] as string);
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
