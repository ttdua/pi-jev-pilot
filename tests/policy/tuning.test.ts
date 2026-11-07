import { describe, expect, test } from "bun:test";
import { TUNING, type HistoryEntry, type TuningRecord } from "../../src/policy/tuning.ts";

describe("tuning contract", () => {
  test("constants are the contract values", () => {
    expect(TUNING).toEqual({
      window: 40,
      minAsked: 20,
      shareDenominator: 10,
      cooldown: 40,
      blockFor: 200,
      step: 200,
      p90Factor: 1.25,
      roundTo: 100,
      min: 300,
      max: 5000,
      history: 50,
    });
  });

  test("HistoryEntry is one history element", () => {
    const entry: HistoryEntry = {
      at: 1,
      parameter: "timeoutMs",
      from: 1500,
      to: 1700,
      cause: "rule",
    };
    const record: TuningRecord = { history: [entry] };
    expect(record.history?.[0]).toBe(entry);
  });
});
