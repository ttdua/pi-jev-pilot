import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTuneView, runTune } from "../../../src/host/tuning/command.ts";
import type { TuningDeps } from "../../../src/host/tuning/deps.ts";
import {
  NOTHING_TO_UNDO,
  OFF_MESSAGE,
  ON_MESSAGE,
  resetMessage,
  undoneMessage,
} from "../../../src/policy/tuning/text.ts";
import { readLedger } from "../../../src/store/ledger.ts";
import { readTuning, updateTuning, type TuningDocument } from "../../../src/store/tuning-file.ts";
import { fakeCtx, fakeDeps, quiet, workerRuns, type FakeOptions } from "../tuning-fakes.ts";

const rule = {
  at: 500,
  parameter: "timeoutMs",
  from: 1500,
  to: 1700,
  cause: "rule",
} as const;
const tuned: TuningDocument = {
  timeoutMs: { value: 1700, base: 1500 },
  history: [rule],
};
const view = (o: FakeOptions = {}) => {
  const d = fakeDeps(o);
  return buildTuneView(d.load(), d.readLedger(d.dir));
};
const pending = {
  from: 1500,
  to: 1700,
  at: 1000,
  before: { asked: 20, timeouts: 5 },
};

describe("buildTuneView", () => {
  test("not tuned", () => {
    const v = view();
    expect(v.effective).toBe(1500);
    expect(v.tunedFrom).toBeUndefined();
    expect(v.history).toEqual([]);
    expect(v.signals).toEqual([]);
  });
  test("pending change", () => {
    const v = view({ record: { pending }, ledger: quiet(12, 1001) });
    expect(v.pending).toEqual({ from: 1500, to: 1700, since: 12 });
  });
  test("pending count capped", () => {
    const v = view({ record: { pending, off: true }, ledger: quiet(55, 1001) });
    expect(v.pending?.since).toBe(40);
  });
  test("active block", () => {
    const v = view({
      record: { block: { value: 1700, at: 1000 } },
      ledger: quiet(50, 1001),
    });
    expect(v.block).toEqual({ value: 1700, remaining: 150 });
  });
  test("config edited", () => {
    const v = view({ record: tuned, configTimeoutMs: 2000 });
    expect(v.effective).toBe(2000);
    expect(v.tunedFrom).toBeUndefined();
  });
  test("tuned value shows its origin", () => {
    const v = view({ record: tuned });
    expect(v.effective).toBe(1700);
    expect(v.tunedFrom).toBe(1500);
  });
  test("off shown", () => {
    expect(view({ record: { off: true } }).off).toBe(true);
  });
  test("invalid config in the report", () => {
    expect(view({ configValid: false }).configValid).toBe(false);
  });
  test("unreadable ledger", () => {
    const ledger = { kind: "unreadable" as const, issues: [] };
    expect(view({ ledger }).signals).toBe("ledger-unreadable");
  });
  test("malformed tuning file", () => {
    const v = view({ tuningKind: "malformed" });
    expect(v.problems).toHaveLength(1);
    expect(v.problems[0]).toContain("tuning (malformed)");
  });
  test("unreadable tuning file in the report", () => {
    const tuningIssues = [{ path: "", message: "cannot read tuning.json (EACCES)" }];
    const v = view({ tuningKind: "unreadable", tuningIssues });
    expect(v.problems.some((p) => p.includes("EACCES"))).toBe(true);
  });
  test("signals shown", () => {
    const v = view({
      ledger: [{ v: 1, at: 1, kind: "main", mode: "standard" } as never],
    });
    expect(Array.isArray(v.signals) && v.signals.map((s) => s.mode)).toEqual(["standard"]);
  });
});

const BUILTIN_LINE = "turnFloor: medium 40 · long 100 · very_long 200";
const RESET_LINE = "Jev tune: back to your settings (timeoutMs 1500, turn floors 40/100/200).";
const floorRule = {
  at: 500,
  parameter: "turnFloor.long",
  from: 100,
  to: 80,
  cause: "rule",
} as const;
const floorPending = {
  from: 100,
  to: 80,
  at: 1000,
  before: { runs: 200, exhausted: 2 },
};
const floorTuned: TuningDocument = {
  turnFloors: {
    long: {
      changedAt: 1000,
      tuned: { value: 80, base: 100 },
      pending: floorPending,
    },
  },
  history: [{ ...floorRule, at: 1000 }],
};
const lines = (o: FakeOptions = {}): string[] =>
  runTune(fakeDeps(o), "report", fakeCtx(true)).message.split("\n");

