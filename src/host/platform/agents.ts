import type { AgentTypeSnapshot, SubagentsService } from "@ttdua/pi-subagents";
import type { AgentFacts } from "../../policy/launch.ts";
import { cutCodePoints } from "../../shared/text.ts";

const EXCERPT_MAX = 500;
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function isThinkingLevel(value: string | undefined): boolean {
  return value !== undefined && THINKING_LEVELS.has(value);
}

/** Launch fields the snapshot declares; a key is present only when declared. */
function snapshotLaunchFields(snapshot: AgentTypeSnapshot): Partial<AgentFacts> {
  const fields: Partial<AgentFacts> = {};
  if (snapshot.runInBackground !== undefined) fields.runInBackground = snapshot.runInBackground;
  if (snapshot.inheritContext !== undefined) fields.inheritContext = snapshot.inheritContext;
  if (snapshot.locked !== undefined) {
    fields.locked = snapshot.locked === true ? true : [...snapshot.locked];
  }
  return fields;
}

/**
 * Agent facts from the executor's snapshot. Pure; the declared `model` and
 * `thinking` values are never copied, only whether each is set.
 */
export function agentFacts(snapshot: AgentTypeSnapshot): AgentFacts {
  return {
    name: snapshot.name,
    source: snapshot.source,
    description: snapshot.description,
    instructionsExcerpt: cutCodePoints(snapshot.instructions.trim(), EXCERPT_MAX),
    declaredTools: snapshot.tools === null ? null : [...snapshot.tools],
    disallowedTools: [...snapshot.disallowedTools],
    maxTurns: snapshot.maxTurns ?? null,
    sets: { model: snapshot.model !== undefined, thinking: isThinkingLevel(snapshot.thinking) },
    ...snapshotLaunchFields(snapshot),
  };
}

/** The executor's agents as facts; empty without the executor or when its registry throws. */
export function executorAgents(
  service: Pick<SubagentsService, "listAgentTypes"> | undefined,
): AgentFacts[] {
  if (service === undefined) return [];
  try {
    return service.listAgentTypes().map(agentFacts);
  } catch {
    return [];
  }
}
