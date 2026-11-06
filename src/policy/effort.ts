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
