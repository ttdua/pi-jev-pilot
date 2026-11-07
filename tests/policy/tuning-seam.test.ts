import { describe, expect, test } from "bun:test";
import type { DecisionLine } from "../../src/policy/tuning-window.ts";
import type { TuningRecord } from "../../src/policy/tuning.ts";
import type { LedgerEntry } from "../../src/store/ledger-schema.ts";
import { resolveSettings, type Tuning } from "../../src/store/settings.ts";

describe("tuning host seams", () => {
  test("ledger entries are decision lines", () => {
    const entries: LedgerEntry[] = [];
    const decisions: readonly DecisionLine[] = entries;
    expect(decisions).toHaveLength(0);
  });

  test("a tuning record is accepted as store tuning", () => {
    const record: TuningRecord = { timeoutMs: { value: 1700, base: 1500 } };
    const tuning: Tuning = record;
    expect(resolveSettings({ config: {}, state: {}, tuning }).classifier.timeoutMs).toBe(1700);
  });
});
