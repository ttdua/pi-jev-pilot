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

const BUILTIN_VIEW: TuneView["floors"] = [
  { band: "medium", value: 40 },
  { band: "long", value: 100 },
  { band: "very_long", value: 200 },
];
const NO_RUNS: TuneView["turnSignals"] = [
  { band: "medium", runs: 0 },
  { band: "long", runs: 0 },
  { band: "very_long", runs: 0 },
];

const view = (o: Partial<TuneView> = {}): TuneView => ({
  off: false,
  effective: 1500,
  configValid: true,
  history: [],
  signals: [],
  floors: BUILTIN_VIEW,
  floorPending: [],
  floorBlocks: [],
  turnSignals: NO_RUNS,
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
    expect(changeLine({ kind: "applied", parameter: "timeoutMs", from: 1500, to: 1700 })).toBe(
      "Jev tune: timeoutMs 1500→1700 · /jev tune undo",
    );
    expect(changeLine({ kind: "reverted", parameter: "timeoutMs", from: 1700, to: 1500 })).toBe(
      "Jev tune: timeoutMs 1700→1500, reverted: timeouts did not improve · /jev tune",
    );
    expect(changeLine({ kind: "superseded", parameter: "timeoutMs", from: 1700, to: 2000 })).toBe(
      "Jev tune: timeoutMs 1700→2000, your config value replaces the tuned one",
    );
  });
  test("kept is silent", () => {
    expect(
      changeLine({ kind: "kept", parameter: "timeoutMs", from: 1500, to: 1700 }),
    ).toBeUndefined();
    expect(
      changeLine({ kind: "kept", parameter: "turnFloor.long", from: 100, to: 80 }),
    ).toBeUndefined();
  });
  test("floor applied, reverted, superseded", () => {
    const p = "turnFloor.long" as const;
    expect(changeLine({ kind: "applied", parameter: p, from: 100, to: 80 })).toBe(
      "Jev tune: turnFloor.long 100→80 · /jev tune undo",
    );
    expect(changeLine({ kind: "reverted", parameter: p, from: 80, to: 100 })).toBe(
      "Jev tune: turnFloor.long 80→100, reverted: more runs ran out of turns · /jev tune",
    );
    expect(changeLine({ kind: "superseded", parameter: p, from: 120, to: 100 })).toBe(
      "Jev tune: turnFloor.long 120→100, the built-in floor changed",
    );
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
  test("several parameters", () => {
    const floor: HistoryEntry = {
      at: 2,
      parameter: "turnFloor.long",
      from: 100,
      to: 80,
      cause: "rule",
    };
    expect(
      sessionStartLine([entry(1, 1500, 1700, "rule"), floor, entry(3, 1700, 1900, "rule")]),
    ).toBe(
      "Jev tune since your last session: timeoutMs 1500→1900, turnFloor.long 100→80 (3 changes) · /jev tune",
    );
  });
  test("only a floor", () => {
    const floor: HistoryEntry = {
      at: 2,
      parameter: "turnFloor.medium",
      from: 40,
      to: 50,
      cause: "rule",
    };
    expect(sessionStartLine([floor])).toBe(
      "Jev tune since your last session: turnFloor.medium 40→50 (1 change) · /jev tune",
    );
  });
});

