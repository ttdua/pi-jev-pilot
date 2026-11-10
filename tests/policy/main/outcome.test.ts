import { describe, expect, test } from "bun:test";
import type { Answer, ReadResult } from "../../../src/policy/answers.ts";
import { strategyBlock } from "../../../src/policy/main/strategy.ts";
import { planOutcome, type OutcomeFlags } from "../../../src/policy/main/outcome.ts";

const flags = (over: Partial<OutcomeFlags> = {}): OutcomeFlags => ({
  held: false,
  effortOn: true,
  askEffort: true,
  askStrategy: true,
  supported: ["off", "minimal", "low", "medium", "high", "xhigh"],
  ...over,
});
const ok = { kind: "ok", ms: 5, body: {} } as const;
const choice = (pick: string, p = 0.7): Answer => ({
  type: "choice",
  choice: pick,
  probabilities: { [pick]: p },
});
const noul = (value: number): Answer => ({ type: "noul", noul: value });
const read = (answers: Record<string, Answer>): ReadResult => ({
  kind: "read",
  answers,
  unanswered: {},
});

describe("planOutcome: miss", () => {
  test("records the classifier miss and shows no answer while a feature is on", () => {
    const miss = { kind: "miss", miss: "timeout", reason: "slow", ms: 9 } as const;
    expect(planOutcome(flags(), miss, undefined, undefined)).toEqual({
      kind: "miss",
      patch: { miss: "timeout" },
      showNoAnswer: true,
    });
  });

  test("records a schema miss when the reply could not be read", () => {
    const plan = planOutcome(flags(), ok, { kind: "miss", miss: "schema" }, undefined);
    expect(plan).toMatchObject({ kind: "miss", patch: { miss: "schema" } });
  });

  test("shows nothing when neither effort nor strategy is on", () => {
    const plan = planOutcome(
      flags({ effortOn: false, askStrategy: false }),
      ok,
      undefined,
      undefined,
    );
    expect(plan).toMatchObject({ kind: "miss", showNoAnswer: false });
  });
});

describe("planOutcome: answered", () => {
  test("targets the chosen effort and records its probabilities", () => {
    const plan = planOutcome(flags(), ok, read({ effort: choice("high") }), undefined);
    expect(plan).toMatchObject({
      kind: "answered",
      patch: { answered: true, effortP: { high: 0.7 }, requested: "high" },
      effort: { kind: "target", target: "high" },
    });
  });

  test("raises a low effort to high when risky passes the floor", () => {
    const answers = { effort: choice("low"), risky: noul(0.9) };
    const plan = planOutcome(flags(), ok, read(answers), undefined);
    expect(plan).toMatchObject({
      patch: { risky: 0.9, requested: "high" },
      effort: { kind: "target", target: "high" },
    });
  });

  test("records corrects", () => {
    const plan = planOutcome(flags(), ok, read({ corrects: noul(0.4) }), undefined);
    expect(plan.patch).toMatchObject({ corrects: 0.4 });
  });

  test("shows no answer for an asked effort that was not answered", () => {
    const plan = planOutcome(flags(), ok, read({}), undefined);
    expect(plan).toMatchObject({ effort: { kind: "unanswered", showNoAnswer: true } });
  });

  test("keeps the effort suffix when effort was not asked", () => {
    const plan = planOutcome(flags({ askEffort: false }), ok, read({}), undefined);
    expect(plan).toMatchObject({ effort: { kind: "unanswered", showNoAnswer: false } });
  });
});

describe("planOutcome: advice", () => {
  test("advises a strategy that passes its gate", () => {
    const plan = planOutcome(flags(), ok, read({ strategy: choice("delegate", 0.8) }), undefined);
    expect(plan).toMatchObject({
      patch: { strategy: "delegate", strategyP: 0.8, advised: true },
      nextAdvice: "delegate",
      adviceBlock: strategyBlock("delegate"),
    });
  });

  test("records but does not advise a strategy below its gate", () => {
    const plan = planOutcome(flags(), ok, read({ strategy: choice("delegate", 0.3) }), "graph");
    expect(plan).toMatchObject({
      patch: { strategy: "delegate", advised: false },
      nextAdvice: undefined,
      adviceBlock: undefined,
    });
  });

  test("keeps the current advice when strategy was not asked", () => {
    const plan = planOutcome(flags({ askStrategy: false }), ok, read({}), "graph");
    expect(plan).toMatchObject({ nextAdvice: "graph", adviceBlock: undefined });
    expect(plan.patch).not.toHaveProperty("strategy");
  });
});

describe("planOutcome: held", () => {
  const held = flags({ held: true });

  test("records corrects and advice but never an effort target", () => {
    const answers = { effort: choice("high"), risky: noul(0.9), corrects: noul(0.2) };
    const plan = planOutcome(
      held,
      ok,
      read({ ...answers, strategy: choice("delegate", 0.8) }),
      undefined,
    );
    expect(plan).toEqual({
      kind: "held",
      patch: { answered: true, corrects: 0.2, strategy: "delegate", strategyP: 0.8, advised: true },
      nextAdvice: "delegate",
      adviceBlock: strategyBlock("delegate"),
    });
  });

  test("clears the advice on a classifier miss", () => {
    const miss = { kind: "miss", miss: "error", reason: "x", ms: 1 } as const;
    expect(planOutcome(held, miss, undefined, "graph")).toEqual({
      kind: "held",
      patch: { miss: "error" },
      nextAdvice: undefined,
      adviceBlock: undefined,
    });
  });

  test("records a schema miss when the reply could not be read", () => {
    const plan = planOutcome(held, ok, { kind: "miss", miss: "schema" }, "graph");
    expect(plan).toMatchObject({ kind: "held", patch: { miss: "schema" }, nextAdvice: undefined });
  });
});
