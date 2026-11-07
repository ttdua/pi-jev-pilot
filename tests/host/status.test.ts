import { describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  alignRight,
  compactTally,
  drawStatus,
  EMPTY_TALLY,
  logLine,
  statusText,
  tallyLines,
  withDecision,
  type Tally,
} from "../../src/host/status.ts";
import { buildSnapshot } from "../../src/host/readiness.ts";
import type { Config, ConfigRead } from "../../src/store/config.ts";
import type { Mode } from "../../src/store/defaults.ts";
import { DECISION_FEATURES } from "../../src/store/defaults.ts";
import type { State, StateRead } from "../../src/store/state-file.ts";

type Over = {
  config?: ConfigRead;
  state?: State;
  stateRead?: StateRead;
  env?: Record<string, string | undefined>;
  tools?: string[];
  sessionMode?: Mode;
};

function snap(o: Over = {}) {
  return buildSnapshot({
    configRead: o.config ?? { kind: "ok", present: true, config: {} as Config },
    stateRead: o.stateRead ?? { kind: "ok", state: o.state ?? {} },
    env: o.env ?? { TYPESAFE_API_KEY: "k" },
    toolNames: o.tools ?? ["subagent"],
    ...(o.sessionMode === undefined
      ? {}
      : { localModeRead: { kind: "ok" as const, mode: o.sessionMode } }),
  });
}

const allOff = (extra: Record<string, boolean> = {}): State => ({
  switches: { ...Object.fromEntries(DECISION_FEATURES.map((f) => [f, false])), ...extra },
});

describe("statusText", () => {
  test("ready default", () => expect(statusText(snap())).toBe("Jev · standard"));
  test("premium", () =>
    expect(statusText(snap({ state: { mode: "premium" } }))).toBe("Jev · premium"));
  test("no key", () => expect(statusText(snap({ env: {} }))).toBe("Jev · no key"));
  test("config error wins", () => {
    const s = snap({
      env: {},
      config: { kind: "invalid", issues: [{ path: "x", message: "bad" }] } as ConfigRead,
    });
    expect(statusText(s)).toBe("Jev · config error");
  });
  test("all off", () => expect(statusText(snap({ state: allOff() }))).toBe("Jev · off"));
  test("only skills off", () =>
    expect(statusText(snap({ state: { switches: { skills: false } } }))).toBe("Jev · standard"));
  test("executor absent", () => expect(statusText(snap({ tools: [] }))).toBe("Jev · standard"));
  test("state malformed", () =>
    expect(
      statusText(
        snap({
          stateRead: {
            kind: "malformed",
            state: {},
            issues: [{ path: "a", message: "b" }],
          } as StateRead,
        }),
      ),
    ).toBe("Jev · standard"));
  test("status and verbose do not count", () => {
    for (const extra of [
      { status: true, verbose: true },
      { status: false, verbose: false },
    ]) {
      expect(statusText(snap({ state: allOff(extra) }))).toBe("Jev · off");
    }
  });
});

describe("alignRight", () => {
  test("pads left", () => {
    const out = alignRight("Jev · standard", 40);
    expect(out.length).toBe(40);
    expect(out.endsWith("Jev · standard")).toBe(true);
  });
  test("narrow truncates", () => expect(alignRight("Jev · standard", 5)).toBe("Jev ·"));
});

type Call = [string, unknown, unknown];
function ctxFor(hasUI: boolean, mode: string) {
  const calls: Call[] = [];
  const ctx = {
    hasUI,
    mode,
    ui: { setWidget: (k: string, c: unknown, o: unknown) => calls.push([k, c, o]) },
  } as unknown as ExtensionContext;
  return { ctx, calls };
}
const OPT = { placement: "aboveEditor" };

describe("drawStatus", () => {
  test("no UI → no calls", () => {
    for (const m of ["tui", "rpc", "print"]) {
      const { ctx, calls } = ctxFor(false, m);
      drawStatus(ctx, snap());
      expect(calls).toEqual([]);
    }
  });
  test("rpc", () => {
    const { ctx, calls } = ctxFor(true, "rpc");
    drawStatus(ctx, snap());
    expect(calls).toEqual([["jev", ["Jev · standard"], OPT]]);
  });
  test("tui render(40)", () => {
    const { ctx, calls } = ctxFor(true, "tui");
    drawStatus(ctx, snap());
    expect(calls[0]![0]).toBe("jev");
    expect(calls[0]![2]).toEqual(OPT);
    const factory = calls[0]![1] as (
      tui: unknown,
      theme: unknown,
    ) => { render(w: number): string[]; invalidate(): void };
    const comp = factory({}, {});
    expect(comp.render(40)).toEqual([alignRight("Jev · standard", 40)]);
    comp.invalidate();
  });
  test("status off clears", () => {
    for (const m of ["tui", "rpc"]) {
      const { ctx, calls } = ctxFor(true, m);
      drawStatus(ctx, snap({ state: { switches: { status: false } } }));
      expect(calls).toEqual([["jev", undefined, OPT]]);
    }
  });
});

