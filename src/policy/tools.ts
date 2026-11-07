// Pure tool-assessment rules. Imports nothing outside src/policy/ and src/shared/.

import type { Answer } from "./answers.ts";

export const TOOL_THRESHOLD = 0.5;
export const TOOL_CAP = 32;
export const NEVER_CANDIDATES = ["ask_parent", "notify_parent"] as const;

export type ToolCounts = { toolsScored: number; toolsFlagged: number };

const TOOL_KEY_PREFIX = "tool::";

/** Split selected tools into the first TOOL_CAP scorable names and the rest, which stay selected. */
export function toolCandidates(selected: readonly string[]): { scored: string[]; kept: string[] } {
  const never: readonly string[] = NEVER_CANDIDATES;
  const eligible = selected.filter((name) => !never.includes(name));
  return { scored: eligible.slice(0, TOOL_CAP), kept: eligible.slice(TOOL_CAP) };
}

/** Names whose noul answer reaches TOOL_THRESHOLD; unanswered or non-noul names are never flagged. */
export function flaggedTools(
  answers: Record<string, Answer>,
  scored: readonly string[],
): Set<string> {
  const flagged = new Set<string>();
  for (const name of scored) {
    const answer = answers[TOOL_KEY_PREFIX + name];
    if (answer?.type === "noul" && answer.noul >= TOOL_THRESHOLD) flagged.add(name);
  }
  return flagged;
}

/** Counts for the worker ledger line: how many tools were scored and how many flagged. */
export function toolCounts(scored: readonly string[], flagged: ReadonlySet<string>): ToolCounts {
  return { toolsScored: scored.length, toolsFlagged: flagged.size };
}
