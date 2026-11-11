/**
 * launch-request.ts — Build the frozen `LaunchRequest` a launch policy sees.
 */

import { BUILTIN_TOOL_NAMES } from "#src/config/agent-types";
import {
	LOCKABLE_FIELDS,
	type LockableField,
} from "#src/config/invocation-config";
import { lockedFields } from "#src/seams/locked-launch";
import { finalToolNames, snapshotOf } from "#src/seams/registry";
import type { LaunchOrigin, LaunchRequest } from "#src/service/service";
import { expandMcpToolPatterns } from "#src/session/mcp-tool-patterns";
import type { AgentConfig, ThinkingLevel } from "#src/types";

/**
 * Tools the executor installs or owns itself; never offered as grants. The
 * first three are the parent's orchestration tools, the last two the child
 * protocol tools the executor adds on its own.
 */
const ORCHESTRATION_TOOLS: ReadonlySet<string> = new Set([
	"subagent",
	"get_subagent_result",
	"steer_subagent",
	"ask_parent",
	"notify_parent",
]);

/** The slice of Pi's `ToolInfo` the request reads to filter parent tools. */
export interface ParentToolInfo {
	name: string;
	sourceInfo?: { source: string; origin: string };
}

/** Everything a launch request is built from, gathered at the start of a run. */
export interface LaunchRequestInput {
	agentId: string;
	agentType: string;
	config: AgentConfig;
	origin: LaunchOrigin;
	parentSessionId?: string;
	prompt: string;
	description: string;
	/** The model (`provider/id`) and thinking level the launch would run without a policy. */
	requested: { model?: string; thinking?: ThinkingLevel };
	inheritContext: boolean;
	isBackground: boolean;
	parentTools: readonly ParentToolInfo[];
	excludedPackages: readonly string[];
}

/** A launch request, deep-frozen. */
export function buildLaunchRequest(input: LaunchRequestInput): LaunchRequest {
	const parentTools = grantableParentTools(
		input.parentTools,
		input.excludedPackages,
	);
	const request: LaunchRequest = {
		agentId: input.agentId,
		agentType: input.agentType,
		agent: snapshotOf(input.config),
		origin: Object.freeze({ ...input.origin }),
		prompt: input.prompt,
		description: input.description,
		requested: Object.freeze(definedOnly(input.requested)),
		locked: Object.freeze(lockedFields(input.config)),
		inheritContext: input.inheritContext,
		isBackground: input.isBackground,
		toolSet: Object.freeze({
			declared: input.config.toolsDeclared
				? Object.freeze([...(input.config.toolNames ?? [])])
				: null,
			disallowed: Object.freeze([...input.config.disallowedTools]),
			defaults: Object.freeze(
				defaultTools(
					input.config,
					input.parentTools.map((t) => t.name),
				),
			),
			parentTools: Object.freeze(parentTools),
		}),
	};
	if (input.parentSessionId !== undefined)
		request.parentSessionId = input.parentSessionId;
	return Object.freeze(request);
}

/**
 * Parent tool names a policy may grant: every tool except the executor's own
 * and those an excluded package registered. A tool belongs to a package when
 * its `sourceInfo.origin` is `package`; its `sourceInfo.source` is the package
 * source string `excludedExtensionPackages` names.
 */
export function grantableParentTools(
	tools: readonly ParentToolInfo[],
	excludedPackages: readonly string[],
): string[] {
	const excluded = new Set(excludedPackages);
	const names = tools
		.filter((tool) => !ORCHESTRATION_TOOLS.has(tool.name))
		.filter((tool) => !fromExcludedPackage(tool, excluded))
		.map((tool) => tool.name);
	return [...new Set(names)];
}

function fromExcludedPackage(
	tool: ParentToolInfo,
	excluded: ReadonlySet<string>,
): boolean {
	const source = tool.sourceInfo;
	return source?.origin === "package" && excluded.has(source.source);
}

/** The agent's tools as the child would get them with no policy. */
function defaultTools(
	config: AgentConfig,
	parentToolNames: readonly string[],
): string[] {
	const base = config.toolNames ?? BUILTIN_TOOL_NAMES;
	const { toolNames } = expandMcpToolPatterns(base, parentToolNames);
	return finalToolNames(toolNames, [], config.disallowedTools);
}

function definedOnly(
	requested: LaunchRequestInput["requested"],
): LaunchRequest["requested"] {
	const out: LaunchRequest["requested"] = {};
	if (requested.model !== undefined) out.model = requested.model;
	if (requested.thinking !== undefined) out.thinking = requested.thinking;
	return out;
}