describe("session mode marker", () => {
  test("Session mode marked", () =>
    expect(statusText(snap({ state: { mode: "standard" }, sessionMode: "premium" }))).toBe(
      "Jev · premium (session)",
    ));
  test("Session mode with a suffix", () =>
    expect(
      statusText(snap({ sessionMode: "budget" }), {
        effort: { kind: "level", level: "high" },
      }),
    ).toBe("Jev · budget (session) · high"));
  test("Session mode in the tally form", () =>
    expect(
      statusText(
        snap({ sessionMode: "premium" }),
        undefined,
        "10 prompts · 0 workers · 0 fallbacks",
      ),
    ).toBe("Jev · premium (session) · 10 prompts · 0 workers · 0 fallbacks"));
  test("Base state wins over a session mode", () =>
    expect(statusText(snap({ state: allOff(), sessionMode: "premium" }))).toBe("Jev · off"));
});

describe("decision suffix", () => {
  const high = { effort: { kind: "level", level: "high" } } as const;
  const none = { effort: { kind: "no-answer" } } as const;
  const both = { effort: { kind: "level", level: "high" }, advice: "delegate" } as const;
  test("level", () => expect(statusText(snap(), high)).toBe("Jev · standard · high"));
  test("no answer", () => expect(statusText(snap(), none)).toBe("Jev · standard · no answer"));
  test("effort off drops it", () =>
    expect(statusText(snap({ state: { switches: { effort: false } } }), high)).toBe(
      "Jev · standard",
    ));
  test("all off drops it", () =>
    expect(statusText(snap({ state: allOff() }), high)).toBe("Jev · off"));
  test("no key drops it", () => expect(statusText(snap({ env: {} }), high)).toBe("Jev · no key"));
  test("effort and advice", () =>
    expect(statusText(snap(), both)).toBe("Jev · standard · high · delegate"));
  test("advice without effort part", () =>
    expect(
      statusText(snap({ state: { switches: { effort: false } } }), { advice: "parallel" }),
    ).toBe("Jev · standard · parallel"));
  test("strategy off hides advice, on restores it", () => {
    expect(statusText(snap({ state: { switches: { strategy: false } } }), both)).toBe(
      "Jev · standard · high",
    );
    expect(statusText(snap(), both)).toBe("Jev · standard · high · delegate");
  });
  test("config error", () =>
    expect(
      statusText(
        snap({ config: { kind: "invalid", issues: [{ path: "x", message: "bad" }] } }),
        both,
      ),
    ).toBe("Jev · config error"));
  test("withDecision omits undefined keys", () => {
    const lvl = { kind: "level", level: "high" } as const;
    expect(withDecision(undefined, lvl, undefined)).toEqual({ effort: lvl });
    expect("advice" in withDecision(undefined, lvl, undefined)).toBe(false);
    expect("effort" in withDecision(undefined, undefined, "graph")).toBe(false);
    expect(withDecision(undefined, lvl, "graph")).toEqual({ effort: lvl, advice: "graph" });
  });
  test("rpc draw", () => {
    const { ctx, calls } = ctxFor(true, "rpc");
    drawStatus(ctx, snap(), { effort: { kind: "level", level: "xhigh" } });
    expect(calls).toEqual([["jev", ["Jev · standard · xhigh"], OPT]]);
  });
});

const tally = (o: Partial<Tally> = {}): Tally => ({ ...EMPTY_TALLY, ...o });

describe("compactTally", () => {
  test("uses the given prompt count", () =>
    expect(compactTally(tally({ prompts: 9, workers: 2, fallbacks: 1 }), 10)).toBe(
      "10 prompts · 2 workers · 1 fallbacks",
    ));
  test("zeros", () =>
    expect(compactTally(EMPTY_TALLY, 10)).toBe("10 prompts · 0 workers · 0 fallbacks"));
});

