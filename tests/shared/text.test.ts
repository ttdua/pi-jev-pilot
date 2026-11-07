import { describe, expect, test } from "bun:test";
import { cutCodePoints, cutLastCodePoints } from "../../src/shared/text.ts";

describe("cutCodePoints", () => {
  test("cuts on code points", () => {
    expect(cutCodePoints("ab😀c", 3)).toBe("ab😀");
  });
  test("returns a short string whole", () => {
    expect(cutCodePoints("abc", 10)).toBe("abc");
  });
});

describe("cutLastCodePoints", () => {
  test("keeps the last code points", () => {
    expect(cutLastCodePoints("a😀b", 2)).toBe("😀b");
  });
  test("returns a short string whole", () => {
    expect(cutLastCodePoints("abc", 10)).toBe("abc");
  });
});
