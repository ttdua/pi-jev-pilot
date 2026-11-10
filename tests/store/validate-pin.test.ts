import { describe, expect, test } from "bun:test";
import {
  array,
  boolean,
  integer,
  object,
  oneOf,
  refine,
  string,
  type Issue,
} from "../../src/store/validate.ts";

const run = <T>(v: (x: unknown, p: string, i: Issue[]) => T | undefined, x: unknown, p = "") => {
  const issues: Issue[] = [];
  return { out: v(x, p, issues), issues };
};

describe("object pin", () => {
  const shape = { a: integer({ min: 0, max: 9 }), b: string({}), c: boolean() };

  test("non-objects fail at the given path", () => {
    for (const x of [null, undefined, 1, "s", [], [{}]])
      expect(run(object(shape), x, "root")).toEqual({
        out: undefined,
        issues: [{ path: "root", message: "expected an object" }],
      });
  });

  test("output keys follow shape order and omit absent optionals", () => {
    const { out, issues } = run(object(shape), { c: true, a: 1 });
    expect(issues).toEqual([]);
    expect(Object.keys(out!)).toEqual(["a", "c"]);
  });

  test("unknown keys come first in input order, then required, then field issues in shape order", () => {
    const v = object(shape, { required: ["a", "b"] });
    const { out, issues } = run(v, { z: 1, c: "no", y: 2 }, "p");
    expect(out).toBeUndefined();
    expect(issues).toEqual([
      { path: "p.z", message: "unknown key" },
      { path: "p.y", message: "unknown key" },
      { path: "p.a", message: "required" },
      { path: "p.b", message: "required" },
      { path: "p.c", message: "expected true or false" },
    ]);
  });

  test("unknown keys alone make the object fail but fields are still checked", () => {
    const { out, issues } = run(object(shape), { a: 99, extra: 1 });
    expect(out).toBeUndefined();
    expect(issues.map((i) => i.path)).toEqual(["extra", "a"]);
  });

  test("a key named like an Object.prototype member is unknown, not inherited", () => {
    const { issues } = run(object(shape), JSON.parse('{"toString":1,"__proto__":2}'));
    expect(issues).toEqual([
      { path: "toString", message: "unknown key" },
      { path: "__proto__", message: "unknown key" },
    ]);
  });

  test("a present key whose validator returns undefined without an issue is dropped", () => {
    const quiet = object({ q: () => undefined });
    expect(run(quiet, { q: 1 })).toEqual({ out: {}, issues: [] });
  });

  test("issues recorded before the object began do not fail it", () => {
    const issues: Issue[] = [{ path: "earlier", message: "x" }];
    expect(object(shape)({ a: 1 }, "", issues)).toEqual({ a: 1 });
    expect(issues).toHaveLength(1);
  });
});

describe("array pin", () => {
  const item = integer({ min: 0, max: 9 });

  test("non-array fails", () => {
    expect(run(array(item), {}, "xs")).toEqual({
      out: undefined,
      issues: [{ path: "xs", message: "expected an array" }],
    });
  });

  test("max reports first, then per-item issues with indexed paths", () => {
    const { out, issues } = run(array(item, { max: 2 }), [1, 20, 3], "xs");
    expect(out).toBeUndefined();
    expect(issues).toEqual([
      { path: "xs", message: "expected at most 2 items" },
      { path: "xs[1]", message: "expected an integer from 0 to 9" },
    ]);
  });

  test("an item failure voids the whole array, valid items notwithstanding", () => {
    expect(run(array(item), [1, "x", 2]).out).toBeUndefined();
  });

  test("uniqueBy reports each later duplicate and still accepts nothing", () => {
    const v = array(item, { uniqueBy: (n) => String(n % 5) });
    const { out, issues } = run(v, [1, 6, 2, 7, 1], "u");
    expect(out).toBeUndefined();
    expect(issues).toEqual([
      { path: "u[1]", message: "expected a unique entry" },
      { path: "u[3]", message: "expected a unique entry" },
      { path: "u[4]", message: "expected a unique entry" },
    ]);
  });

  test("empty array and valid unique array pass through", () => {
    expect(run(array(item), []).out).toEqual([]);
    expect(run(array(item, { uniqueBy: String }), [3, 1, 2]).out).toEqual([3, 1, 2]);
  });

  test("an item that fails is not entered into the uniqueness set", () => {
    const v = array(oneOf(["a", "b"] as const), { uniqueBy: (s) => s });
    expect(run(v, ["a", "z", "b"]).issues).toEqual([
      { path: "[1]", message: "expected one of: a, b" },
    ]);
  });
});

describe("refine pin", () => {
  const even = refine(integer({ min: 0, max: 9 }), (n) => n % 2 === 0, "expected an even number");

  test("passes accepted values", () => expect(run(even, 4)).toEqual({ out: 4, issues: [] }));

  test("inner failure reports only the inner issue", () => {
    expect(run(even, "x", "n")).toEqual({
      out: undefined,
      issues: [{ path: "n", message: "expected an integer from 0 to 9" }],
    });
  });

  test("predicate failure reports the refine message", () => {
    expect(run(even, 3, "n")).toEqual({
      out: undefined,
      issues: [{ path: "n", message: "expected an even number" }],
    });
  });

  test("the predicate is not called when the inner validator failed", () => {
    let called = 0;
    const v = refine(string({}), () => (called++, true), "m");
    run(v, 1);
    expect(called).toBe(0);
  });
});
