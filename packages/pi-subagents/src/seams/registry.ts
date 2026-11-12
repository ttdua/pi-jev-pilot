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

/** What the child's blocked tool count is built from. */
export interface BlockedToolInput {
	/** The agent's own tools plus the protocol tools installed, before `disallowed_tools`. */
	candidates: readonly string[];
	disallowed: readonly string[];
	/** Accepted policy removals of default tools. */
	policyRemoved: readonly string[];
	/** Grants that took effect in the child. */
	grantedTools: readonly string[];
	isKnown: (name: string) => boolean;
}

/** Orchestration tools the recursion guard withholds; never reported as blocked. */
const RECURSION_DENYLIST: readonly string[] = [
	"subagent",
	"get_subagent_result",
	"steer_subagent",
];

/** How many known tools the agent's `disallowed_tools` or the launch policy took from the child. */
export function blockedToolCount(input: BlockedToolInput): number {
	const { candidates, disallowed, policyRemoved, grantedTools, isKnown } = input;
	const candidateSet = new Set(candidates);
	const granted = new Set(grantedTools);
	const blocked = new Set([
		...disallowed.filter((name) => candidateSet.has(name) && isKnown(name)),
		...policyRemoved.filter((name) => !granted.has(name)),
	]);
	for (const name of RECURSION_DENYLIST) blocked.delete(name);
	return blocked.size;
}
