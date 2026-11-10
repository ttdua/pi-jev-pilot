/**
 * identity.ts — Launch identity and effective launch facts.
 *
 * Every child event and record snapshot names the launch it belongs to, and a
 * created session reports the model and thinking level it really runs with.
 */

import type { ThinkingLevel } from "#src/types";

/** What names a launch: the record id, its agent type and the tool call, if any. */
export interface LaunchSource {
  id: string;
  type: string;
  /** The `subagent` tool call that started the current run; absent for a service launch. */
  currentToolCallId?: string;
}

export interface LaunchIdentity {
  agentId: string;
  agentType: string;
  toolCallId?: string;
}

/**
 * The identity as event payloads publish it: `agentId` and `agentType` are
 * optional in the public contract so other publishers of these channels stay
 * valid. This executor always sets them (`launchIdentity` returns them required).
 */
export type PublishedLaunchIdentity = Partial<Pick<LaunchIdentity, "agentId" | "agentType">> &
  Pick<LaunchIdentity, "toolCallId">;

/** The identity fields an event carries; `toolCallId` is omitted, not undefined, for service launches. */
export function launchIdentity(source: LaunchSource): LaunchIdentity {
  const identity: LaunchIdentity = { agentId: source.id, agentType: source.type };
  if (source.currentToolCallId !== undefined) identity.toolCallId = source.currentToolCallId;
  return identity;
}

/** Just the `toolCallId` an event payload adds to its existing fields. */
export function toolCallIdField(source: LaunchSource): { toolCallId?: string } {
  return source.currentToolCallId === undefined ? {} : { toolCallId: source.currentToolCallId };
}

export interface EffectiveFacts {
  effectiveModel?: string;
  effectiveThinking?: ThinkingLevel;
}

interface CreatedSession {
  model?: { provider: string; id: string };
  thinkingLevel?: ThinkingLevel;
}

/** The model (`provider/id`) and thinking level a session was created with. */
export function effectiveFacts(session: CreatedSession): EffectiveFacts {
  const facts: EffectiveFacts = {};
  if (session.model) facts.effectiveModel = `${session.model.provider}/${session.model.id}`;
  if (session.thinkingLevel !== undefined) facts.effectiveThinking = session.thinkingLevel;
  return facts;
}
