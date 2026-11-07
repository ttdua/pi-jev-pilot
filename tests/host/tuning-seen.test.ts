import { describe, expect, test } from "bun:test";
import { showUnseenTuning } from "../../src/host/tuning-seen.ts";
import type { TuningDocument } from "../../src/store/tuning-file.ts";
import { fakeCtx, fakeDeps } from "./tuning-fakes.ts";

const entry = (at: number, from: number, to: number) =>
  ({ at, parameter: "timeoutMs", from, to, cause: "rule" }) as const;

describe("showUnseenTuning", () => {
  test("one unseen change", () => {
    const record: TuningDocument = { history: [entry(1000, 1500, 1700)] };
    const deps = fakeDeps({ record });
    const ctx = fakeCtx(true);
    showUnseenTuning(deps, ctx);
    expect(ctx.notifies).toEqual([
      ["Jev tune since your last session: timeoutMs 1500→1700 (1 change) · /jev tune", "info"],
    ]);
    expect(deps.stored().seenAt).toBe(1000);
  });

  test("several unseen changes", () => {
    const record: TuningDocument = {
      seenAt: 1000,
      history: [entry(1000, 1500, 1700), entry(2000, 1700, 1900), entry(3000, 1900, 2100)],
    };
    const deps = fakeDeps({ record });
    const ctx = fakeCtx(true);
    showUnseenTuning(deps, ctx);
    expect(ctx.notifies[0]?.[0]).toContain("1700→2100 (2 changes)");
    expect(deps.stored().seenAt).toBe(3000);
  });

  test("changes that cancel out", () => {
    const record: TuningDocument = { history: [entry(1000, 1500, 1700), entry(2000, 1700, 1500)] };
    const ctx = fakeCtx(true);
    showUnseenTuning(fakeDeps({ record }), ctx);
    expect(ctx.notifies[0]?.[0]).toContain("1500→1500 (2 changes)");
  });

  test("shown once", () => {
    const record: TuningDocument = { history: [entry(1000, 1500, 1700)] };
    const deps = fakeDeps({ record, loadFromStore: true });
    const ctx = fakeCtx(true);
    showUnseenTuning(deps, ctx);
    showUnseenTuning(deps, ctx);
    expect(ctx.notifies).toHaveLength(1);
    expect(deps.updates()).toBe(1);
  });

  test("everything seen", () => {
    const record: TuningDocument = { seenAt: 1000, history: [entry(1000, 1500, 1700)] };
    const deps = fakeDeps({ record });
    const ctx = fakeCtx(true);
    showUnseenTuning(deps, ctx);
    expect(deps.updates()).toBe(0);
    expect(ctx.notifies).toEqual([]);
  });

  test("no UI at start", () => {
    const deps = fakeDeps({ record: { history: [entry(1000, 1500, 1700)] } });
    const ctx = fakeCtx(false);
    showUnseenTuning(deps, ctx);
    expect(deps.updates()).toBe(0);
    expect(ctx.notifies).toEqual([]);
  });

  test("malformed file at start", () => {
    const deps = fakeDeps({ tuningKind: "malformed" });
    const ctx = fakeCtx(true);
    showUnseenTuning(deps, ctx);
    expect(deps.updates()).toBe(0);
    expect(ctx.notifies).toEqual([]);
  });

  test("refused seen write", () => {
    const deps = fakeDeps({
      record: { history: [entry(1000, 1500, 1700)] },
      update: { ok: false, message: "refused" } as never,
    });
    const ctx = fakeCtx(true);
    showUnseenTuning(deps, ctx);
    expect(ctx.notifies).toEqual([]);
  });

  test("a throwing notify is swallowed", () => {
    const deps = fakeDeps({ record: { history: [entry(1000, 1500, 1700)] } });
    expect(() => showUnseenTuning(deps, fakeCtx(true, true))).not.toThrow();
  });
});
