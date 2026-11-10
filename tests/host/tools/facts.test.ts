import { describe, expect, test } from "bun:test";
import { Type } from "typebox";
import { toolFacts } from "../../../src/host/tools/facts.ts";

describe("toolFacts", () => {
  test("maps TypeBox parameters with descriptions only", () => {
    const parameters = Type.Object({
      command: Type.String({ description: "Shell command to execute" }),
      x: Type.Number(),
    });
    const facts = toolFacts({
      name: "bash",
      description: "Run",
      sourceInfo: { source: "builtin" },
      parameters,
    });
    expect(facts).toEqual({
      name: "bash",
      description: "Run",
      source: "builtin",
      parameters: { command: "Shell command to execute" },
    });
  });

  test("missing properties, sourceInfo and description fall back", () => {
    expect(toolFacts({ name: "t", parameters: {} })).toEqual({
      name: "t",
      description: "",
      source: "unknown",
      parameters: {},
    });
    expect(toolFacts({ name: "t", sourceInfo: { source: "" } })?.source).toBe("unknown");
  });

  test("throwing getters fall back per field", () => {
    const info = {
      name: "t",
      get parameters(): never {
        throw new Error("boom");
      },
      get description(): never {
        throw new Error("boom");
      },
      get sourceInfo(): never {
        throw new Error("boom");
      },
    };
    expect(toolFacts(info)).toEqual({
      name: "t",
      description: "",
      source: "unknown",
      parameters: {},
    });
  });

  test("non-object or nameless input yields undefined", () => {
    expect(toolFacts(null)).toBeUndefined();
    expect(toolFacts("x")).toBeUndefined();
    expect(toolFacts({})).toBeUndefined();
    expect(toolFacts({ name: "" })).toBeUndefined();
  });

  test("__proto__ parameter is an own key", () => {
    const properties = JSON.parse('{"__proto__":{"description":"d"}}');
    const facts = toolFacts({ name: "t", parameters: { properties } });
    expect(Object.keys(facts?.parameters ?? {})).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(facts?.parameters)).toBe(Object.prototype);
  });
});
