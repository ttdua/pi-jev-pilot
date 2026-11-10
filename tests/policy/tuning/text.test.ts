import { describe, expect, test } from "bun:test";
import {
  NOTHING_TO_UNDO,
  OFF_MESSAGE,
  ON_MESSAGE,
  changeLine,
  issueLines,
  resetMessage,
  sessionStartLine,
  tuneReport,
  undoneMessage,
  type TuneView,
} from "../../../src/policy/tuning/text.ts";
import type { HistoryEntry } from "../../../src/policy/tuning/rules.ts";

const entry = (
  at: number,
  from: number,
  to: number,
  cause: HistoryEntry["cause"],
): HistoryEntry => ({
  at,
  parameter: "timeoutMs",
  from,
  to,
  cause,
});

const view = (o: Partial<TuneView> = {}): TuneView => ({
  off: false,
  effective: 1500,
  configValid: true,
  history: [],
  signals: [],
  problems: [],
  ...o,
});

describe("issueLines", () => {
  test("formats the file path as (file)", () => {
    expect(issueLines("tuning (malformed)", [{ path: "", message: "m" }])).toEqual([
      "  tuning (malformed) (file): m",
    ]);
  });
  test("keeps a field path", () => {
    expect(issueLines("config", [{ path: "a.b", message: "m" }])).toEqual(["  config a.b: m"]);
  });
});

describe("changeLine", () => {
  test("applied, reverted, superseded", () => {
    expect(changeLine({ kind: "applied", from: 1500, to: 1700 })).toBe(
      "Jev tune: timeoutMs 1500→1700 · /jev tune undo",
    );
    expect(changeLine({ kind: "reverted", from: 1700, to: 1500 })).toBe(
      "Jev tune: timeoutMs 1700→1500, reverted: timeouts did not improve · /jev tune",
    );
    expect(changeLine({ kind: "superseded", from: 1700, to: 2000 })).toBe(
      "Jev tune: timeoutMs 1700→2000, your config value replaces the tuned one",
    );
  });
  test("kept is silent", () => {
    expect(changeLine({ kind: "kept", from: 1500, to: 1700 })).toBeUndefined();
  });
});

describe("sessionStartLine", () => {
  const head = "Jev tune since your last session: timeoutMs";
  test("one change", () => {
    expect(sessionStartLine([entry(1, 1500, 1700, "rule")])).toBe(
      `${head} 1500→1700 (1 change) · /jev tune`,
    );
  });
  test("several changes", () => {
    expect(sessionStartLine([entry(1, 1700, 1900, "rule"), entry(2, 1900, 2100, "rule")])).toBe(
      `${head} 1700→2100 (2 changes) · /jev tune`,
    );
  });
  test("changes that cancel out", () => {
    expect(sessionStartLine([entry(1, 1500, 1700, "rule"), entry(2, 1700, 1500, "revert")])).toBe(
      `${head} 1500→1500 (2 changes) · /jev tune`,
    );
  });
});

describe("messages", () => {
  test("exact strings", () => {
    expect(undoneMessage(1700, 1500)).toBe(
      "Jev tune: timeoutMs 1700→1500 undone. The same raise is held back for 200 decisions.",
    );
    expect(resetMessage(1500)).toBe("Jev tune: back to your settings (timeoutMs 1500).");
    expect(NOTHING_TO_UNDO).toBe("Jev tune: nothing to undo.");
    expect(OFF_MESSAGE).toBe("Jev tune: off. A tuned value stays until /jev tune undo or reset.");
    expect(ON_MESSAGE).toBe("Jev tune: on.");
  });
});

describe("tuneReport", () => {
  test("not tuned", () => {
    expect(tuneReport(view()).split("\n")).toEqual([
      "tuning: on",
      "timeoutMs: 1500 (not tuned)",
      "history: none",
      "signals: no decisions yet",
    ]);
  });
  test("tuned and off", () => {
    const lines = tuneReport(view({ off: true, effective: 1700, tunedFrom: 1500 })).split("\n");
    expect(lines.slice(0, 2)).toEqual(["tuning: off", "timeoutMs: 1700 (tuned from 1500)"]);
  });
  test("pending, capped count, block", () => {
    const p = tuneReport(view({ pending: { from: 1500, to: 1700, since: 12 } }));
    expect(p).toContain("pending: 1500→1700, 12/40 decisions since");
    expect(tuneReport(view({ pending: { from: 1500, to: 1700, since: 40 } }))).toContain(
      "40/40 decisions since",
    );
    expect(tuneReport(view({ block: { value: 1700, remaining: 150 } }))).toContain(
      "block: raises to 1700 or above held back for 150 more decisions",
    );
  });
  test("neither pending nor blocked", () => {
    const r = tuneReport(view({ effective: 1700, tunedFrom: 1500 }));
    expect(r).not.toMatch(/pending:|block:|tuning paused/);
  });
  test("config error follows timeoutMs", () => {
    const lines = tuneReport(view({ configValid: false })).split("\n");
    expect(lines[2]).toBe("tuning paused: config error");
  });
  test("history newest first, five shown", () => {
    const h = [
      entry(Date.UTC(2026, 10, 7, 10), 1500, 1700, "rule"),
      entry(Date.UTC(2026, 10, 7, 11, 30), 1700, 1500, "undo"),
    ];
    const r = tuneReport(view({ history: h }));
    const a = r.indexOf("  2026-11-07T11:30Z undo 1700→1500");
    const b = r.indexOf("  2026-11-07T10:00Z rule 1500→1700");
    expect(a).toBeGreaterThan(r.indexOf("history:"));
    expect(b).toBeGreaterThan(a);
    const seven = Array.from({ length: 7 }, (_, i) => entry(i * 60000, 1500, 1700, "rule"));
    const lines = tuneReport(view({ history: seven })).split("\n");
    expect(lines.filter((l) => l.includes("rule 1500→1700"))).toHaveLength(5);
    expect(lines).toContain("  1970-01-01T00:06Z rule 1500→1700");
    expect(lines).not.toContain("  1970-01-01T00:01Z rule 1500→1700");
  });
  test("signals", () => {
    const s = {
      mode: "standard",
      lowWorkerErrors: { count: 1, of: 3 },
      corrected: { count: 0, of: 4 },
      largeAtLow: { count: 0, of: 0 },
      highSmall: { count: 0, of: 0 },
    };
    const lines = tuneReport(view({ signals: [s] })).split("\n");
    expect(lines).toContain("signals (observed, not applied; latest 200 decisions per mode):");
    expect(lines).toContain(
      "  standard: lowWorkerErrors 1/3 · corrected 0/4 · largeAtLow 0/0 · highSmall 0/0",
    );
  });
  test("ledger unreadable replaces pending/block/signals; problems last", () => {
    const r = tuneReport(
      view({
        signals: "ledger-unreadable",
        pending: { from: 1500, to: 1700, since: 3 },
        block: { value: 1700, remaining: 5 },
        problems: ["  tuning (malformed) (file): m"],
      }),
    );
    const lines = r.split("\n");
    expect(r).not.toMatch(/pending:|block:|signals/);
    expect(lines.indexOf("ledger unreadable")).toBeLessThan(lines.indexOf("history: none"));
    expect(lines.slice(-2)).toEqual(["problems:", "  tuning (malformed) (file): m"]);
  });
});
