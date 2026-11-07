export type TierName = "fast" | "balanced" | "deep" | "expert";

export const TIER_LADDER: readonly TierName[] = ["fast", "balanced", "deep", "expert"];

const SLOT_PREFIX = "slot::";

/** A configured custom model slot, written `slot::<name>`. */
export type SlotTarget = `slot::${string}`;

/** What a worker launch can route to: a tier or a slot. */
export type Target = TierName | SlotTarget;

export function isSlot(target: string): target is SlotTarget {
  return target.startsWith(SLOT_PREFIX);
}

export function slotTarget(name: string): SlotTarget {
  return `${SLOT_PREFIX}${name}`;
}

/** The slot name inside a slot target. */
export function slotName(target: SlotTarget): string {
  return target.slice(SLOT_PREFIX.length);
}

export const LOCKABLE_FIELDS = [
  "model",
  "thinking",
  "max_turns",
  "inherit_context",
  "run_in_background",
] as const;

export type LockableField = (typeof LOCKABLE_FIELDS)[number];

export type LockDeclaration = true | readonly LockableField[];

export type AgentFacts = {
  name: string;
  source: "project" | "global" | "builtin";
  description: string;
  instructionsExcerpt: string;
  declaredTools: string[] | null;
  maxTurns: number | null;
  runInBackground?: boolean;
  inheritContext?: boolean;
  locked?: LockDeclaration;
  sets: { model: boolean; thinking: boolean };
};

export type EffectiveLaunch = {
  resume: boolean;
  inheritContext: boolean;
  runInBackground: boolean;
  modelLocked: boolean;
  thinkingLocked: boolean;
};

function agentSets(facts: AgentFacts, field: LockableField): boolean {
  switch (field) {
    case "model":
      return facts.sets.model;
    case "thinking":
      return facts.sets.thinking;
    case "max_turns":
      return facts.maxTurns !== null && facts.maxTurns !== undefined;
    case "inherit_context":
      return facts.inheritContext !== undefined && facts.inheritContext !== null;
    case "run_in_background":
      return facts.runInBackground !== undefined && facts.runInBackground !== null;
  }
}

export function isFieldLocked(facts: AgentFacts, field: LockableField): boolean {
  const lock = facts.locked;
  if (lock === undefined) return false;
  if (lock === true) return agentSets(facts, field);
  return lock.includes(field);
}

function effectiveBoolean(
  inputValue: unknown,
  agentValue: boolean | undefined,
  locked: boolean,
): boolean {
  if (!locked && typeof inputValue === "boolean") return inputValue;
  return agentValue ?? false;
}

export function effectiveLaunch(
  input: Record<string, unknown>,
  facts: AgentFacts,
): EffectiveLaunch {
  return {
    resume: typeof input.resume === "string" && input.resume.length > 0,
    inheritContext: effectiveBoolean(
      input.inherit_context,
      facts.inheritContext,
      isFieldLocked(facts, "inherit_context"),
    ),
    runInBackground: effectiveBoolean(
      input.run_in_background,
      facts.runInBackground,
      isFieldLocked(facts, "run_in_background"),
    ),
    modelLocked: isFieldLocked(facts, "model"),
    thinkingLocked: isFieldLocked(facts, "thinking"),
  };
}
