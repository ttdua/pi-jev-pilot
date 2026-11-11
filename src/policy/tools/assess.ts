// Pure tool-assessment rules. Imports nothing outside src/policy/ and src/shared/.

import type { Answer } from "../answers.ts";

/** A block candidate is flagged at this `tool::` noul or more. */
export const TOOL_THRESHOLD = 0.5;
/** At most this many candidates are scored per launch, block candidates first. */
export const TOOL_CAP = 32;
/** Never scored: the review tool and every tool the executor owns or installs itself. */
export const NEVER_CANDIDATES = [
  "jev_review",
  "subagent",
  "get_subagent_result",
  "steer_subagent",
  "ask_parent",
  "notify_parent",
] as const;

/** The launch's tool facts, as the executor's launch request carries them. */
export type ToolSet = {
  declared: readonly string[] | null;
  disallowed: readonly string[];
  defaults: readonly string[];
  parentTools: readonly string[];
};

/** Which tools a launch scores: block candidates (default tools), then grant candidates. */
export type ToolPlan = { block: string[]; grant: string[] };

/** Counts for the worker ledger line; never names a tool. */
export type ToolCounts = { toolsScored: number; toolsFlagged: number; toolsGranted: number };

const TOOL_KEY_PREFIX = "tool::";
const GRANT_KEY_PREFIX = "grant::";

/** Names not yet in `skip`, in order; each picked name is added to `skip`. */
function pickNew(names: readonly string[], skip: Set<string>): string[] {
  const out: string[] = [];
  for (const name of names) {
    if (skip.has(name)) continue;
    skip.add(name);
    out.push(name);
  }
  return out;
}

/**
 * Block candidates are the defaults, grant candidates the parent tools not among them; declared,
 * disallowed and never-candidate names are skipped, each name scored once. At most TOOL_CAP in
 * total: block candidates first, so a block candidate past the cap stays and a grant one is lost.
 */
export function toolPlan(toolSet: ToolSet, never: readonly string[] = NEVER_CANDIDATES): ToolPlan {
  const skip = new Set([...(toolSet.declared ?? []), ...toolSet.disallowed, ...never]);
  const block = pickNew(toolSet.defaults, skip).slice(0, TOOL_CAP);
  const grant = pickNew(toolSet.parentTools, skip).slice(0, TOOL_CAP - block.length);
  return { block, grant };
}

/** Names whose `prefix<name>` noul reaches `threshold`; a missing or non-noul answer never counts. */
function reaching(
  answers: Record<string, Answer>,
  names: readonly string[],
  prefix: string,
  threshold: number,
): Set<string> {
  const out = new Set<string>();
  for (const name of names) {
    const answer = answers[prefix + name];
    if (answer?.type !== "noul") continue;
    const { noul } = answer;
    if (noul >= threshold && noul <= 1) out.add(name);
  }
  return out;
}

/** Block candidates whose `tool::` answer reaches TOOL_THRESHOLD. */
export function flaggedTools(
  answers: Record<string, Answer>,
  block: readonly string[],
): Set<string> {
  return reaching(answers, block, TOOL_KEY_PREFIX, TOOL_THRESHOLD);
}

/** Grant candidates whose `grant::` answer reaches `grantAt`. */
export function grantedTools(
  answers: Record<string, Answer>,
  grant: readonly string[],
  grantAt: number,
): Set<string> {
  return reaching(answers, grant, GRANT_KEY_PREFIX, grantAt);
}

/** Counts for the worker ledger line: scored candidates, flagged ones and granted ones. */
export function toolCounts(
  scored: readonly string[],
  flagged: ReadonlySet<string>,
  granted: ReadonlySet<string>,
): ToolCounts {
  return { toolsScored: scored.length, toolsFlagged: flagged.size, toolsGranted: granted.size };
}
