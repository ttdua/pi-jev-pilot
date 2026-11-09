import { describe, expect, test } from "bun:test";
import { signalsByMode, type SignalLine } from "../../src/policy/tuning-signals.ts";

const main = (at: number, o: Partial<SignalLine> = {}): SignalLine => ({
  kind: "main",
  at,
  mode: "standard",
  ...o,
});
const worker = (at: number, o: Partial<SignalLine> = {}): SignalLine => ({
  kind: "worker",
  at,
  mode: "standard",
  ...o,
});
const get = (lines: readonly SignalLine[], mode = "standard") => {
  const found = signalsByMode(lines).find((s) => s.mode === mode);
  if (!found) throw new Error(`no signals for ${mode}`);
  return found;
};

describe("signalsByMode window", () => {
  test("window per mode", () => {
    const std = Array.from({ length: 250 }, (_, i) => main(i, { turnId: `t${i}` }));
    const bud = Array.from({ length: 10 }, (_, i) => main(i, { mode: "budget" }));
    const out = signalsByMode([...std, ...bud]);
    expect(out.map((s) => s.mode)).toEqual(["budget", "standard"]);
    expect(get([...std, ...bud]).corrected.of).toBe(200);
    expect(get([...std, ...bud], "budget").corrected.of).toBe(10);
    // oldest 50 fall out of the window: a correction for them adds nothing
    const lines = [...std, ...bud, { kind: "correction", at: 999, turnId: "t0" }];
    expect(get(lines).corrected).toEqual({ count: 0, of: 200 });
    const recent = [...std, { kind: "correction", at: 999, turnId: "t249" }];
    expect(get(recent).corrected).toEqual({ count: 1, of: 200 });
  });

  test("modes never mixed", () => {
    const lines = [
      worker(1, { mode: "budget", tier: "fast", status: "error" }),
      main(2, { mode: "standard" }),
    ];
    expect(get(lines, "budget").lowWorkerErrors).toEqual({ count: 1, of: 1 });
    expect(get(lines).lowWorkerErrors).toEqual({ count: 0, of: 0 });
  });

  test("empty mode left out", () => {
    const out = signalsByMode([main(1), main(2)]);
    expect(out.map((s) => s.mode)).toEqual(["standard"]);
  });

  test("other or absent mode ignored", () => {
    expect(signalsByMode([main(1, { mode: "weird" }), { kind: "main", at: 2 }])).toEqual([]);
  });

  test("input order irrelevant", () => {
    const lines = Array.from({ length: 201 }, (_, i) =>
      worker(5, { tier: "fast", status: i % 3 === 0 ? "error" : "completed", turnId: `x${i}` }),
    );
    const a = signalsByMode(lines);
    const b = signalsByMode([...lines].reverse());
    expect(b).toEqual(a);
    expect(a[0]?.lowWorkerErrors.of).toBe(200);
  });

  test("input unchanged", () => {
    const lines = [main(2, { effective: "low", toolCalls: 20 }), main(1), worker(3)];
    const copy = structuredClone(lines);
    signalsByMode(lines);
    expect(lines).toEqual(copy);
  });
});

describe("signal counts", () => {
  test("low worker errors counted with denominator", () => {
    const lines = [
      worker(1, { tier: "fast", status: "error" }),
      worker(2, { effort: "low", status: "completed" }),
      worker(3, { effort: "off", status: "aborted" }),
      worker(4, { tier: "deep", status: "error" }),
    ];
    expect(get(lines).lowWorkerErrors).toEqual({ count: 1, of: 3 });
  });

  test("correction points at a main line", () => {
    const lines = [
      main(1, { turnId: "a" }),
      main(2, { turnId: "b" }),
      main(3, { turnId: "c" }),
      main(4, { turnId: "d" }),
      { kind: "correction", at: 5, turnId: "b" },
    ];
    expect(get(lines).corrected).toEqual({ count: 1, of: 4 });
  });

  test("correction for a turn outside the window adds nothing", () => {
    const lines = [main(1, { turnId: "a" }), { kind: "correction", at: 2, turnId: "zzz" }];
    expect(get(lines).corrected).toEqual({ count: 0, of: 1 });
  });

  test("large turns at low effort threshold", () => {
    const lines = [
      main(1, { effective: "low", toolCalls: 14 }),
      main(2, { effective: "minimal", toolCalls: 15 }),
      main(3, { effective: "off", toolCalls: 30 }),
      main(4, { effective: "low" }),
    ];
    expect(get(lines).largeAtLow).toEqual({ count: 2, of: 3 });
  });

  test("small high turns", () => {
    const lines = [
      main(1, { effective: "high", toolCalls: 2, failures: 0, outcome: "ok" }),
      main(2, { effective: "high", toolCalls: 1, failures: 1, outcome: "ok" }),
      main(3, { effective: "high", toolCalls: 0, failures: 0, outcome: "error" }),
      main(4, { effective: "high", toolCalls: 5, failures: 0, outcome: "ok" }),
      worker(6, { effective: "high", toolCalls: 1, failures: 0, outcome: "ok" }),
    ];
    expect(get(lines).highSmall).toEqual({ count: 1, of: 4 });
  });

  test("a high line without failures stays in the denominator, uncounted", () => {
    const lines = [main(1, { effective: "high", toolCalls: 1, outcome: "ok" })];
    expect(get(lines).highSmall).toEqual({ count: 0, of: 1 });
  });
});
