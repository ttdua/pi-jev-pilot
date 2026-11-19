export type TierName = "basic" | "broad" | "deep" | "frontier";

export const TIER_LADDER: readonly TierName[] = ["basic", "broad", "deep", "frontier"];

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

/** How a child session starts: from scratch, or as a fork of the parent. */
export type ContextMode = "fresh" | "fork";

export const LOCKABLE_FIELDS = [
  "model",
  "thinking",
  "max_turns",
  "context",
  "run_in_background",
] as const;

export type LockableField = (typeof LOCKABLE_FIELDS)[number];

export type AgentFacts = {
  name: string;
  source: "project" | "global" | "builtin" | "package";
  description: string;
  instructionsExcerpt: string;
  declaredTools: string[] | null;
  /** Tools the executor removes from the child after every other source. */
  disallowedTools: readonly string[];
  maxTurns: number | null;
  runInBackground?: boolean;
  context?: ContextMode;
  sets: { model: boolean; thinking: boolean };
};

export type EffectiveLaunch = {
  context: ContextMode;
  runInBackground: boolean;
  modelLocked: boolean;
  thinkingLocked: boolean;
};

/**
 * The launch request fields the route reads, structurally a slice of the executor's
 * `LaunchRequest` plus `callerNamedModel`, which the host derives from it.
 */
export type LaunchRequestFacts = {
  origin: { kind: "tool"; toolCallId: string } | { kind: "service" };
  /** The caller named a model, rather than the agent's own `model` filling `requested.model`. */
  callerNamedModel: boolean;
  context: ContextMode;
  isBackground: boolean;
  locked: readonly LockableField[];
};

/** A service launch whose caller names a model keeps it, as if the agent locked `model`. */
function serviceModel(request: LaunchRequestFacts): boolean {
  return request.origin.kind === "service" && request.callerNamedModel;
}

/** The launch as routing sees it; a resume never reaches the policy, so it has no field here. */
export function effectiveLaunch(request: LaunchRequestFacts): EffectiveLaunch {
  const locks = (field: LockableField): boolean => request.locked.includes(field);
  return {
    context: request.context,
    runInBackground: request.isBackground,
    modelLocked: locks("model") || serviceModel(request),
    thinkingLocked: locks("thinking"),
  };
}
