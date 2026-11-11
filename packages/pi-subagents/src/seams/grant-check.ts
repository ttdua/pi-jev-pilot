/**
 * grant-check.ts — Keep only the grants a child can really use.
 *
 * A parent's tool list cannot prove a child will have a tool: an extension
 * may register a tool only in the main session, later, or with an exposure
 * the model cannot call. After the child's extensions bind, a grant takes
 * effect only when the child registered a tool of that name that is declared
 * to the model (`direct` or `model-only`). Exposure is never changed.
 */

import type { ToolExposure, ToolInfo } from "@earendil-works/pi-coding-agent";
import { debugNote } from "#src/debug";

/** Exposures whose active tools Pi declares to the model. */
const MODEL_CALLABLE: ReadonlySet<ToolExposure> = new Set([
	"direct",
	"model-only",
]);

/** The granted names the child registered with a model-callable exposure, in grant order. */
export function checkGrants(
	granted: readonly string[],
	childTools: readonly Pick<ToolInfo, "name" | "exposure">[],
): string[] {
	const callable = new Set(
		childTools
			.filter((tool) => MODEL_CALLABLE.has(tool.exposure))
			.map((tool) => tool.name),
	);
	return granted.filter((name) => callable.has(name));
}

/** The child-session slice the grant check reads and adjusts. */
export interface GrantedSession {
	getAllTools(): readonly Pick<ToolInfo, "name" | "exposure">[];
	getActiveToolNames(): string[];
	setActiveToolsByName(names: string[]): void;
}

/**
 * Check `granted` in the bound child, deactivate the dropped ones (default and
 * declared tools stay), and return the grants that took effect.
 */
export function enforceGrants(
	session: GrantedSession,
	granted: readonly string[],
): string[] {
	if (granted.length === 0) return [];
	const kept = checkGrants(granted, session.getAllTools());
	const dropped = granted.filter((name) => !kept.includes(name));
	if (dropped.length === 0) return kept;
	for (const name of dropped)
		debugNote(
			`launch policy: grant ${name} is not a callable tool in the child; dropped`,
		);
	session.setActiveToolsByName(
		session.getActiveToolNames().filter((name) => !dropped.includes(name)),
	);
	return kept;
}