/** 200 `long` runs: p90 50, p95 60, 4 exhausted, 9 warned, one run with used/floor 0.62. */
function longSignalRuns() {
  const used = (i: number): number => (i < 180 ? 50 : i < 190 ? 60 : 62);
  return workerRuns(200, { band: "long", used }).map((r, i) => ({
    ...r,
    ...(i >= 196
      ? { turnPhase: "exhausted" as const }
      : i < 9
        ? { turnPhase: "warned" as const }
        : {}),
    ...(i === 195 ? { turnFloor: 100 } : {}),
  }));
}

describe("tune report floors", () => {
  test("not tuned", () => {
    expect(lines()).toEqual([
      "tuning: on",
      "timeoutMs: 1500 (not tuned)",
      BUILTIN_LINE,
      "history: none",
      "signals: no decisions yet",
      "turn signals (observed; latest 200 runs per band):",
      "  medium: no runs yet",
      "  long: no runs yet",
      "  very_long: no runs yet",
    ]);
  });
  test("floor tuned and pending", () => {
    const out = lines({
      record: floorTuned,
      ledger: workerRuns(37, { band: "long", used: 30, from: 1001 }),
    });
    expect(out).toContain("turnFloor: medium 40 · long 80 (tuned from 100) · very_long 200");
    expect(out).toContain("pending turnFloor.long: 100→80, 37/200 runs since");
  });
  test("floor pending count capped", () => {
    const out = lines({
      record: floorTuned,
      ledger: workerRuns(230, { band: "long", used: 30, from: 1001 }),
    });
    expect(out).toContain("pending turnFloor.long: 100→80, 200/200 runs since");
  });
  test("floor block", () => {
    const record: TuningDocument = {
      turnFloors: { long: { changedAt: 1000, block: { value: 80, at: 1000 } } },
    };
    const out = lines({
      record,
      ledger: workerRuns(50, { band: "long", used: 30, from: 1001 }),
    });
    expect(out).toContain("block turnFloor.long: 80 held back for 350 more runs");
    expect(out).toContain(BUILTIN_LINE);
  });
  test("floor block ended", () => {
    const record: TuningDocument = {
      turnFloors: { long: { changedAt: 1000, block: { value: 80, at: 1000 } } },
    };
    const out = lines({
      record,
      ledger: workerRuns(400, { band: "long", used: 30, from: 1001 }),
    });
    expect(out.some((l) => l.startsWith("block turnFloor"))).toBe(false);
  });
  test("turn signals shown", () => {
    const out = lines({ ledger: longSignalRuns() });
    expect(out).toContain(
      "  long: runs 200 · p90 50 · p95 60 · exhausted 4 · warned 9 · used/floor 0.62 · suggest 80",
    );
    expect(out).toContain("  medium: no runs yet");
    expect(out).toContain("  very_long: no runs yet");
  });
  test("turn signals use the effective floors", () => {
    const record: TuningDocument = {
      turnFloors: { long: { changedAt: 1, tuned: { value: 90, base: 100 } } },
    };
    const out = lines({ record, ledger: longSignalRuns() });
    // From 90: down is min(80, ceil10(67.5) = 70) = 70; wanted 80 sits between, so 80.
    expect(out.find((l) => l.startsWith("  long:"))).toEndWith("suggest 80");
  });
  test("not enough runs", () => {
    const out = lines({ ledger: workerRuns(120, { band: "long", used: 30 }) });
    expect(out.find((l) => l.startsWith("  long:"))).toEndWith("used/floor - · needs 200 runs");
  });
  test("floor entry named", () => {
    const at = Date.UTC(2026, 10, 30, 9);
    const out = lines({ record: { history: [{ ...floorRule, at }] } });
    expect(out).toContain("  2026-11-30T09:00Z rule turnFloor.long 100→80");
  });
  test("invalid config in the report", () => {
    const record: TuningDocument = {
      ...floorTuned,
      timeoutMs: { value: 1700, base: 1500 },
    };
    const out = lines({ record, configValid: false });
    expect(out).toContain("timeoutMs: 1500 (not tuned)");
    expect(out).toContain(BUILTIN_LINE);
    expect(out).toContain("tuning paused: config error");
    expect(out).toContain("pending turnFloor.long: 100→80, 0/200 runs since");
  });
  test("malformed tuning file", () => {
    const out = lines({ tuningKind: "malformed" });
    expect(out).toContain("timeoutMs: 1500 (not tuned)");
    expect(out).toContain(BUILTIN_LINE);
    expect(out).toContain("problems:");
  });
  test("floors out of order show built-in, not tuned", () => {
    const record: TuningDocument = {
      turnFloors: {
        medium: { changedAt: 1, tuned: { value: 80, base: 40 } },
        long: { changedAt: 1, tuned: { value: 60, base: 100 } },
      },
    };
    expect(lines({ record })).toContain(BUILTIN_LINE);
  });
  test("stale floor base shows not tuned", () => {
    const record: TuningDocument = {
      turnFloors: { long: { changedAt: 1, tuned: { value: 100, base: 120 } } },
    };
    expect(lines({ record })).toContain(BUILTIN_LINE);
  });
  test("unreadable ledger hides floor state and turn signals", () => {
    const ledger = { kind: "unreadable" as const, issues: [] };
    const out = lines({ record: floorTuned, ledger });
    expect(out).toContain("ledger unreadable");
    expect(out.some((l) => l.includes("turn signals") || l.startsWith("pending"))).toBe(false);
  });
});

