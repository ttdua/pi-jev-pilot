import { describe, expect, test } from "bun:test";
import { REPORT_MODES, routeStream } from "../../scripts/replay/report-route.ts";
import type { PlainConfig } from "../../scripts/replay/variants.ts";
import { cutPointsFor } from "../../src/policy/cutpoints.ts";
import { SEED_CUTPOINTS } from "../../src/policy/seed.ts";
import { routeLaunch } from "../../src/policy/route.ts";
import { difficultyScore } from "../../src/policy/score.ts";
import { offeredTiers } from "../../src/jev/questions.ts";
import { RUBRIC_VERSION } from "../../src/jev/rubrics.ts";
import { windowEntries, type WindowLine } from "../../src/policy/cut-window.ts";
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
    const answers = Array.from({ length: 150 }, (_, i) => spread(i));
    const got = routeStream(answers, opts(150));
    expect(got.slice(0, 100)).toEqual(answers.slice(0, 100).map((a) => fixed(a)));
    const lines: WindowLine[] = answers.slice(0, 100).map((a, i) => {
      const r = recordOf(a);
      return {
        kind: "worker",
        at: i,
        rubric: RUBRIC_VERSION,
        expertOffered: true,
        score: difficultyScore(a.answers) as number,
        reason: r.reason,
        ...(r.tier !== undefined ? { tier: r.tier } : {}),
        ...(r.fallback !== undefined ? { fallback: r.fallback } : {}),
        effortP: {
          [a.answers["effort"]?.type === "choice" ? a.answers["effort"].choice : "high"]: 1,
        },
      };
    });
    const cuts = cutPointsFor(windowEntries(lines, RUBRIC_VERSION), "standard");
    expect(cuts).not.toEqual(SEED_CUTPOINTS.standard);
    expect(got[100]).toBe(fixed(answers[100]!, cuts));
  });

  test("seed for a short stream", () => {
    const answers = Array.from({ length: 20 }, (_, i) => spread(i));
    expect(routeStream(answers, opts(20))).toEqual(answers.map((a) => fixed(a)));
  });

  test("slot launch skips the window", () => {
    const slot = workerAnswers({ tier: "slot::reviewer", tierP: { "slot::reviewer": 0.9 } });
    const rest = Array.from({ length: 130 }, (_, i) => spread(i));
    const withSlot = routeStream([slot, ...rest], opts(131, { routing: "slots" }));
    expect(withSlot[0]).toBe("slot::reviewer");
    const without = routeStream(rest, opts(130, { routing: "slots" }));
    expect(withSlot.slice(1)).toEqual(without);
  });

  test("no-slot routing", () => {
    const slot = workerAnswers({ tier: "slot::reviewer", tierP: { "slot::reviewer": 0.9 } });
    const got = routeStream([slot], opts(1, { routing: "tiers" }));
    expect(got[0]).not.toBe("slot::reviewer");
    expect(got[0]).toBeDefined();
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
