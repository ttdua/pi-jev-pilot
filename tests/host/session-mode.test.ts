import { describe, expect, test } from "bun:test";
import { createSessionModeHolder } from "../../src/host/session-mode.ts";

const entry = (mode: string) => ({ type: "custom", customType: "jev-mode", data: { mode } });

describe("SessionModeHolder", () => {
  test("rebuild then modeFor returns the branch mode for that id and for undefined", () => {
    const h = createSessionModeHolder();
    h.rebuild("A", [entry("premium")]);
    expect(h.modeFor("A")).toBe("premium");
    expect(h.modeFor(undefined)).toBe("premium");
  });

  test("Worker in a new session starts without the old mode", () => {
    const h = createSessionModeHolder();
    h.rebuild("A", [entry("premium")]);
    h.rebuild("B", []);
    expect(h.modeFor("A")).toBeUndefined();
    expect(h.modeFor(undefined)).toBeUndefined();
  });

  test("set for another session id is ignored", () => {
    const h = createSessionModeHolder();
    h.rebuild("A", [entry("budget")]);
    h.set("B", "premium");
    expect(h.modeFor("A")).toBe("budget");
    h.set("A", undefined);
    expect(h.modeFor("A")).toBeUndefined();
  });
});
