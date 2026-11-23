import { describe, expect, test } from "bun:test";
import {
  BUILTIN_FLOORS,
  FLOOR_BANDS,
  FLOOR_PARAMETER,
  FLOOR_RANGES,
} from "../../src/shared/turn-floors.ts";

describe("turn floors", () => {
  test("Built-in values", () => {
    expect(BUILTIN_FLOORS).toEqual({ medium: 40, long: 100, very_long: 200 });
  });

  test("Each built-in floor lies within its range", () => {
    for (const band of FLOOR_BANDS) {
      expect(BUILTIN_FLOORS[band]).toBeGreaterThanOrEqual(FLOOR_RANGES[band].min);
      expect(BUILTIN_FLOORS[band]).toBeLessThanOrEqual(FLOOR_RANGES[band].max);
    }
  });

  test("Parameter name", () => {
    expect(FLOOR_PARAMETER("long")).toBe("turnFloor.long");
  });
});
