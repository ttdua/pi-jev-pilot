import { describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { alignRight, drawStatus, statusText } from "../../src/host/status.ts";
import { buildSnapshot } from "../../src/host/readiness.ts";
import type { Config, ConfigRead } from "../../src/store/config.ts";
import { DECISION_FEATURES } from "../../src/store/defaults.ts";
import type { State, StateRead } from "../../src/store/state-file.ts";

type Over = {
  config?: ConfigRead;
  state?: State;
  stateRead?: StateRead;
  env?: Record<string, string | undefined>;
  tools?: string[];
};

function snap(o: Over = {}) {
  return buildSnapshot({
    configRead: o.config ?? { kind: "ok", present: true, config: {} as Config },
    stateRead: o.stateRead ?? { kind: "ok", state: o.state ?? {} },
    env: o.env ?? { TYPESAFE_API_KEY: "k" },
    toolNames: o.tools ?? ["subagent"],
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
