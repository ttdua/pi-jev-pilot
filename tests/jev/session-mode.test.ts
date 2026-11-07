import { describe, expect, test } from "bun:test";

import type { SessionEntryLike } from "../../src/jev/branch.ts";
import { readSessionMode, SESSION_MODE_TYPE } from "../../src/jev/session-mode.ts";

function modeEntry(data: unknown, customType: string = SESSION_MODE_TYPE): SessionEntryLike {
  return { type: "custom", customType, data };
}

describe("readSessionMode", () => {
  test("Damaged entry skipped", () => {
    expect(readSessionMode([modeEntry({ mode: "budget" }), modeEntry({ mode: "ultra" })])).toBe(
      "budget",
    );
  });

  test("Clear is the newest", () => {
    expect(readSessionMode([modeEntry({ mode: "premium" }), modeEntry({ mode: null })])).toBe(
      undefined,
    );
  });

  test("readSessionMode skips malformed data", () => {
    const entries = [
      modeEntry({ mode: "premium" }),
      modeEntry(null),
      modeEntry("premium"),
      modeEntry({ mode: 1 }),
      modeEntry({}),
    ];
    expect(readSessionMode(entries)).toBe("premium");
  });

  test("no entry", () => {
    expect(readSessionMode([])).toBe(undefined);
  });

  test("other custom types ignored", () => {
    expect(readSessionMode([modeEntry({ mode: "budget" }, "jev-turn")])).toBe(undefined);
  });
});

describe("readSessionMode defensive cases", () => {
  test("the newest of two valid entries wins", () => {
    expect(readSessionMode([modeEntry({ mode: "budget" }), modeEntry({ mode: "premium" })])).toBe(
      "premium",
    );
  });

  test("a non-custom entry carrying the custom type is ignored", () => {
    const entry = { type: "message", customType: "jev-mode", data: { mode: "budget" } };
    expect(readSessionMode([entry])).toBe(undefined);
  });
});
