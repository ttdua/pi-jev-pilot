export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** All thinking levels, ordered from lowest to highest. */
export const LEVELS: readonly ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export const EFFORT_LEVELS: readonly EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];
export const RISK_FLOOR = 0.7;
export const EFFORT_CEILING: EffortLevel = "xhigh";
export const CORRECTION_THRESHOLD = 0.7;

/** Pi's rule for the levels a model supports, without importing Pi. */
export function supportedLevels(m: {
  reasoning: boolean;
  thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
}): ThinkingLevel[] {
  if (!m.reasoning) return ["off"];
  return LEVELS.filter((level) => {
    const mapped = m.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
}

/** The level itself when supported, else the nearest above, else the nearest below. */
export function clampLevel(
  level: ThinkingLevel,
  supported: readonly ThinkingLevel[],
): ThinkingLevel {
  if (supported.includes(level)) return level;
  const index = LEVELS.indexOf(level);
  for (let i = index + 1; i < LEVELS.length; i++) {
    const candidate = LEVELS[i]!;
    if (supported.includes(candidate)) return candidate;
  }
  for (let i = index - 1; i >= 0; i--) {
    const candidate = LEVELS[i]!;
    if (supported.includes(candidate)) return candidate;
  }
  return supported[0] ?? "off";
}

export function decideEffort(i: {
  choice: EffortLevel;
  risky?: number;
  supported: readonly ThinkingLevel[];
}): { requested: EffortLevel; target: ThinkingLevel } {
  let requested = i.choice;
  if (
    i.risky !== undefined &&
    i.risky > RISK_FLOOR &&
    EFFORT_LEVELS.indexOf(requested) < EFFORT_LEVELS.indexOf("high")
  ) {
    requested = "high";
  }
  if (requested === "max") requested = EFFORT_CEILING;
  return { requested, target: clampLevel(requested, i.supported) };
}

/** Effort is worth asking only when at least two levels from `low` upward are supported. */
export function canAskEffort(supported: readonly ThinkingLevel[]): boolean {
  return EFFORT_LEVELS.filter((level) => supported.includes(level)).length >= 2;
}
