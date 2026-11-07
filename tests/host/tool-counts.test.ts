import { afterEach, describe, expect, test } from "bun:test";
import { TOOL_COUNTS_KEY, putToolCounts, takeToolCounts } from "../../src/host/tool-counts.ts";

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[TOOL_COUNTS_KEY];
});

describe("tool counts", () => {
  test("put/take round trip and take deletes", () => {
    putToolCounts("a", { toolsScored: 3, toolsFlagged: 1 });
    expect(takeToolCounts("a")).toEqual({ toolsScored: 3, toolsFlagged: 1 });
    expect(takeToolCounts("a")).toBeUndefined();
  });

  test("Counts map bounded: 257 puts evict the first", () => {
    for (let i = 0; i < 257; i++) putToolCounts(`id${i}`, { toolsScored: i, toolsFlagged: 0 });
    expect(takeToolCounts("id0")).toBeUndefined();
    expect(takeToolCounts("id1")).toEqual({ toolsScored: 1, toolsFlagged: 0 });
    expect(takeToolCounts("id256")).toEqual({ toolsScored: 256, toolsFlagged: 0 });
  });

  test("only the two integers are stored", () => {
    const input = { toolsScored: 2, toolsFlagged: 1, name: "bash" };
    putToolCounts("a", input);
    const out = takeToolCounts("a");
    expect(out).toEqual({ toolsScored: 2, toolsFlagged: 1 });
    expect(out).not.toBe(input);
  });
});
