import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mainSamples, sample, workerKind, workerSamples } from "../../scripts/replay/corpus.ts";

const dir = join(import.meta.dir, "../fixtures/replay/sessions");
const items = Array.from({ length: 60 }, (_, i) => ({ i, g: i < 40 ? "a" : i < 55 ? "b" : "c" }));
const pick = (seed: number) => sample(items, 20, seed, (t) => t.g).map((t) => t.i);

describe("mainSamples", () => {
  test("exclusions", () => {
    const prompts = mainSamples(dir).map((s) => s.prompt);
    expect(prompts).toEqual([
      "Fix the widget parser",
      "Add gadget tests",
      "Rename the gizmo module",
      "Plan the doohickey work",
      "Now do it",
    ]);
  });

  test("start effort from the effort entry or the ledger", () => {
    const s = mainSamples(dir);
    expect(s.map((x) => x.startEffort)).toEqual(["high", "low", undefined, undefined, undefined]);
    expect(s[2]!.branch.map((e) => e.id)).toEqual(["u1", "c1", "a1", "u3"]);
  });
});

describe("workerSamples", () => {
  test("worker samples come from subagent tool calls", () => {
    const w = workerSamples(dir);
    expect(w.map((x) => x.agent)).toEqual(["scout", "worker", "reviewer", "general"]);
    expect(w[0]).toMatchObject({
      brief: "Explore doohickey layout",
      parentPrompt: "Plan the doohickey work",
      runInBackground: false,
    });
    expect(w[1]!.parentPrompt).toBe("Now do it");
    expect(w[3]).toMatchObject({ description: "Audit pass", runInBackground: true });
    expect(w.map(workerKind)).toEqual(["scout", "implementation", "review", "review"]);
  });
});

describe("sample", () => {
  test("same seed, same corpus", () => expect(pick(7)).toEqual(pick(7)));
  test("different seed differs", () => expect(pick(7)).not.toEqual(pick(8)));
  test("stratified", () => {
    const got = sample(items, 20, 3, (t) => t.g);
    expect(got).toHaveLength(20);
    for (const [g, size] of [
      ["a", 40],
      ["b", 15],
      ["c", 5],
    ] as const) {
      const n = got.filter((t) => t.g === g).length;
      expect(Math.abs(n - (size * 20) / 60)).toBeLessThan(1);
    }
  });
});
