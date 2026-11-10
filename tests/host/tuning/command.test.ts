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
import { fakeCtx, fakeDeps, quiet, type FakeOptions } from "../tuning-fakes.ts";

const rule = { at: 500, parameter: "timeoutMs", from: 1500, to: 1700, cause: "rule" } as const;
const tuned: TuningDocument = { timeoutMs: { value: 1700, base: 1500 }, history: [rule] };
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
    const v = view({ record: { block: { value: 1700, at: 1000 } }, ledger: quiet(50, 1001) });
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
    const v = view({ ledger: [{ v: 1, at: 1, kind: "main", mode: "standard" } as never] });
    expect(Array.isArray(v.signals) && v.signals.map((s) => s.mode)).toEqual(["standard"]);
  });
});

describe("runTune", () => {
  test("undo a change", () => {
    const deps = fakeDeps({ record: tuned });
    const out = runTune(deps, "undo", fakeCtx(true));
    const s = deps.stored();
    expect(out).toEqual({ ok: true, message: undoneMessage(1700, 1500) });
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
    expect(runTune(deps, "undo", fakeCtx(true))).toEqual({ ok: true, message: NOTHING_TO_UNDO });
    expect(deps.updates()).toBe(0);
  });
  test("stale tuned value", () => {
    const deps = fakeDeps({ record: tuned, configTimeoutMs: 2000 });
    expect(runTune(deps, "undo", fakeCtx(true)).message).toBe(NOTHING_TO_UNDO);
    expect(deps.updates()).toBe(0);
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
    expect(s.history?.at(-1)).toMatchObject({ cause: "reset", from: 1900, to: 1500 });
    expect(out).toEqual({ ok: true, message: resetMessage(1500) });
  });
  test("reset with nothing tuned", () => {
    const deps = fakeDeps();
    expect(runTune(deps, "reset", fakeCtx(true)).message).toBe(resetMessage(1500));
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
    const update = { ok: false as const, issues: [{ path: "", message: "refused" }] };
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
        return fakeDeps({ tuningKind: read.kind, record: read.record, tuningIssues }).load();
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
