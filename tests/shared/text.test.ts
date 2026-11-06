import { describe, expect, test } from "bun:test";
import { cutCodePoints } from "../../src/shared/text.ts";

describe("cutCodePoints", () => {
  test("cuts on code points", () => {
    expect(cutCodePoints("ab😀c", 3)).toBe("ab😀");
  });
  test("returns a short string whole", () => {
    expect(cutCodePoints("abc", 10)).toBe("abc");
  });
});
