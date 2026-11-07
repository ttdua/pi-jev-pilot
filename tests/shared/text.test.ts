import { describe, expect, test } from "bun:test";
import { cutCodePoints, cutLastCodePoints, editDistance } from "../../src/shared/text.ts";

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

describe("editDistance", () => {
  test("classic example", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
  });
  test("empty side", () => {
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance("abc", "")).toBe(3);
  });
  test("emoji counts as one code point", () => {
    expect(editDistance("a😀b", "axb")).toBe(1);
  });
  test("equal strings", () => {
    expect(editDistance("same", "same")).toBe(0);
  });
});
