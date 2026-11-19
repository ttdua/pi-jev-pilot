/**
 * child-sessions.ts — Process-wide registry of live child sessions.
 *
 * The map lives on `globalThis` so that every executor instance in the
 * process (main and child) reads and writes the same registry. Only the
 * lifecycle publisher writes to it.
 */

import type { ChildSessionInfo, LaunchMetadata } from "#src/service/service";

interface ChildSessionEntry {
	readonly agentId: string;
	readonly agentType: string;
	readonly metadata: LaunchMetadata;
}

const REGISTRY_KEY = Symbol.for("@ttdua/pi-subagents:child-sessions");
const EMPTY_METADATA: LaunchMetadata = Object.freeze(Object.create(null));

type Registry = Map<string, ChildSessionEntry>;

function registry(): Registry {
	const host = globalThis as unknown as Record<symbol, Registry | undefined>;
	let map = host[REGISTRY_KEY];
	if (!map) {
		map = new Map();
		host[REGISTRY_KEY] = map;
	}
	return map;
}

export function enterChildSession(
	sessionId: string,
	entry: { agentId: string; agentType: string; metadata?: LaunchMetadata },
): void {
	registry().set(
		sessionId,
		Object.freeze({
			agentId: entry.agentId,
			agentType: entry.agentType,
			metadata: Object.freeze(entry.metadata ?? EMPTY_METADATA),
		}),
	);
}

export function leaveChildSession(sessionId: string): void {
	registry().delete(sessionId);
}

export function lookupChildSession(
	sessionId: string,
): ChildSessionInfo | undefined {
	return registry().get(sessionId);
}

/** Test-only: clears every entry. */
export function resetChildSessions(): void {
	registry().clear();
}
