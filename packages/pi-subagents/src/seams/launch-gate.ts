/**
 * launch-gate.ts — Consult the launch policy for one new launch and turn its
 * adjustment into the values the child session is created with.
 *
 * `Subagent` calls `plan()` between leaving the concurrency queue and creating
 * its session; a resume never comes here.
 */

import type { Model } from "@earendil-works/pi-ai";
import { debugLog, debugNote } from "#src/debug";
import { applyAdjustment } from "#src/seams/launch-plan";
import type { LaunchPolicySlot } from "#src/seams/launch-policy";
import {
	buildLaunchRequest,
	type ParentToolInfo,
} from "#src/seams/launch-request";
import { applyLocks } from "#src/seams/locked-launch";
import type {
	LaunchAdjustment,
	LaunchOrigin,
	LaunchRequest,
} from "#src/service/service";
import { type ModelRegistry, resolveModel } from "#src/session/model-resolver";
import type { AgentConfig, ThinkingLevel } from "#src/types";

/** What the parent session offers a launch, read fresh for each launch. */
export interface LaunchContext {
	listParentTools(): readonly ParentToolInfo[];
	excludedPackages(): readonly string[];
}

/** The facts of one launch the gate reads; `Subagent` supplies them at run start. */
export interface LaunchFacts {
	agentId: string;
	agentType: string;
	origin: LaunchOrigin;
	parentSessionId?: string;
	prompt: string;
	description: string;
	model?: Model<any>;
	thinkingLevel?: ThinkingLevel;
	inheritContext: boolean;
	isBackground: boolean;
	/** The parent's model, which a locked agent model falls back to when unresolvable. */
	parentModel: Model<any> | undefined;
	modelRegistry: ModelRegistry;
}

/**
 * What a launch runs with while a policy is registered. `model` and
 * `thinkingLevel` are authoritative (undefined means inherit), with the
 * agent's locked fields applied for every door; `tools` is absent when the
 * policy changed no tools.
 */
export interface LaunchOverrides {
	model: Model<any> | undefined;
	thinkingLevel: ThinkingLevel | undefined;
	/** The child's base tool names, and the grants among them to check after bind. */
	tools?: { toolNames: string[]; grants: string[] };
}

export class LaunchPolicyGate {
	constructor(
		private readonly slot: LaunchPolicySlot,
		private readonly context: LaunchContext,
		private readonly resolveConfig: (type: string) => AgentConfig,
	) {}

	/** Whether a policy is registered; without one, a launch skips the gate entirely. */
	get active(): boolean {
		return this.slot.registered;
	}

	/**
	 * Apply the agent's locks, then consult the policy. The locked values are
	 * what the policy sees as `requested` and what the session runs when the
	 * policy returns nothing or fails. Never rejects: a failure before the
	 * request exists yields `undefined`, and the launch runs as upstream would.
	 */
	async plan(
		facts: LaunchFacts,
		runSignal: AbortSignal,
	): Promise<LaunchOverrides | undefined> {
		try {
			const config = this.resolveConfig(facts.agentType);
			const locked = applyLocks(config, facts, {
				model: facts.parentModel,
				modelRegistry: facts.modelRegistry,
			});
			const request = this.request({ ...facts, ...locked }, config);
			const base: LaunchOverrides = {
				model: locked.model,
				thinkingLevel: locked.thinkingLevel,
			};
			const adjustment = await this.slot.consult(request, runSignal);
			return adjustment
				? overridesOf(request, adjustment, base, facts.modelRegistry)
				: base;
		} catch (err) {
			debugLog("launch policy gate failed; launch unchanged", err);
			return undefined;
		}
	}

	private request(facts: LaunchFacts, config: AgentConfig): LaunchRequest {
		return buildLaunchRequest({
			...facts,
			config,
			requested: requestedValues(facts, config),
			parentTools: this.context.listParentTools(),
			excludedPackages: this.context.excludedPackages(),
		});
	}
}

/** `base` with the changes `adjustment` may make, after the precedence rules. */
function overridesOf(
	request: LaunchRequest,
	adjustment: LaunchAdjustment,
	base: LaunchOverrides,
	registry: ModelRegistry,
): LaunchOverrides {
	const plan = applyAdjustment(request, adjustment);
	const model = plan.model
		? resolvePolicyModel(plan.model, registry)
		: undefined;
	return {
		model: model ?? base.model,
		thinkingLevel: plan.thinking ?? base.thinkingLevel,
		tools: { toolNames: plan.toolNames, grants: plan.grants },
	};
}

/**
 * The model and thinking level the launch would run with absent a policy:
 * the door's resolved values (caller over agent, after `locked`), else the
 * agent's own.
 */
function requestedValues(
	facts: LaunchFacts,
	config: AgentConfig,
): { model?: string; thinking?: ThinkingLevel } {
	const model = facts.model
		? `${facts.model.provider}/${facts.model.id}`
		: config.model;
	return { model, thinking: facts.thinkingLevel ?? config.thinking };
}

function resolvePolicyModel(
	input: string,
	registry: ModelRegistry,
): Model<any> | undefined {
	const resolved = resolveModel(input, registry);
	if (typeof resolved !== "string") return resolved;
	debugNote(
		`launch policy: model ${input} not resolved (${resolved}); ignored`,
	);
	return undefined;
}
