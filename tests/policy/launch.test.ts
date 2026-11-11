import { describe, expect, test } from "bun:test";

import {
  TIER_LADDER,
  effectiveLaunch,
  isFieldLocked,
  isSlot,
  slotName,
  slotTarget,
  type AgentFacts,
} from "../../src/policy/launch.ts";
import { TIERS } from "../../src/store/defaults.ts";

function facts(overrides: Partial<AgentFacts> = {}): AgentFacts {
  return {
    name: "a",
    source: "project",
    description: "",
    instructionsExcerpt: "",
    declaredTools: null,
    disallowedTools: [],
    maxTurns: null,
    sets: { model: false, thinking: false },
    ...overrides,
  };
}

describe("Tier ladder", () => {
  test("TIER_LADDER equals the store TIERS", () => {
    expect([...TIER_LADDER]).toEqual([...TIERS]);
  });
});

describe("Locked fields", () => {
  test("Whole-file lock covers only fields the file sets", () => {
    const f = facts({ locked: true, sets: { model: true, thinking: false } });
    expect(isFieldLocked(f, "model")).toBe(true);
    expect(isFieldLocked(f, "thinking")).toBe(false);
  });

  test("Listed lock without a value", () => {
    const f = facts({ locked: ["thinking"] });
    expect(isFieldLocked(f, "thinking")).toBe(true);
  });

  test("No lock locks nothing", () => {
    expect(isFieldLocked(facts(), "model")).toBe(false);
  });

  test("Whole-file lock covers set boolean and max_turns fields", () => {
    const f = facts({ locked: true, inheritContext: false, maxTurns: 3 });
    expect(isFieldLocked(f, "inherit_context")).toBe(true);
    expect(isFieldLocked(f, "max_turns")).toBe(true);
    expect(isFieldLocked(f, "run_in_background")).toBe(false);
  });
});

describe("Effective launch fields", () => {
  type Req = Parameters<typeof effectiveLaunch>[0];
  const request = (over: Partial<Req> = {}): Req => ({
    origin: { kind: "tool", toolCallId: "call_1" },
    requested: {},
    inheritContext: false,
    isBackground: false,
    locked: [],
    ...over,
  });

  test("inheritContext and runInBackground come from the request", () => {
    const r = effectiveLaunch(request({ inheritContext: true, isBackground: true }), facts());
    expect(r.inheritContext).toBe(true);
    expect(r.runInBackground).toBe(true);
    const plain = effectiveLaunch(request(), facts({ inheritContext: true }));
    expect(plain.inheritContext).toBe(false);
    expect(plain.runInBackground).toBe(false);
  });

  test("locked fields come from the request", () => {
    const r = effectiveLaunch(request({ locked: ["thinking"] }), facts());
    expect(r).toMatchObject({ modelLocked: false, thinkingLocked: true });
  });

  test("an agent lock also counts", () => {
    const f = facts({ locked: true, sets: { model: true, thinking: false } });
    const r = effectiveLaunch(request(), f);
    expect(r.modelLocked).toBe(isFieldLocked(f, "model"));
    expect(r.modelLocked).toBe(true);
    expect(r.thinkingLocked).toBe(false);
  });

  test("Service launch naming a model locks the model", () => {
    const r = effectiveLaunch(
      request({ origin: { kind: "service" }, requested: { model: "fixture/fixture-deep" } }),
      facts(),
    );
    expect(r).toMatchObject({ modelLocked: true, thinkingLocked: false });
  });

  test("a service launch without a model, or a tool launch with one, is not locked", () => {
    const service = effectiveLaunch(request({ origin: { kind: "service" } }), facts());
    expect(service.modelLocked).toBe(false);
    const tool = effectiveLaunch(request({ requested: { model: "fx/main" } }), facts());
    expect(tool.modelLocked).toBe(false);
  });

  test("Resume is not a launch field", () => {
    expect(Object.keys(effectiveLaunch(request(), facts())).sort()).toEqual(
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
