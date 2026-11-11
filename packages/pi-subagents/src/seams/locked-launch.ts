/**
 * locked-launch.ts — One lock precedence for every launch door.
 *
 * The `subagent` tool door merges an agent's `locked:` fields into the call
 * before it resolves a model; the service door does not (upstream). While a
 * launch policy is registered, the launch gate applies the same rule for every
 * door, so the policy's `requested` is exactly what the session runs. With no
 * policy registered the doors keep upstream precedence.
 */

import type { Model } from "@earendil-works/pi-ai";
import {
	LOCKABLE_FIELDS,
	type LockableField,
} from "#src/config/invocation-config";
import {
	type ModelRegistry,
	resolveInvocationModel,
} from "#src/session/model-resolver";
import type { AgentConfig, ThinkingLevel } from "#src/types";

/** The lockable fields the agent withholds, with `locked: true` meaning every field it sets. */
export function lockedFields(config: AgentConfig): LockableField[] {
	const locked = config.locked;
	if (locked === undefined) return [];
	if (locked !== true) return [...locked];
	const sets: Record<LockableField, unknown> = {
		model: config.model,
		thinking: config.thinking,
		max_turns: config.maxTurns,
		inherit_context: config.inheritContext,
		run_in_background: config.runInBackground,
	};
	return LOCKABLE_FIELDS.filter((field) => sets[field] !== undefined);
}

/** The model and thinking level a door asked for. */
export interface LaunchValues {
	model?: Model<any>;
	thinkingLevel?: ThinkingLevel;
}

/** What the agent's model string resolves against: the parent's model and registry. */
export interface ModelSource {
	model: Model<any> | undefined;
	modelRegistry: ModelRegistry;
}

/**
 * `values` with each locked field replaced by the agent's own value, resolved
 * as the tool door resolves an agent-file model (unresolvable → parent model).
 */
export function applyLocks(
	config: AgentConfig,
	values: LaunchValues,
	source: ModelSource,
): LaunchValues {
	const locked = lockedFields(config);
	const out: LaunchValues = { ...values };
	if (locked.includes("model"))
		out.model = resolveInvocationModel(
			source.model,
			config.model,
			false,
			source.modelRegistry,
		).model;
	if (locked.includes("thinking")) out.thinkingLevel = config.thinking;
	return out;
}
