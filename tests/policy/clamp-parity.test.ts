import { describe, expect, test } from "bun:test";
import {
  clampThinkingLevel,
  getSupportedThinkingLevels,
  type Model,
  type Api,
} from "@earendil-works/pi-ai";
import {
  clampLevel,
  supportedLevels,
  LEVELS,
  type ModelThinking,
} from "../../src/policy/effort.ts";

const SHAPES: ModelThinking[] = [
  { reasoning: false },
  { reasoning: true },
  { reasoning: true, thinkingLevelMap: { xhigh: "x" } },
  { reasoning: true, thinkingLevelMap: { xhigh: "x", max: "m" } },
  { reasoning: true, thinkingLevelMap: { minimal: null, low: null } },
  { reasoning: true, thinkingLevelMap: { off: null } },
];

describe("Parity with Pi", () => {
  for (const shape of SHAPES) {
    const piModel = shape as unknown as Model<Api>;
    test(`supportedLevels ${JSON.stringify(shape)}`, () => {
      expect(supportedLevels(shape)).toEqual(getSupportedThinkingLevels(piModel));
    });
    for (const level of LEVELS) {
      test(`clampLevel ${JSON.stringify(shape)} ${level}`, () => {
        expect(clampLevel(level, supportedLevels(shape))).toEqual(
          clampThinkingLevel(piModel, level),
        );
      });
    }
  }
});
