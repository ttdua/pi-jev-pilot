import { describe, expect, test } from "bun:test";

import {
  TIER_LADDER,
  effectiveLaunch,
  isSlot,
  slotName,
  slotTarget,
} from "../../src/policy/launch.ts";
import { TIERS } from "../../src/store/defaults.ts";

describe("Tier ladder", () => {
  test("TIER_LADDER equals the store TIERS", () => {
    expect([...TIER_LADDER]).toEqual([...TIERS]);
  });
});

describe("Effective launch fields", () => {
  type Req = Parameters<typeof effectiveLaunch>[0];
  const request = (over: Partial<Req> = {}): Req => ({
    origin: { kind: "tool", toolCallId: "call_1" },
    callerNamedModel: false,
    inheritContext: false,
    isBackground: false,
    locked: [],
    ...over,
  });

  test("inheritContext and runInBackground come from the request", () => {
    const r = effectiveLaunch(request({ inheritContext: true, isBackground: true }));
    expect(r.inheritContext).toBe(true);
    expect(r.runInBackground).toBe(true);
    const plain = effectiveLaunch(request());
    expect(plain.inheritContext).toBe(false);
    expect(plain.runInBackground).toBe(false);
  });

  test("locked fields come from the request", () => {
    const r = effectiveLaunch(request({ locked: ["thinking"] }));
    expect(r).toMatchObject({ modelLocked: false, thinkingLocked: true });
  });

  test("Service launch naming a model locks the model", () => {
    const r = effectiveLaunch(request({ origin: { kind: "service" }, callerNamedModel: true }));
    expect(r).toMatchObject({ modelLocked: true, thinkingLocked: false });
  });

  test("a service launch without a model, or a tool launch with one, is not locked", () => {
    const service = effectiveLaunch(request({ origin: { kind: "service" } }));
    expect(service.modelLocked).toBe(false);
    const tool = effectiveLaunch(request({ callerNamedModel: true }));
    expect(tool.modelLocked).toBe(false);
  });

  test("Resume is not a launch field", () => {
    expect(Object.keys(effectiveLaunch(request())).sort()).toEqual(
      ["inheritContext", "modelLocked", "runInBackground", "thinkingLocked"].sort(),
    );
  });
});

describe("Slot targets", () => {
  test("isSlot tells slots from tiers", () => {
    expect(isSlot("slot::a")).toBe(true);
    expect(isSlot("fast")).toBe(false);
  });
  test("slotName strips the prefix", () => {
    expect(slotName(slotTarget("a-b"))).toBe("a-b");
  });
  test("slotTarget prefixes the name", () => {
    expect(slotTarget("a")).toBe("slot::a");
  });
});