describe("runTune", () => {
  test("undo a change", () => {
    const deps = fakeDeps({ record: tuned });
    const out = runTune(deps, "undo", fakeCtx(true));
    const s = deps.stored();
    expect(out).toEqual({
      ok: true,
      message: undoneMessage("timeoutMs", 1700, 1500),
    });
    expect(s.timeoutMs).toBeUndefined();
    expect(s.block).toEqual({ value: 1700, at: 5000 });
    expect(s.history?.at(-1)?.cause).toBe("undo");
    expect(s.seenAt).toBe(5000);
  });
  test("undo without a UI", () => {
    const deps = fakeDeps({ record: tuned });
    runTune(deps, "undo", fakeCtx(false));
    expect(deps.stored().seenAt).toBeUndefined();
  });
  test("nothing to undo", () => {
    const deps = fakeDeps();
    expect(runTune(deps, "undo", fakeCtx(true))).toEqual({
      ok: true,
      message: NOTHING_TO_UNDO,
    });
    expect(deps.updates()).toBe(0);
  });
  test("stale tuned value", () => {
    const deps = fakeDeps({ record: tuned, configTimeoutMs: 2000 });
    expect(runTune(deps, "undo", fakeCtx(true)).message).toBe(NOTHING_TO_UNDO);
    expect(deps.updates()).toBe(0);
  });
  test("undo a floor change", () => {
    const record: TuningDocument = {
      turnFloors: { long: { changedAt: 500, tuned: { value: 80, base: 100 } } },
      history: [floorRule],
    };
    const deps = fakeDeps({ record });
    const out = runTune(deps, "undo", fakeCtx(true));
    expect(out).toEqual({
      ok: true,
      message:
        "Jev tune: turnFloor.long 80→100 undone. The same change is held back for 400 long runs.",
    });
    const long = deps.stored().turnFloors?.long;
    expect(long?.tuned).toBeUndefined();
    expect(long?.block).toEqual({ value: 80, at: 5000 });
    expect(deps.stored().seenAt).toBe(5000);
  });
  test("stale timeout skipped, floor undone", () => {
    const record: TuningDocument = {
      timeoutMs: { value: 1700, base: 1500 },
      turnFloors: { long: { changedAt: 400, tuned: { value: 80, base: 100 } } },
      history: [floorRule, { ...rule, at: 600 }],
    };
    const deps = fakeDeps({ record, configTimeoutMs: 2000 });
    expect(runTune(deps, "undo", fakeCtx(true)).message).toStartWith(
      "Jev tune: turnFloor.long 80→100 undone.",
    );
    expect(deps.stored().timeoutMs).toEqual({ value: 1700, base: 1500 });
  });
  test("floors out of order: nothing to undo", () => {
    const record: TuningDocument = {
      turnFloors: {
        medium: { changedAt: 1, tuned: { value: 80, base: 40 } },
        long: { changedAt: 1, tuned: { value: 60, base: 100 } },
      },
    };
    const deps = fakeDeps({ record });
    expect(runTune(deps, "undo", fakeCtx(true)).message).toBe(NOTHING_TO_UNDO);
    expect(deps.updates()).toBe(0);
  });
  test("reset only a floor block", () => {
    const record: TuningDocument = {
      turnFloors: { long: { changedAt: 1000, block: { value: 80, at: 1000 } } },
    };
    const deps = fakeDeps({ record });
    expect(runTune(deps, "reset", fakeCtx(false)).message).toBe(RESET_LINE);
    expect(deps.updates()).toBe(1);
    expect(deps.stored().turnFloors).toBeUndefined();
    expect(deps.stored().history).toBeUndefined();
  });
  test("reset a tuned floor", () => {
    const deps = fakeDeps({ record: floorTuned });
    runTune(deps, "reset", fakeCtx(true));
    expect(deps.stored().turnFloors).toBeUndefined();
    expect(deps.stored().history?.at(-1)).toMatchObject({
      parameter: "turnFloor.long",
      cause: "reset",
      from: 80,
      to: 100,
    });
  });
  test("reset after changes", () => {
    const record: TuningDocument = {
      timeoutMs: { value: 1900, base: 1500 },
      pending,
      block: { value: 2100, at: 10 },
      off: true,
    };
    const deps = fakeDeps({ record });
    const out = runTune(deps, "reset", fakeCtx(true));
    const s = deps.stored();
    expect(s.timeoutMs).toBeUndefined();
    expect(s.pending).toBeUndefined();
    expect(s.block).toBeUndefined();
    expect(s.off).toBe(true);
    expect(s.history?.at(-1)).toMatchObject({
      cause: "reset",
      from: 1900,
      to: 1500,
    });
    expect(out).toEqual({ ok: true, message: RESET_LINE });
    expect(resetMessage(1500)).toBe(RESET_LINE);
  });
  test("reset with nothing tuned", () => {
    const deps = fakeDeps();
    expect(runTune(deps, "reset", fakeCtx(true)).message).toBe(RESET_LINE);
    expect(deps.updates()).toBe(0);
  });
  test("invalid config", () => {
    const deps = fakeDeps({ configValid: false, record: tuned });
    for (const sub of ["reset", "undo"] as const) {
      const out = runTune(deps, sub, fakeCtx(true));
      expect(out.ok).toBe(false);
      expect(out.message).toContain("classifier.timeoutMs: bad config");
    }
    expect(deps.updates()).toBe(0);
  });
  test("off keeps the tuned value", () => {
    const deps = fakeDeps({ record: tuned });
    const out = runTune(deps, "off", fakeCtx(true));
    expect(out).toEqual({ ok: true, message: OFF_MESSAGE });
    expect(deps.stored()).toEqual({ ...tuned, off: true });
  });
  test("on again", () => {
    const deps = fakeDeps({ record: { off: true } });
    const out = runTune(deps, "on", fakeCtx(true));
    expect(out).toEqual({ ok: true, message: ON_MESSAGE });
    expect(deps.stored().off).toBe(false);
  });
  test("refused write", () => {
    const update = {
      ok: false as const,
      issues: [{ path: "", message: "refused" }],
    };
    const out = runTune(fakeDeps({ update, record: tuned }), "undo", fakeCtx(true));
    expect(out).toEqual({ ok: false, message: "(file): refused" });
  });
  test("never throws", () => {
    const deps = {
      ...fakeDeps(),
      load: () => {
        throw new Error("boom");
      },
    };
    expect(runTune(deps, "report", fakeCtx(true)).ok).toBe(false);
  });
  test("a thrown error's message stays out of the outcome", () => {
    const deps = {
      ...fakeDeps(),
      load: () => {
        throw new Error("ENOENT /secret/path");
      },
    };
    const out = runTune(deps, "report", fakeCtx(true));
    expect(out.ok).toBe(false);
    expect(out.message).not.toContain("/secret/path");
    expect(out.message).toContain("Error");
  });
  test("report", () => {
    const out = runTune(fakeDeps({ record: tuned }), "report", fakeCtx(true));
    expect(out.ok).toBe(true);
    expect(out.message).toContain("timeoutMs: 1700 (tuned from 1500)");
  });
});

