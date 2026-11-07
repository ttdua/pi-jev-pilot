import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mainSamples,
  mainStratum,
  sample,
  workerKind,
  workerSamples,
} from "../../scripts/replay/corpus.ts";

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
      "Fork branch one",
      "Fork branch two",
    ]);
  });

  test("start effort from the effort entry or the ledger", () => {
    const s = mainSamples(dir);
    expect(s.map((x) => x.startEffort)).toEqual([
      "high",
      "low",
      undefined,
      undefined,
      undefined,
      "xhigh",
      "low",
    ]);
    expect(s[2]!.branch.map((e) => e.id)).toEqual(["u1", "c1", "a1", "u3"]);
  });
});

describe("mainSamples robustness", () => {
  test("headerless session file is skipped, not thrown", () => {
    expect(mainSamples(dir).map((s) => s.prompt)).not.toContain("headerless prompt");
    expect(workerSamples(dir).length).toBeGreaterThan(0);
  });

  test("turn id is the first jev-turn after the prompt", () => {
    const byPrompt = new Map(mainSamples(dir).map((s) => [s.prompt, s.turnId]));
    expect(byPrompt.get("Add gadget tests")).toBe("turn-2");
    expect(byPrompt.get("Fix the widget parser")).toBeUndefined();
  });

  test("any slash prompt is excluded", () => {
    expect(mainSamples(dir).map((s) => s.prompt)).not.toContain("/other cmd");
  });

  test("start effort follows the prompt's branch, not file order", () => {
    const fork = mainSamples(dir).filter((s) => s.session === "s-fork");
    expect(fork.map((s) => [s.prompt, s.startEffort])).toEqual([
      ["Fork branch one", "xhigh"],
      ["Fork branch two", "low"],
    ]);
  });

  test("mainStratum is cwd plus start effort", () => {
    const [a, b] = [mainSamples(dir)[0]!, mainSamples(dir)[2]!];
    expect(mainStratum(a)).toBe("/work/alpha|high");
    expect(mainStratum(b)).toBe("/work/alpha|unknown");
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
  test("n >= items.length returns every item", () => {
    expect(
      sample(items, 99, 1, (t) => t.g)
        .map((t) => t.i)
        .sort((x, y) => x - y),
    ).toEqual(items.map((t) => t.i));
  });
  test("exact largest-remainder allocation", () => {
    const got = sample(items, 6, 3, (t) => t.g);
    const count = (g: string) => got.filter((t) => t.g === g).length;
    // exact quotas: a 4.0, b 1.5, c 0.5 -> a 4, then b takes the extra by key order
    expect([count("a"), count("b"), count("c")]).toEqual([4, 2, 0]);
  });
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

describe("nested session layout", () => {
  const root = mkdtempSync(join(tmpdir(), "replay-nested-"));
  const project = join(root, "--work-alpha--");
  const childDir = join(project, "2026_main", "run-uuid", "run-0");
  mkdirSync(childDir, { recursive: true });
  copyFileSync(join(dir, "main.jsonl"), join(project, "2026_main.jsonl"));
  copyFileSync(join(dir, "workers.jsonl"), join(project, "2026_workers.jsonl"));
  copyFileSync(join(dir, "child.jsonl"), join(childDir, "session.jsonl"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("finds nested top-level sessions and excludes the child", () => {
    const prompts = mainSamples(root).map((s) => s.prompt);
    expect(prompts).toContain("Fix the widget parser");
    expect(prompts).not.toContain("Child only prompt");
    expect(workerSamples(root).length).toBeGreaterThan(0);
  });
});
