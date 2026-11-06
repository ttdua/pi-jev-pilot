// Pure worker effort rules. Imports nothing outside src/policy/.

import type { ChoiceAnswer } from "./answers.ts";
import type { TierName } from "./launch.ts";

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export const EFFORT_LADDER: readonly EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

export type EffortInput = {
  effort?: ChoiceAnswer;
  risky?: number;
  tier?: TierName;
  movedByFallback: boolean;
};

function isEffortLevel(value: string): value is EffortLevel {
  return (EFFORT_LADDER as readonly string[]).includes(value);
}

function rank(level: EffortLevel): number {
  return EFFORT_LADDER.indexOf(level);
}

function atLeast(level: EffortLevel, floor: EffortLevel): EffortLevel {
  return rank(level) >= rank(floor) ? level : floor;
}

function atMost(level: EffortLevel, cap: EffortLevel): EffortLevel {
  return rank(level) <= rank(cap) ? level : cap;
}

export function workerEffort(input: EffortInput): EffortLevel | undefined {
  if (input.movedByFallback) return "xhigh";
  const choice = input.effort?.choice;
  if (choice === undefined || !isEffortLevel(choice)) return undefined;
  let level: EffortLevel = choice;
  if (input.risky !== undefined && input.risky > 0.7) level = atLeast(level, "high");
  level = atMost(level, "xhigh");
  if (input.tier === "fast") level = atMost(level, "medium");
  return level;
}

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export const THINKING_LADDER: readonly ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

// The subset of a Pi model that the clamp reads.
export type ModelThinking = {
  reasoning: boolean;
  thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
};

// Mirrors Pi's getSupportedThinkingLevels (pi-ai models.js).
export function supportedLevels(model: ModelThinking): ThinkingLevel[] {
  if (!model.reasoning) return ["off"];
  return THINKING_LADDER.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
}

// Mirrors Pi's clampThinkingLevel: up from the request, then down, then the first level.
export function clampLevel(model: ModelThinking, level: ThinkingLevel): ThinkingLevel {
  const available = supportedLevels(model);
  if (available.includes(level)) return level;
  const requested = THINKING_LADDER.indexOf(level);
  for (let i = requested; i < THINKING_LADDER.length; i++) {
    const candidate = THINKING_LADDER[i];
    if (candidate !== undefined && available.includes(candidate)) return candidate;
  }
  for (let i = requested - 1; i >= 0; i--) {
    const candidate = THINKING_LADDER[i];
    if (candidate !== undefined && available.includes(candidate)) return candidate;
  }
  return available[0] ?? "off";
}
