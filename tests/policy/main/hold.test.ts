import { describe, expect, test } from "bun:test";

import { type HoldAnchor, isHeld } from "../../../src/policy/main/hold.ts";

const anchor: HoldAnchor = { provider: "9router", model: "m1", level: "high" };
const base = { provider: "9router", model: "m1", holdProviders: ["9router"], anchor };

describe("isHeld", () => {
  test("listed provider, same model", () => {
    expect(isHeld(base)).toBe(true);
  });
  test("provider not listed", () => {
    expect(isHeld({ ...base, holdProviders: ["other"] })).toBe(false);
  });
  test("no anchor", () => {
    expect(isHeld({ ...base, anchor: undefined })).toBe(false);
  });
  test("model switched", () => {
    expect(isHeld({ ...base, model: "m2" })).toBe(false);
  });
  test("anchor for another provider", () => {
    expect(isHeld({ ...base, anchor: { ...anchor, provider: "fixture" } })).toBe(false);
  });
  test("missing identity", () => {
    expect(isHeld({ ...base, provider: undefined })).toBe(false);
    expect(isHeld({ ...base, model: undefined })).toBe(false);
  });
});
