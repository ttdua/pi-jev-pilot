import { describe, expect, test } from "bun:test";
import type { TuningDeps } from "../../../src/host/tuning/deps.ts";
import { settleTuning } from "../../../src/host/tuning/step.ts";
import type { TuningDocument } from "../../../src/store/tuning-file.ts";
import { fakeCtx, fakeDeps, firing } from "../tuning-fakes.ts";

function traced(base: ReturnType<typeof fakeDeps>, log: string[]): TuningDeps {
  return {
    dir: base.dir,
    now: () => {
      log.push("now");
      return base.now();
    },
    load: () => {
      log.push("load");
      return base.load();
    },
    readLedger: (d) => {
      log.push(`readLedger ${d}`);
      return base.readLedger(d);
    },
    updateTuning: (dir, mutate) => {
      log.push(`updateTuning ${dir}`);
      return base.updateTuning(dir, (stored) => {
        log.push("mutate");
        return mutate(stored);
      });
    },
  };
}

describe("persist through settleTuning", () => {
  test("reads, then writes once on the deps dir, then announces", () => {
    const log: string[] = [];
    const ctx = fakeCtx(true);
    const base = fakeDeps({ ledger: firing() });
    const deps = traced(base, log);
    const notify = ctx.ui.notify.bind(ctx.ui);
    ctx.ui.notify = (m: string, l?: never) => {
      log.push("notify");
      notify(m, l);
    };
    settleTuning(deps, ctx);
    expect(log).toEqual([
      "load",
      "readLedger /fake/jev",
      "now",
      "updateTuning /fake/jev",
      "mutate",
      "notify",
    ]);
  });

  test("the stored record is stepped at the same now, and seenAt is that now", () => {
    const base = fakeDeps({ ledger: firing(), now: 7777 });
    settleTuning(base, fakeCtx(true));
    expect(base.updates()).toBe(1);
    expect(base.stored().seenAt).toBe(7777);
    expect(base.stored().pending).toMatchObject({ at: 7777 });
  });

  test("without UI the same step is stored but not marked seen", () => {
    const base = fakeDeps({ ledger: firing() });
    const ctx = fakeCtx(false);
    settleTuning(base, ctx);
    const stored: TuningDocument = base.stored();
    expect(stored.timeoutMs).toEqual({ value: 1700, base: 1500 });
    expect("seenAt" in stored).toBe(false);
    expect(ctx.notifies).toEqual([]);
  });

  test("a refused write stays silent and calls updateTuning once", () => {
    const ctx = fakeCtx(true);
    const base = fakeDeps({
      ledger: firing(),
      update: { ok: false, issues: [{ path: "", message: "no" }] } as never,
    });
    settleTuning(base, ctx);
    expect(base.updates()).toBe(1);
    expect(ctx.notifies).toEqual([]);
  });

  test("a throwing updateTuning is swallowed", () => {
    const base = fakeDeps({ ledger: firing() });
    const deps: TuningDeps = {
      ...base,
      updateTuning: () => {
        throw new Error("disk");
      },
    };
    const ctx = fakeCtx(true);
    expect(() => settleTuning(deps, ctx)).not.toThrow();
    expect(ctx.notifies).toEqual([]);
  });
});
