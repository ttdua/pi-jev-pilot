/**
 * child-sessions.ts — Process-wide registry of live child sessions.
 *
 * The state lives on `globalThis` so that every executor instance in the
 * process (main and child) reads and writes the same registry. Only the
 * lifecycle publisher writes to it.
 */

import type { ChildSessionInfo, LaunchMetadata } from "#src/service/service";

interface ChildSessionEntry {
	readonly agentId: string;
	readonly agentType: string;
	readonly metadata: LaunchMetadata;
}

interface RegistryState {
	readonly sessions: Map<string, ChildSessionEntry>;
	/** The canonical frozen empty metadata, shared by every module instance. */
	readonly empty: LaunchMetadata;
}

const REGISTRY_KEY = Symbol.for("@ttdua/pi-subagents:child-sessions");

function state(): RegistryState {
	const host = globalThis as unknown as Record<
		symbol,
		RegistryState | undefined
	>;
	let current = host[REGISTRY_KEY];
	if (!current) {
		current = {
			sessions: new Map(),
			empty: Object.freeze(Object.create(null)),
		};
		host[REGISTRY_KEY] = current;
	}
	return current;
}

/** Reuse a frozen map as-is; copy anything else so the caller's object is untouched. */
function ownedMetadata(
	metadata: LaunchMetadata | undefined,
	empty: LaunchMetadata,
): LaunchMetadata {
	if (metadata === undefined) return empty;
	if (Object.isFrozen(metadata)) return metadata;
	return Object.freeze(Object.assign(Object.create(null), metadata));
}

export function enterChildSession(
	sessionId: string,
	entry: { agentId: string; agentType: string; metadata?: LaunchMetadata },
): void {
	const { sessions, empty } = state();
	sessions.set(
		sessionId,
		Object.freeze({
			agentId: entry.agentId,
			agentType: entry.agentType,
			metadata: ownedMetadata(entry.metadata, empty),
		}),
	);
}

export function leaveChildSession(sessionId: string): void {
	state().sessions.delete(sessionId);
}

export function lookupChildSession(
	sessionId: string,
): ChildSessionInfo | undefined {
	return state().sessions.get(sessionId);
}

/** Test-only: clears every entry. */
export function resetChildSessions(): void {
	state().sessions.clear();
}
