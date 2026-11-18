import { afterEach, describe, expect, it, vi } from "vitest";
import { DeprecationWarnings, warnDeprecatedIn } from "#src/config/deprecations";

describe("deprecation warnings are visible", () => {
  afterEach(() => vi.restoreAllMocks());

  it("warnOnce prints one console.warn per key until reset", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const warnings = new DeprecationWarnings();
    warnings.warnOnce("k", "use context: fork | fresh");
    warnings.warnOnce("k", "use context: fork | fresh");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toBe("[pi-subagents] deprecated: use context: fork | fresh");
    warnings.reset();
    warnings.warnOnce("k", "again");
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("warnDeprecatedIn prints once per key within one set", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const seen = new Set<string>();
    warnDeprecatedIn(seen, "a", "x");
    warnDeprecatedIn(seen, "a", "x");
    warnDeprecatedIn(new Set(), "a", "x");
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
