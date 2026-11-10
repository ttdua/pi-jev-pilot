import { describe, expect, test } from "bun:test";
import { parseJevArgs } from "../../../src/host/commands/args.ts";

describe("parseJevArgs per sub-command", () => {
  test("a slot form wins over the plain forms", () => {
    expect(parseJevArgs("reviewer a/b when x")).toEqual({
      kind: "slot",
      args: { kind: "set", name: "reviewer", model: "a/b", when: "x" },
    });
  });
  test("a malformed slot form is usage", () => {
    expect(parseJevArgs("remove")).toEqual({ kind: "usage" });
  });
  test("a one-word reserved name that is not reset is usage", () => {
    expect(parseJevArgs("skills")).toEqual({ kind: "usage" });
    expect(parseJevArgs("all")).toEqual({ kind: "usage" });
  });
  test("extra words after on/off are usage", () => {
    expect(parseJevArgs("skills on now")).toEqual({ kind: "usage" });
    expect(parseJevArgs("all off now")).toEqual({ kind: "usage" });
  });
  test("an unknown head with on/off is a slot-name candidate, not a feature", () => {
    expect(parseJevArgs("Skills on")).toEqual({ kind: "usage" });
  });
});
