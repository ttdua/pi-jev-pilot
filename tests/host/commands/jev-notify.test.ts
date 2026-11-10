import { describe, expect, test } from "bun:test";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { notifier } from "../../../src/host/commands/jev-notify.ts";

const ctxOf = (hasUI: boolean, calls: unknown[][]) =>
  ({
    hasUI,
    ui: { notify: (...a: unknown[]) => calls.push(a) },
  }) as unknown as ExtensionCommandContext;

describe("notifier", () => {
  test("forwards text and level when there is a UI", () => {
    const calls: unknown[][] = [];
    notifier(ctxOf(true, calls))("hi", "warning");
    expect(calls).toEqual([["hi", "warning"]]);
  });
  test("does nothing without a UI", () => {
    const calls: unknown[][] = [];
    notifier(ctxOf(false, calls))("hi", "error");
    expect(calls).toEqual([]);
  });
  test("reads hasUI at call time, not when the notifier is made", () => {
    const calls: unknown[][] = [];
    const ctx = ctxOf(false, calls);
    const notify = notifier(ctx);
    (ctx as { hasUI: boolean }).hasUI = true;
    notify("late", "info");
    expect(calls).toEqual([["late", "info"]]);
  });
});
