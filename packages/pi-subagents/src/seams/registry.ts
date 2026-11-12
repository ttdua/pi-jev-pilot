/**
 * registry.ts — Agent registry query and the `disallowed_tools` rule.
 *
 * `AgentTypeCatalog` answers `listAgentTypes()` / `getAgentType()` with
 * deep-frozen snapshots of agent definitions as a launch resolves them.
 * `finalToolNames` is the single place `disallowed_tools` is applied to a
 * child's allowlist.
 */

import { BUILTIN_TOOL_NAMES } from "#src/config/agent-types";
import { debugNote } from "#src/debug";
import type { AgentTypeSnapshot } from "#src/service/service";
import type { AgentConfig } from "#src/types";

/** The registry surface the catalog reads; `AgentTypeRegistry` satisfies it. */
export interface AgentTypeSource {
	reload(): void;
	resolveType(name: string): string | undefined;
	isValidType(type: string): boolean;
	resolveAgentConfig(type: string): AgentConfig;
	getAvailableTypes(): string[];
}

/** The type a launch runs when the requested name matches no agent. */
const FALLBACK_TYPE = "general-purpose";

/** Read-only view of the agent registry, reloaded on every query as a `subagent` call does. */
export class AgentTypeCatalog {
	constructor(private readonly source: AgentTypeSource) {}

	/** Every enabled agent type, built-in and file-defined, after file overrides. */
	list(): readonly AgentTypeSnapshot[] {
		this.source.reload();
		const snapshots = this.source
			.getAvailableTypes()
			.map((name) => snapshotOf(this.source.resolveAgentConfig(name)));
		return Object.freeze(snapshots);
	}

	/**
	 * Resolve `name` as a launch would: exact, case-insensitive, then
	 * `general-purpose`. A name resolving to a disabled agent returns nothing.
	 */
	get(name: string): AgentTypeSnapshot | undefined {
		this.source.reload();
		const canonical = this.source.resolveType(name);
		if (canonical !== undefined && !this.source.isValidType(canonical))
			return undefined;
		return snapshotOf(
			this.source.resolveAgentConfig(canonical ?? FALLBACK_TYPE),
		);
	}
}

/** A deep-frozen, plain copy of an agent config; never aliases executor state. */
export function snapshotOf(config: AgentConfig): AgentTypeSnapshot {
	const snapshot: AgentTypeSnapshot = {
		name: config.name,
		source: snapshotSource(config.source),
		description: config.description,
		instructions: config.systemPrompt,
		tools: config.toolsDeclared ? frozenCopy(config.toolNames ?? []) : null,
		defaultTools: frozenCopy(BUILTIN_TOOL_NAMES),
		disallowedTools: frozenCopy(config.disallowedTools),
		...optionalFields(config),
	};
	return Object.freeze(snapshot);
}

type OptionalSnapshotFields = Pick<
	AgentTypeSnapshot,
	| "model"
	| "thinking"
	| "locked"
	| "maxTurns"
	| "runInBackground"
	| "inheritContext"
>;

/** The declared optional fields, each omitted when the agent does not declare it. */
function optionalFields(config: AgentConfig): OptionalSnapshotFields {
	const fields: OptionalSnapshotFields = {};
	if (config.model !== undefined) fields.model = config.model;
	if (config.thinking !== undefined) fields.thinking = config.thinking;
	if (config.locked !== undefined)
		fields.locked = config.locked === true ? true : frozenCopy(config.locked);
	if (config.maxTurns !== undefined) fields.maxTurns = config.maxTurns;
	if (config.runInBackground !== undefined)
		fields.runInBackground = config.runInBackground;
	if (config.inheritContext !== undefined)
		fields.inheritContext = config.inheritContext;
	return fields;
}

function snapshotSource(
	source: AgentConfig["source"],
): AgentTypeSnapshot["source"] {
	return source === "project" || source === "global" ? source : "builtin";
}

function frozenCopy<T>(items: readonly T[]): readonly T[] {
	return Object.freeze([...items]);
}

/**
 * The child's final tool names: `base`, then `grants` not already present,
 * minus every `disallowed` name. Names compare exactly — Pi tool names are
 * case-sensitive, so `Bash` does not remove `bash`.
 */
export function finalToolNames(
	base: readonly string[],
	grants: readonly string[],
	disallowed: readonly string[],
): string[] {
	const denied = new Set(disallowed);
	const names = [...new Set([...base, ...grants])];
	return names.filter((name) => !denied.has(name));
}

/** Write a debug note for each tool an agent both declares and disallows. */
export function noteDeclaredAndDisallowed(
	agentName: string,
	declared: readonly string[],
	disallowed: readonly string[],
): void {
	const denied = new Set(disallowed);
	for (const tool of declared) {
		if (denied.has(tool))
			debugNote(
				`agent ${agentName}: tool ${tool} is both declared and disallowed; disallowed wins`,
			);
	}
}

/**
 * Tools in the run's total that the child cannot call. The total is the parent's
 * tool names plus the child's active tools, so granted plus blocked equals it.
 */
export function blockedToolCount(input: {
	parentToolNames: readonly string[];
	activeToolNames: readonly string[];
}): number {
	const active = new Set(input.activeToolNames);
	const total = new Set([...input.parentToolNames, ...input.activeToolNames]);
	let blocked = 0;
	for (const name of total) if (!active.has(name)) blocked++;
	return blocked;
}