describe("messages", () => {
  test("exact strings", () => {
    expect(undoneMessage("timeoutMs", 1700, 1500)).toBe(
      "Jev tune: timeoutMs 1700→1500 undone. The same raise is held back for 200 decisions.",
    );
    expect(undoneMessage("turnFloor.long", 80, 100)).toBe(
      "Jev tune: turnFloor.long 80→100 undone. The same change is held back for 400 long runs.",
    );
    expect(undoneMessage("turnFloor.very_long", 250, 200)).toBe(
      "Jev tune: turnFloor.very_long 250→200 undone. The same change is held back for 400 very_long runs.",
    );
    expect(resetMessage(1500)).toBe(
      "Jev tune: back to your settings (timeoutMs 1500, turn floors 40/100/200).",
    );
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
      "turnFloor: medium 40 · long 100 · very_long 200",
      "history: none",
      "signals: no decisions yet",
      "turn signals (observed; latest 200 runs per band):",
      "  medium: no runs yet",
      "  long: no runs yet",
      "  very_long: no runs yet",
    ]);
  });
  test("floor tuned, pending and block, after the timeout state lines", () => {
    const lines = tuneReport(
      view({
        pending: { from: 1500, to: 1700, since: 12 },
        block: { value: 1900, remaining: 3 },
        floors: [
          { band: "medium", value: 40 },
          { band: "long", value: 80, tunedFrom: 100 },
          { band: "very_long", value: 200 },
        ],
        floorPending: [{ band: "long", from: 100, to: 80, since: 37 }],
        floorBlocks: [{ band: "very_long", value: 250, remaining: 350 }],
      }),
    ).split("\n");
    expect(lines.slice(0, 7)).toEqual([
      "tuning: on",
      "timeoutMs: 1500 (not tuned)",
      "turnFloor: medium 40 · long 80 (tuned from 100) · very_long 200",
      "pending: 1500→1700, 12/40 decisions since",
      "block: raises to 1900 or above held back for 3 more decisions",
      "pending turnFloor.long: 100→80, 37/200 runs since",
      "block turnFloor.very_long: 250 held back for 350 more runs",
    ]);
  });
  test("floor block text", () => {
    const r = tuneReport(view({ floorBlocks: [{ band: "long", value: 80, remaining: 350 }] }));
    expect(r).toContain("block turnFloor.long: 80 held back for 350 more runs");
  });
  test("floor pending shown while the config is invalid", () => {
    const lines = tuneReport(
      view({ configValid: false, floorPending: [{ band: "long", from: 100, to: 80, since: 0 }] }),
    ).split("\n");
    expect(lines.slice(2, 5)).toEqual([
      "turnFloor: medium 40 · long 100 · very_long 200",
      "tuning paused: config error",
      "pending turnFloor.long: 100→80, 0/200 runs since",
    ]);
  });
  test("floor history line names the parameter", () => {
    const h: HistoryEntry = {
      at: Date.UTC(2026, 10, 30, 9),
      parameter: "turnFloor.long",
      from: 100,
      to: 80,
      cause: "rule",
    };
    expect(tuneReport(view({ history: [h] })).split("\n")).toContain(
      "  2026-11-30T09:00Z rule turnFloor.long 100→80",
    );
  });
  test("turn signals", () => {
    const turnSignals: TuneView["turnSignals"] = [
      { band: "medium", runs: 0 },
      {
        band: "long",
        runs: 200,
        p90: 50,
        p95: 60,
        exhausted: 4,
        warned: 9,
        usedOverFloor: 0.62,
        suggested: 80,
      },
      { band: "very_long", runs: 120, p90: 150, p95: 170, exhausted: 0, warned: 1 },
    ];
    const lines = tuneReport(view({ turnSignals })).split("\n");
    expect(lines.slice(-4)).toEqual([
      "turn signals (observed; latest 200 runs per band):",
      "  medium: no runs yet",
      "  long: runs 200 · p90 50 · p95 60 · exhausted 4 · warned 9 · used/floor 0.62 · suggest 80",
      "  very_long: runs 120 · p90 150 · p95 170 · exhausted 0 · warned 1 · used/floor - · needs 200 runs",
    ]);
  });
  test("used/floor has two decimals", () => {
    const turnSignals: TuneView["turnSignals"] = [
      { band: "long", runs: 3, p90: 5, p95: 5, exhausted: 0, warned: 0, usedOverFloor: 1 / 3 },
    ];
    expect(tuneReport(view({ turnSignals }))).toContain("used/floor 0.33 · needs 200 runs");
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
  test("config error follows the turnFloor line", () => {
    const lines = tuneReport(view({ configValid: false })).split("\n");
    expect(lines[3]).toBe("tuning paused: config error");
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
        turnSignals: "ledger-unreadable",
        pending: { from: 1500, to: 1700, since: 3 },
        block: { value: 1700, remaining: 5 },
        floorPending: [{ band: "long", from: 100, to: 80, since: 3 }],
        floorBlocks: [{ band: "long", value: 80, remaining: 5 }],
        problems: ["  tuning (malformed) (file): m"],
      }),
    );
    const lines = r.split("\n");
    expect(r).not.toMatch(/pending|block|signals/);
    expect(lines.indexOf("ledger unreadable")).toBeLessThan(lines.indexOf("history: none"));
    expect(lines.slice(-2)).toEqual(["problems:", "  tuning (malformed) (file): m"]);
  });
});
