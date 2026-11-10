import { describe, expect, test } from "bun:test";

import type { Answer, ReadResult } from "../../../src/policy/answers.ts";
import { pickSkill } from "../../../src/policy/main/skill.ts";

function which(probs: Record<string, number>, extra: Record<string, Answer> = {}): ReadResult {
  const best = Object.entries(probs).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  return {
    kind: "read",
    answers: { which: { type: "choice", choice: best, probabilities: probs }, ...extra },
    unanswered: {},
  };
}

const noul = (n: number): Answer => ({ type: "noul", noul: n });
const OPT = ["debug", "(none)"];
const G = "gate::acts_on_user_system";

describe("pickSkill (pin)", () => {
  test("decision table over leader p and gate mean", () => {
    // [p, gate mean (undefined = no gate), expected kind]
    const table: [number, number | undefined, "picked" | "none"][] = [
      [0.5, undefined, "picked"],
      [0.5, 0, "picked"],
      [0.49, undefined, "none"],
      [0.49, 0.29, "none"],
      [0.49, 0.3, "picked"],
      [0.3, 0.3, "picked"],
      [0.3, 0.29, "none"],
      [0.29, 1, "none"],
      [0.29, undefined, "none"],
      [0.9, undefined, "picked"],
    ];
    for (const [p, gate, expected] of table) {
      const gates: Record<string, Answer> = gate === undefined ? {} : { [G]: noul(gate) };
      const pick = pickSkill([{ options: OPT, read: which({ debug: p, "(none)": 0.01 }, gates) }]);
      expect(pick.kind).toBe(expected);
    }
  });

  test("picked: full object, key order, gate only when present", () => {
    const withGate = pickSkill([
      { options: OPT, read: which({ debug: 0.6, "(none)": 0.1 }, { [G]: noul(0.5) }) },
    ]);
    expect(withGate).toEqual({ kind: "picked", name: "debug", p: 0.6, gate: 0.5 });
    expect(Object.keys(withGate)).toEqual(["kind", "name", "p", "gate"]);
    const bare = pickSkill([{ options: OPT, read: which({ debug: 0.6, "(none)": 0.1 }) }]);
    expect(Object.keys(bare)).toEqual(["kind", "name", "p"]);
  });

  test("below: full object, key order, with and without gate", () => {
    const g = pickSkill([
      { options: OPT, read: which({ debug: 0.4, "(none)": 0.1 }, { [G]: noul(0.1) }) },
    ]);
    expect(g).toEqual({ kind: "none", reason: "below", p: 0.4, gate: 0.1 });
    expect(Object.keys(g)).toEqual(["kind", "reason", "p", "gate"]);
    const b = pickSkill([{ options: OPT, read: which({ debug: 0.4, "(none)": 0.1 }) }]);
    expect(Object.keys(b)).toEqual(["kind", "reason", "p"]);
  });

  test("none-leads: key order with and without gate", () => {
    const r = which({ debug: 0.1, "(none)": 0.9 }, { [G]: noul(0.2) });
    const g = pickSkill([{ options: OPT, read: r }]);
    expect(g).toEqual({ kind: "none", reason: "none-leads", gate: 0.2 });
    expect(Object.keys(g)).toEqual(["kind", "reason", "gate"]);
    const b = pickSkill([{ options: OPT, read: which({ debug: 0.1, "(none)": 0.9 }) }]);
    expect(Object.keys(b)).toEqual(["kind", "reason"]);
  });

  test("failed and no-batch results carry no p or gate", () => {
    expect(Object.keys(pickSkill([]))).toEqual(["kind", "reason"]);
    const f = pickSkill([{ options: OPT, read: undefined }]);
    expect(f).toEqual({ kind: "none", reason: "failed" });
    expect(Object.keys(f)).toEqual(["kind", "reason"]);
  });

  test("failed when `which` is missing, wrong type, or the read is a miss", () => {
    const noWhich: ReadResult = { kind: "read", answers: {}, unanswered: { which: "missing" } };
    const wrongType: ReadResult = { kind: "read", answers: { which: noul(0.9) }, unanswered: {} };
    for (const read of [noWhich, wrongType, { kind: "miss", miss: "schema" } as ReadResult]) {
      expect(pickSkill([{ options: OPT, read }])).toEqual({ kind: "none", reason: "failed" });
    }
  });

  test("failed beats a sure pick when the first batch fails", () => {
    const pick = pickSkill([
      { options: OPT, read: undefined },
      { options: OPT, read: which({ debug: 0.9, "(none)": 0.1 }) },
    ]);
    expect(pick).toEqual({ kind: "none", reason: "failed" });
  });

  test("only batch 0 gates count, even when the leader comes from a later batch", () => {
    const first = which({ plan: 0.2, "(none)": 0.1 }, { [G]: noul(0.1) });
    const second = which({ deploy: 0.4, "(none)": 0.1 }, { [G]: noul(1) });
    const pick = pickSkill([
      { options: ["plan", "(none)"], read: first },
      { options: ["deploy", "(none)"], read: second },
    ]);
    expect(pick).toEqual({ kind: "none", reason: "below", p: 0.4, gate: 0.1 });
    const second2 = which({ deploy: 0.4, "(none)": 0.1 });
    const pick2 = pickSkill([
      {
        options: ["plan", "(none)"],
        read: which({ plan: 0.2, "(none)": 0.1 }, { [G]: noul(0.9) }),
      },
      { options: ["deploy", "(none)"], read: second2 },
    ]);
    expect(pick2).toEqual({ kind: "picked", name: "deploy", p: 0.4, gate: 0.9 });
  });

  test("a batch led by none does not hide a leader elsewhere", () => {
    const pick = pickSkill([
      { options: OPT, read: which({ debug: 0.1, "(none)": 0.9 }) },
      { options: ["plan", "(none)"], read: which({ plan: 0.6, "(none)": 0.1 }) },
    ]);
    expect(pick).toMatchObject({ kind: "picked", name: "plan", p: 0.6 });
  });

  test("tie across batches keeps the earlier; strictly greater later wins", () => {
    const a = { options: ["a", "(none)"], read: which({ a: 0.6, "(none)": 0.1 }) };
    const b = { options: ["b", "(none)"], read: which({ b: 0.6, "(none)": 0.1 }) };
    const c = { options: ["c", "(none)"], read: which({ c: 0.61, "(none)": 0.1 }) };
    expect(pickSkill([a, b])).toMatchObject({ name: "a" });
    expect(pickSkill([a, b, c])).toMatchObject({ name: "c" });
  });

  test("options absent from the probabilities are skipped; no options means none-leads", () => {
    expect(pickSkill([{ options: ["ghost"], read: which({ debug: 0.9, "(none)": 0.1 }) }])).toEqual(
      { kind: "none", reason: "none-leads" },
    );
    expect(pickSkill([{ options: [], read: which({ debug: 0.9 }) }])).toEqual({
      kind: "none",
      reason: "none-leads",
    });
  });

  test("gate mean uses prose_suffices inverted and ignores non-noul gates", () => {
    const read = which(
      { debug: 0.35, "(none)": 0.1 },
      {
        "gate::prose_suffices": noul(0.9),
        [G]: noul(0.6),
        "gate::would_follow_documented_procedure": {
          type: "choice",
          choice: "x",
          probabilities: { x: 1 },
        },
      },
    );
    const pick = pickSkill([{ options: OPT, read }]);
    expect(pick.kind).toBe("picked");
    expect(pick.kind === "picked" ? pick.gate : 0).toBeCloseTo(0.35, 10);
  });

  test("first batch read through a miss-free later batch still counts gates from batch 0 only", () => {
    const miss0: ReadResult = { kind: "miss", miss: "schema" };
    expect(
      pickSkill([
        { options: OPT, read: miss0 },
        { options: OPT, read: which({ debug: 0.9 }) },
      ]),
    ).toEqual({ kind: "none", reason: "failed" });
  });
});
