import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import type { Strategy as LedgerStrategy } from "../../src/store/ledger-schema.ts";
import {
  adviseStrategy,
  GRAPH_THRESHOLD,
  STRATEGIES,
  STRATEGY_THRESHOLD,
  strategyBlock,
  type Strategy as PolicyStrategy,
} from "../../src/policy/strategy.ts";

const docs = readFileSync(new URL("../../docs/jev-questions.md", import.meta.url), "utf8");

const _eq: [PolicyStrategy] extends [LedgerStrategy]
  ? [LedgerStrategy] extends [PolicyStrategy]
    ? true
    : never
  : never = true;

/** Probabilities with `p` on `choice` and the rest spread over the other strategies. */
function ans(choice: string, p: number) {
  const others = STRATEGIES.filter((s) => s !== choice);
  const probabilities: Record<string, number> = {};
  for (const s of others) probabilities[s] = (1 - p) / others.length;
  probabilities[choice] = p;
  return { choice, probabilities };
}

describe("adviseStrategy gates", () => {
  test.each([
    ["delegate", 0.6, undefined, true],
    ["delegate", 0.59, undefined, false],
    ["parallel", 0.6, "balanced", true],
    ["parallel", 0.59, "deep", false],
    ["parallel", 0.9, "fast", false],
    ["parallel", 0.95, undefined, false],
    ["graph", 0.8, "deep", true],
    ["graph", 0.79, "deep", false],
    ["graph", 0.95, "balanced", false],
    ["graph", 0.95, undefined, false],
    ["delegate", 0.7, undefined, true],
  ] as const)("%s at %d with tier %s -> advised %s", (choice, p, tier, advised) => {
    const input =
      tier === undefined ? { strategy: ans(choice, p) } : { strategy: ans(choice, p), tier };
    const out = adviseStrategy(input);
    expect(out?.advised).toBe(advised);
    expect(out?.block !== undefined).toBe(advised);
    expect(GRAPH_THRESHOLD).toBe(0.8);
    expect(STRATEGY_THRESHOLD).toBe(0.6);
  });

  test("direct never attaches", () => {
    const out = adviseStrategy({ strategy: ans("direct", 1) });
    expect(out?.advised).toBe(false);
    expect(out?.block).toBeUndefined();
  });

  test("unknown choice or missing strategy gives undefined", () => {
    expect(adviseStrategy({ strategy: ans("junior", 0.9) })).toBeUndefined();
    expect(adviseStrategy({})).toBeUndefined();
  });

  test("confidence is ignored and strategyP is the chosen probability", () => {
    const strategy = { ...ans("delegate", 0.7), confidence: 0.1 };
    const out = adviseStrategy({ strategy });
    expect(out?.advised).toBe(true);
    expect(out?.strategyP).toBe(0.7);
  });
});

describe("strategyBlock", () => {
  test.each(["delegate", "parallel", "graph"] as const)("%s block", (s) => {
    const block = strategyBlock(s);
    expect(
      block.startsWith(
        `<execution_strategy>\nA fast decision model read this request as best carried out as: ${s}.`,
      ),
    ).toBe(true);
    expect(
      block.endsWith(
        "If the actual work does not fit, ignore this and work directly.\n</execution_strategy>",
      ),
    ).toBe(true);
    const how = block.split("\n").slice(2, -2).join("\n");
    expect(docs).toContain(how);
    expect(block).not.toContain("junior");
  });
});
