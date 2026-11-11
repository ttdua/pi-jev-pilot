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
  test("Inherit from frontmatter", () => {
    expect(effectiveLaunch({}, facts({ inheritContext: true })).inheritContext).toBe(true);
  });

  test("Input wins without a lock", () => {
    const r = effectiveLaunch({ inherit_context: false }, facts({ inheritContext: true }));
    expect(r.inheritContext).toBe(false);
  });

  test("Lock keeps the agent value", () => {
    const r = effectiveLaunch(
      { inherit_context: false },
      facts({ inheritContext: true, locked: ["inherit_context"] }),
    );
    expect(r.inheritContext).toBe(true);
  });

  test("Resume", () => {
    expect(effectiveLaunch({ resume: "agent-12" }, facts()).resume).toBe(true);
    expect(effectiveLaunch({ resume: "" }, facts()).resume).toBe(false);
    expect(effectiveLaunch({ resume: 5 }, facts()).resume).toBe(false);
  });

  test("Defaults to false and runInBackground follows the same rule", () => {
    const r = effectiveLaunch({}, facts());
    expect(r.inheritContext).toBe(false);
    expect(r.runInBackground).toBe(false);
    expect(effectiveLaunch({ run_in_background: true }, facts()).runInBackground).toBe(true);
    expect(
      effectiveLaunch(
        { run_in_background: true },
        facts({ runInBackground: false, locked: ["run_in_background"] }),
      ).runInBackground,
    ).toBe(false);
  });

  test("modelLocked and thinkingLocked mirror isFieldLocked", () => {
    const f = facts({ locked: true, sets: { model: true, thinking: false } });
    const r = effectiveLaunch({}, f);
    expect(r.modelLocked).toBe(isFieldLocked(f, "model"));
    expect(r.thinkingLocked).toBe(isFieldLocked(f, "thinking"));
    expect(r.modelLocked).toBe(true);
    expect(r.thinkingLocked).toBe(false);
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