describe("runTune with a real store", () => {
  let dir: string;
  const real = (): TuningDeps => {
    const base = fakeDeps();
    return {
      ...base,
      dir,
      load: () => {
        const read = readTuning(dir);
        const tuningIssues = "issues" in read ? read.issues : [];
        return fakeDeps({
          tuningKind: read.kind,
          record: read.record,
          tuningIssues,
        }).load();
      },
      updateTuning,
      readLedger,
    };
  };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tune-"));
  });
  afterEach(() => {
    try {
      chmodSync(join(dir, "tuning.json"), 0o600);
    } catch {
      // file may not exist
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test.skipIf(process.getuid?.() === 0)("unreadable tuning file", () => {
    writeFileSync(join(dir, "tuning.json"), '{"version":1}');
    chmodSync(join(dir, "tuning.json"), 0o000);
    const out = runTune(real(), "off", fakeCtx(true));
    expect(out.ok).toBe(false);
    expect(out.message).toContain("EACCES");
    expect(existsSync(join(dir, "tuning.json.bad"))).toBe(false);
  });
  test("malformed tuning file in the report", () => {
    writeFileSync(join(dir, "tuning.json"), '{"version":1,"timeo');
    const out = runTune(real(), "report", fakeCtx(true));
    expect(out.message).toContain("timeoutMs: 1500 (not tuned)");
    expect(out.message).toContain(BUILTIN_LINE);
    expect(out.message).toContain("problems:");
    expect(readFileSync(join(dir, "tuning.json"), "utf8")).toBe('{"version":1,"timeo');
  });
  test("malformed file recovered by a change", () => {
    writeFileSync(join(dir, "tuning.json"), "{");
    const out = runTune(real(), "off", fakeCtx(true));
    expect(out.ok).toBe(true);
    expect(readFileSync(join(dir, "tuning.json.bad"), "utf8")).toBe("{");
    expect(JSON.parse(readFileSync(join(dir, "tuning.json"), "utf8"))).toEqual({
      version: 1,
      off: true,
    });
  });
});
