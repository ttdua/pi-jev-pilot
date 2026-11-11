/**
 * launch-plan.ts — Apply a launch policy's adjustment under the executor's
 * precedence rules.
 *
 * A locked model or thinking level cannot change; a declared tool cannot be
 * removed; a grant must be a parent tool and not disallowed. Each violating
 * entry is dropped with a debug note and the rest applies.
 */

import { debugNote } from "#src/debug";
import type { LaunchAdjustment, LaunchRequest } from "#src/service/service";
import type { ThinkingLevel } from "#src/types";

/** What a launch runs with after its adjustment. */
export interface LaunchPlan {
	/** The policy's model string, when it may apply; resolved by the caller. */
	model?: string;
	thinking?: ThinkingLevel;
	/** The child's base tool names without grants (before protocol tools and `disallowed_tools`). */
	toolNames: string[];
	/** Granted names, checked in the child after its extensions bind. */
	grants: string[];
}

/** Apply `adjustment` to `request` under the executor's precedence rules. */
export function applyAdjustment(
	request: LaunchRequest,
	adjustment: LaunchAdjustment,
): LaunchPlan {
	const removals = allowedRemovals(request, adjustment.removeTools ?? []);
	const toolNames = request.toolSet.defaults.filter(
		(name) => !removals.has(name),
	);
	// A tool the child already has is not a grant.
	const grants = allowedGrants(request, adjustment.addTools ?? []).filter(
		(name) => !toolNames.includes(name),
	);
	const plan: LaunchPlan = { toolNames, grants };
	const model = unlockedValue(request, "model", adjustment.model);
	if (model !== undefined) plan.model = model;
	const thinking = unlockedValue(request, "thinking", adjustment.thinking);
	if (thinking !== undefined) plan.thinking = thinking;
	return plan;
}

function unlockedValue<T>(
	request: LaunchRequest,
	field: "model" | "thinking",
	value: T | undefined,
): T | undefined {
	if (value === undefined || !request.locked.includes(field)) return value;
	debugNote(
		`launch policy: agent ${request.agentType} locks ${field}; policy ${field} ${String(value)} ignored`,
	);
	return undefined;
}

function allowedGrants(
	request: LaunchRequest,
	names: readonly string[],
): string[] {
	const { parentTools, disallowed } = request.toolSet;
	return [...new Set(names)].filter((name) => {
		if (!parentTools.includes(name))
			return dropNote(request, `grant ${name} is not a parent tool`);
		if (disallowed.includes(name))
			return dropNote(request, `grant ${name} is disallowed`);
		return true;
	});
}

function allowedRemovals(
	request: LaunchRequest,
	names: readonly string[],
): Set<string> {
	const declared = request.toolSet.declared ?? [];
	return new Set(
		names.filter(
			(name) =>
				!declared.includes(name) ||
				dropNote(request, `declared tool ${name} cannot be removed`),
		),
	);
}

function dropNote(request: LaunchRequest, reason: string): false {
	debugNote(`launch policy: agent ${request.agentType}: ${reason}; dropped`);
	return false;
}