describe("tallyLines", () => {
  test("empty tally", () =>
    expect(tallyLines(EMPTY_TALLY)).toEqual([
      "session:",
      "  prompts 0",
      "  workers 0",
      "  worker tokens 0",
      "  fallbacks 0",
    ]));
  test("by model", () => {
    const lines = tallyLines(
      tally({ prompts: 2, workers: 1, byModel: [["fixture/fast", 1]], workerTokens: 120 }),
    );
    expect(lines).toContain("  workers 1 (fixture/fast 1)");
    expect(lines).toContain("  worker tokens 120");
  });
  test("unrouted comes last", () =>
    expect(tallyLines(tally({ workers: 2, byModel: [["fixture/fast", 1]], unrouted: 1 }))[2]).toBe(
      "  workers 2 (fixture/fast 1, unrouted 1)",
    ));
});

const base = { v: 1, at: 1, session: "s1", mode: "standard", answered: true };

describe("logLine", () => {
  test("main line text", () =>
    expect(
      logLine({
        ...base,
        kind: "main",
        turnId: "t1",
        outcome: "ok",
        from: "low",
        effective: "high",
        ms: 512,
        effortP: { low: 0.05, medium: 0.1, high: 0.7, xhigh: 0.1, max: 0.05 },
      }),
    ).toBe(
      "jev · main · low → high · 0.5s · p low 0.05 medium 0.10 high 0.70 xhigh 0.10 max 0.05",
    ));
  test("sparse main line", () =>
    expect(
      logLine({
        ...base,
        answered: false,
        kind: "main",
        turnId: "t1",
        outcome: "ok",
        miss: "error",
        from: "low",
      }),
    ).toBe("jev · main · low → - · miss error"));
  test("main miss text", () =>
    expect(
      logLine({
        ...base,
        answered: false,
        kind: "main",
        turnId: "t1",
        outcome: "ok",
        from: "medium",
        effective: "medium",
        ms: 1500,
        miss: "timeout",
      }),
    ).toBe("jev · main · medium → medium · 1.5s · miss timeout"));
  test("main held", () =>
    expect(logLine({ ...base, kind: "main", turnId: "t1", outcome: "ok", held: true })).toBe(
      "jev · main · - → - · held",
    ));
  const worker = { ...base, kind: "worker", briefChars: 10, status: "completed" };
  test("worker untouched head", () =>
    expect(logLine({ ...worker, agent: "scout", reason: "untouched" })).toBe(
      "jev · scout → untouched · -",
    ));
  test("worker fallback text", () =>
    expect(
      logLine({
        ...worker,
        agent: "general-purpose",
        reason: "choice",
        tier: "balanced",
        fallback: "deep",
        effort: "high",
        ms: 480,
        tierP: { fast: 0.1, balanced: 0.3, deep: 0.6 },
      }),
    ).toBe(
      "jev · general-purpose → balanced · high · 0.5s · p fast 0.10 balanced 0.30 deep 0.60 · fallback deep",
    ));
  test("worker miss text", () =>
    expect(
      logLine({
        ...worker,
        answered: false,
        agent: "scout",
        reason: "miss",
        miss: "timeout",
        ms: 1500,
      }),
    ).toBe("jev · scout → - · - · 1.5s · why miss · miss timeout"));
  test("worker untouched text", () =>
    expect(logLine({ ...worker, agent: "scout", reason: "untouched", status: "aborted" })).toBe(
      "jev · scout → untouched · - · aborted",
    ));
  test("worker locked", () =>
    expect(
      logLine({ ...worker, agent: "scout", reason: "choice", tier: "fast", locked: true }),
    ).toBe("jev · scout → fast · - · locked"));
  test("correction text", () =>
    expect(
      logLine({ v: 1, at: 1, session: "s1", kind: "correction", turnId: "t1", corrects: 0.8 }),
    ).toBe("jev · correction · 0.80"));
  test("logLine rejects invalid data", () => {
    expect(logLine({ kind: "other" })).toBeUndefined();
    expect(logLine(null)).toBeUndefined();
    expect(logLine({ ...base, v: 2, kind: "main", turnId: "t1", outcome: "ok" })).toBeUndefined();
  });
});

describe("overlay", () => {
  const o = "10 prompts · 0 workers · 0 fallbacks";
  const level = { effort: { kind: "level", level: "high" } } as const;
  test("replaces the level suffix", () =>
    expect(statusText(snap(), level, o)).toBe(`Jev · standard · ${o}`));
  test("replaces both suffixes", () =>
    expect(statusText(snap(), { ...level, advice: "delegate" }, o)).toBe(`Jev · standard · ${o}`));
  test("overlay ignored for base states", () => {
    expect(statusText(snap({ state: allOff() }), undefined, o)).toBe("Jev · off");
    expect(statusText(snap({ env: {} }), undefined, o)).toBe("Jev · no key");
  });
  test("shown with effort off", () =>
    expect(statusText(snap({ state: { switches: { effort: false } } }), undefined, o)).toBe(
      `Jev · standard · ${o}`,
    ));
});
