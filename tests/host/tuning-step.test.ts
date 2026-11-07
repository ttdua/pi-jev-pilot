import { chmodSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { buildSnapshot } from "../../src/host/readiness.ts";
import type { TuningDeps } from "../../src/host/tuning-deps.ts";
import { settleTuning } from "../../src/host/tuning-step.ts";
import { appendLedger, readLedger } from "../../src/store/ledger.ts";
import { readTuning, updateTuning, type TuningDocument } from "../../src/store/tuning-file.ts";
import { tempDir } from "../helpers.ts";
import { fakeCtx, fakeDeps, firing, quiet } from "./tuning-fakes.ts";

const isRoot = process.getuid?.() === 0;

const applied: TuningDocument = {
  timeoutMs: { value: 1700, base: 1500 },
  pending: { from: 1500, to: 1700, at: 5000, before: { asked: 40, timeouts: 10 } },
  history: [{ at: 5000, parameter: "timeoutMs", from: 1500, to: 1700, cause: "rule" }],
};
const tuned: TuningDocument = {
  timeoutMs: { value: 1700, base: 1500 },
  pending: { from: 1500, to: 1700, at: 0, before: { asked: 40, timeouts: 1 } },
  history: [{ at: 0, parameter: "timeoutMs", from: 1500, to: 1700, cause: "rule" }],
};
const APPLIED_LINE: [string, string] = ["Jev tune: timeoutMs 1500→1700 · /jev tune undo", "info"];

describe("settleTuning with fakes", () => {
  test("rule fires at settle", () => {
    const deps = fakeDeps({ ledger: firing() });
    settleTuning(deps, fakeCtx(true));
    const s = deps.stored();
    expect(s.timeoutMs).toEqual({ value: 1700, base: 1500 });
    expect(s.pending).toMatchObject({ from: 1500, to: 1700 });
    expect(s.history?.at(-1)?.cause).toBe("rule");
    expect(s.seenAt).toBe(5000);
  });

  test("nothing to change writes nothing", () => {
    const deps = fakeDeps({ ledger: quiet() });
    const ctx = fakeCtx(true);
    settleTuning(deps, ctx);
    expect(deps.updates()).toBe(0);
    expect(ctx.notifies).toEqual([]);
  });

  test("applied line", () => {
    const ctx = fakeCtx(true);
    settleTuning(fakeDeps({ ledger: firing() }), ctx);
    expect(ctx.notifies).toEqual([APPLIED_LINE]);
  });

  test("reverted line", () => {
    const ctx = fakeCtx(true);
    settleTuning(fakeDeps({ record: tuned, ledger: firing() }), ctx);
    expect(ctx.notifies).toEqual([
      ["Jev tune: timeoutMs 1700→1500, reverted: timeouts did not improve · /jev tune", "info"],
    ]);
  });

  test("superseded line", () => {
    const ctx = fakeCtx(true);
    settleTuning(fakeDeps({ record: tuned, configTimeoutMs: 2000, ledger: quiet() }), ctx);
    expect(ctx.notifies).toEqual([
      ["Jev tune: timeoutMs 1700→2000, your config value replaces the tuned one", "info"],
    ]);
  });

  test("kept is silent", () => {
    const deps = fakeDeps({
      record: { ...tuned, pending: { ...tuned.pending!, before: { asked: 40, timeouts: 10 } } },
      ledger: quiet(40, 1),
    });
    const ctx = fakeCtx(true);
    settleTuning(deps, ctx);
    expect(deps.stored().pending).toBeUndefined();
    expect(deps.stored().timeoutMs).toEqual({ value: 1700, base: 1500 });
    expect(ctx.notifies).toEqual([]);
  });

  test("invalid config skips", () => {
    const deps = fakeDeps({
      record: { ...tuned, timeoutMs: { value: 1700, base: 2000 } },
      configValid: false,
      ledger: firing(),
    });
    settleTuning(deps, fakeCtx(true));
    expect(deps.updates()).toBe(0);
  });

  test("unreadable tuning kind skips", () => {
    const deps = fakeDeps({ tuningKind: "unreadable", ledger: firing() });
    settleTuning(deps, fakeCtx(true));
    expect(deps.updates()).toBe(0);
  });

  test("unreadable ledger skips", () => {
    const deps = fakeDeps({ ledger: { kind: "unreadable", issues: [] } });
    settleTuning(deps, fakeCtx(true));
    expect(deps.updates()).toBe(0);
  });

  test("throwing ledger read returns normally", () => {
    const deps = fakeDeps({ ledger: "throw" });
    expect(() => settleTuning(deps, fakeCtx(true))).not.toThrow();
    expect(deps.updates()).toBe(0);
  });

  test("refused write does not notify", () => {
    const ctx = fakeCtx(true);
    const deps = fakeDeps({ ledger: firing(), update: { ok: false, issues: [] } });
    settleTuning(deps, ctx);
    expect(deps.updates()).toBe(1);
    expect(ctx.notifies).toEqual([]);
  });

  test("throwing notify returns normally and the record is stored", () => {
    const deps = fakeDeps({ ledger: firing() });
    expect(() => settleTuning(deps, fakeCtx(true, true))).not.toThrow();
    expect(deps.stored().timeoutMs?.value).toBe(1700);
  });

  test("no UI: no seenAt and no notify", () => {
    const ctx = fakeCtx(false);
    const deps = fakeDeps({ ledger: firing() });
    settleTuning(deps, ctx);
    expect(deps.stored().timeoutMs?.value).toBe(1700);
    expect(deps.stored().seenAt).toBeUndefined();
    expect(ctx.notifies).toEqual([]);
  });

  test("another process changed it first", () => {
    const ctx = fakeCtx(true);
    const deps = fakeDeps({ ledger: firing(), update: () => structuredClone(applied) });
    settleTuning(deps, ctx);
    expect(deps.lastResult()).toEqual(applied);
    expect(ctx.notifies).toEqual([]);
  });

  test("second settle with the same ledger is a no-op", () => {
    const ctx = fakeCtx(true);
    const base = fakeDeps({ ledger: firing() });
    // Feed the stored record back as the next snapshot.
    const deps = {
      ...base,
      load: () => fakeDeps({ record: base.stored(), ledger: firing() }).load(),
    };
    settleTuning(deps, ctx);
    settleTuning(deps, ctx);
    expect(base.stored().history?.filter((h) => h.cause === "rule")).toHaveLength(1);
    expect(ctx.notifies).toEqual([APPLIED_LINE]);
  });
});

function withDir(fn: (dir: string) => void): void {
  const dir = tempDir("jev-settle-");
  try {
    fn(dir);
  } finally {
    for (const f of ["tuning.json", "ledger.jsonl"]) {
      try {
        chmodSync(join(dir, f), 0o600);
      } catch {}
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

function realDeps(dir: string, spy?: () => void): TuningDeps {
  return {
    dir,
    now: () => 5000,
    load: () =>
      buildSnapshot({
        configRead: { kind: "ok", present: false, config: {} },
        stateRead: { kind: "missing", state: {} },
        tuningRead: readTuning(dir),
        env: {},
        toolNames: [],
      }),
    updateTuning,
    readLedger: (d) => {
      spy?.();
      return readLedger(d);
    },
  };
}

function seed(dir: string, lines: ReturnType<typeof firing>): void {
  for (const l of lines) expect(appendLedger(dir, l).ok).toBe(true);
}

describe("settleTuning with real stores", () => {
  test("malformed tuning file is recovered", () => {
    withDir((dir) => {
      writeFileSync(join(dir, "tuning.json"), "{");
      seed(dir, firing());
      settleTuning(realDeps(dir), fakeCtx(true));
      expect(readFileSync(join(dir, "tuning.json.bad"), "utf8")).toBe("{");
      expect((readTuning(dir).record as TuningDocument).timeoutMs).toEqual({
        value: 1700,
        base: 1500,
      });
    });
  });

  test.skipIf(isRoot)("unreadable tuning file is left alone", () => {
    withDir((dir) => {
      const doc = JSON.stringify({ version: 1, timeoutMs: { value: 1700, base: 1500 } });
      const file = join(dir, "tuning.json");
      writeFileSync(file, doc);
      chmodSync(file, 0o000);
      const mode = statSync(file).mode;
      seed(dir, firing());
      const ctx = fakeCtx(true);
      settleTuning(realDeps(dir), ctx);
      expect(statSync(file).mode).toBe(mode);
      chmodSync(file, 0o600);
      expect(readFileSync(file, "utf8")).toBe(doc);
      expect(existsSync(join(dir, "tuning.json.bad"))).toBe(false);
      expect(ctx.notifies).toEqual([]);
    });
  });

  test.skipIf(isRoot)("unreadable ledger writes nothing", () => {
    withDir((dir) => {
      seed(dir, firing());
      chmodSync(join(dir, "ledger.jsonl"), 0o000);
      const ctx = fakeCtx(true);
      settleTuning(realDeps(dir), ctx);
      expect(existsSync(join(dir, "tuning.json"))).toBe(false);
      expect(ctx.notifies).toEqual([]);
    });
  });

  test("a 2000-line ledger is read once and fast", () => {
    withDir((dir) => {
      seed(dir, quiet(2000));
      let reads = 0;
      const started = performance.now();
      settleTuning(
        realDeps(dir, () => reads++),
        fakeCtx(true),
      );
      expect(reads).toBe(1);
      expect(performance.now() - started).toBeLessThan(1000);
    });
  });
});
