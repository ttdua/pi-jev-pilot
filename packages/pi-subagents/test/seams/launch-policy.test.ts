/**
 * Launch policy provider, driven through the real boundaries:
 * `AgentTool.execute` / `SubagentsServiceAdapter.spawn` → `SubagentManager` →
 * `Subagent.run` → `createSubagentSession`. Only the SDK session factory is
 * faked; it echoes the model, thinking level and tools it is given.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTypeRegistry } from "#src/config/agent-types";
import { createChildLifecyclePublisher } from "#src/lifecycle/child-lifecycle";
import { ConcurrencyLimiter } from "#src/lifecycle/concurrency-limiter";
import { createSubagentSession } from "#src/lifecycle/create-subagent-session";
import { SubagentManager } from "#src/lifecycle/subagent-manager";
import { applyAdjustment } from "#src/seams/launch-plan";
import { LaunchPolicySlot, validAdjustment } from "#src/seams/launch-policy";
import { buildLaunchRequest } from "#src/seams/launch-request";
import { AgentTypeCatalog } from "#src/seams/registry";
import type {
	LaunchAdjustment,
	LaunchPolicy,
	LaunchRequest,
} from "#src/service/service";
import {
	SubagentsServiceAdapter,
	toSubagentRecord,
} from "#src/service/service-adapter";
import { resolveModel } from "#src/session/model-resolver";
import { AgentTool } from "#src/tools/agent-tool";
import type { AgentConfig } from "#src/types";
import { makeAgentConfig } from "#test/helpers/make-agent-config";
import { makeModel } from "#test/helpers/make-model";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";
import {
	createFactorySession,
	createSubagentSessionDeps,
	createSubagentSessionIO,
} from "#test/helpers/subagent-session-io";

const FAST = makeModel({ provider: "fixture", id: "fixture-fast" });
const DEEP = makeModel({ provider: "fixture", id: "fixture-deep" });
const MAIN = makeModel({ provider: "fixture", id: "fixture-main" });
const modelRegistry = {
	find: (provider: string, id: string) =>
		[FAST, DEEP, MAIN].find((m) => m.provider === provider && m.id === id),
	getAll: () => [FAST, DEEP, MAIN],
	getAvailable: () => [FAST, DEEP, MAIN],
};
const snapshot = { ...STUB_SNAPSHOT, model: MAIN, modelRegistry };

type Event = { channel: string; data: Record<string, any> };

interface ParentTool {
	name: string;
	sourceInfo: { source: string; origin: "package" | "top-level" };
}

function topLevel(name: string): ParentTool {
	return { name, sourceInfo: { source: "local", origin: "top-level" } };
}

const PARENT_TOOLS = ["read", "bash", "edit", "web_search"].map(topLevel);

function deferred<T = void>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

interface Options {
	agent?: Partial<AgentConfig>;
	maxConcurrent?: number;
	parentTools?: ParentTool[];
	excludedPackages?: string[];
	/** The launch context's parent-tool read throws. */
	parentToolsThrow?: boolean;
	/** Runs inside `bindExtensions`; may hold the launch open. */
	bind?: (index: number) => void | Promise<void>;
}

function harness(options: Options = {}) {
	const events: Event[] = [];
	const registry = new AgentTypeRegistry(
		() =>
			new Map([
				[
					"Explore",
					makeAgentConfig({
						name: "Explore",
						toolNames: ["read"],
						...options.agent,
					}),
				],
			]),
	);
	const io = createSubagentSessionIO();
	let created = 0;
	io.createSession.mockImplementation(
		async (opts: {
			model?: unknown;
			thinkingLevel?: string;
			tools: string[];
		}) => {
			const index = created++;
			const session = createFactorySession();
			Object.assign(session, {
				model: opts.model ?? MAIN,
				thinkingLevel: opts.thinkingLevel ?? "off",
				getAllTools: () =>
					opts.tools.map((name) => ({ name, exposure: "direct" })),
			});
			session.getActiveToolNames.mockImplementation(() => [...opts.tools]);
			session.bindExtensions.mockImplementation(async () =>
				options.bind?.(index),
			);
			return { session };
		},
	);
	const emit = (channel: string, data: unknown) => {
		events.push({ channel, data: data as Record<string, any> });
	};
	const parentTools = options.parentTools ?? PARENT_TOOLS;
	const sessionDeps = {
		...createSubagentSessionDeps({
			io,
			registry,
			listParentToolNames: () => parentTools.map((t) => t.name),
		}),
		lifecycle: createChildLifecyclePublisher(emit),
	};
	const manager = new SubagentManager({
		createSubagentSession: (params) =>
			createSubagentSession(params, sessionDeps),
		baseCwd: "/repo",
		limiter: new ConcurrencyLimiter(() => options.maxConcurrent ?? 4),
		registry,
		launchContext: {
			listParentTools: () => {
				if (options.parentToolsThrow) throw new Error("tools unavailable");
				return parentTools;
			},
			excludedPackages: () => options.excludedPackages ?? [],
		},
	});
	const runtime = {
		currentCtx: { modelRegistry } as never,
		buildSnapshot: () => snapshot,
		getModelInfo: () => ({ parentModel: MAIN, modelRegistry }),
		getSessionInfo: () => ({
			parentSessionFile: "/sessions/p.jsonl",
			parentSessionId: "p1",
		}),
	};
	const service = new SubagentsServiceAdapter(
		manager,
		resolveModel,
		runtime,
		new AgentTypeCatalog(registry),
	);
	const tool = new AgentTool(
		manager,
		runtime,
		{ defaultMaxTurns: undefined, maxConcurrent: 4 },
		registry,
		"/home/user/.pi",
	);
	const call = (
		toolCallId: string,
		params: Record<string, unknown>,
		signal?: AbortSignal,
	) => tool.execute(toolCallId, params, signal, undefined, {} as never);
	const on = (channel: string) => events.filter((e) => e.channel === channel);
	const sessionOpts = (i = 0) =>
		io.createSession.mock.calls[i]![0] as {
			model?: { id: string };
			thinkingLevel?: string;
			tools: string[];
		};
	return { call, on, manager, service, io, sessionOpts };
}

const explore = {
	prompt: "go",
	description: "d",
	subagent_type: "Explore",
	run_in_background: false,
};

/** Register `impl` as the policy (watchdog 10 s unless given) and return its spy. */
function register(
	h: ReturnType<typeof harness>,
	impl: LaunchPolicy = () => undefined,
	timeoutMs = 10_000,
) {
	const policy = vi.fn(impl);
	h.service.registerLaunchPolicy(policy, { timeoutMs });
	return policy;
}

function requestOf(policy: ReturnType<typeof vi.fn>, i = 0): LaunchRequest {
	return policy.mock.calls[i]![0] as LaunchRequest;
}

let warnings: string[];
beforeEach(() => {
	vi.stubEnv("PI_SUBAGENTS_DEBUG", "1");
	warnings = [];
	vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
		warnings.push(args.map(String).join(" "));
	});
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe("one launch policy slot", () => {
	it("refuses a second registration and keeps consulting the first", async () => {
		const h = harness();
		const first = register(h);

		expect(() =>
			h.service.registerLaunchPolicy(() => undefined, { timeoutMs: 10 }),
		).toThrow("launch policy slot is taken");
		await h.call("call_1", explore);

		expect(first).toHaveBeenCalledOnce();
	});

	it("unregister frees the slot for a new policy", async () => {
		const h = harness();
		const first = vi.fn(() => undefined);
		const unregister = h.service.registerLaunchPolicy(first, { timeoutMs: 10 });
		unregister();
		const second = register(h);

		await h.call("call_1", explore);

		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledOnce();
	});

	it("a stale unregister does not remove a later policy", () => {
		const slot = new LaunchPolicySlot();
		const stale = slot.register(() => undefined, { timeoutMs: 10 });
		stale();
		slot.register(() => undefined, { timeoutMs: 10 });
		stale();

		expect(slot.registered).toBe(true);
	});
});

describe("when the policy runs", () => {
	it("tool-call launch consults once, before the session is created", async () => {
		const h = harness();
		const policy = register(h);

		await h.call("call_1", explore);

		expect(policy).toHaveBeenCalledOnce();
		expect(policy.mock.invocationCallOrder[0]).toBeLessThan(
			h.io.createSession.mock.invocationCallOrder[0]!,
		);
	});

	it("service launch returns the id at once and consults before the session", async () => {
		const h = harness();
		const gate = deferred<undefined>();
		const policy = register(h, () => gate.promise);

		const id = h.service.spawn("Explore", "go");

		expect(typeof id).toBe("string");
		await vi.waitFor(() => expect(policy).toHaveBeenCalledOnce());
		expect(h.io.createSession).not.toHaveBeenCalled();
		gate.resolve(undefined);
		await h.manager.getRecord(id)!.promise;
		expect(h.io.createSession).toHaveBeenCalledOnce();
		expect(requestOf(policy).origin).toEqual({ kind: "service" });
	});

	it("queued launch consults policy only at dequeue, with a fresh signal", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
		const release = deferred();
		const firstBinding = deferred();
		const h = harness({
			maxConcurrent: 1,
			bind: (i) => {
				if (i !== 0) return undefined;
				firstBinding.resolve();
				return release.promise;
			},
		});
		const seen: boolean[] = [];
		const policy = register(
			h,
			(_req, signal) => {
				seen.push(signal.aborted);
				return { thinking: "low" };
			},
			50,
		);
		const bg = { kind: "explicit", isBackground: true } as const;
		h.manager.spawn(snapshot, "Explore", "a", {
			description: "a",
			background: bg,
			origin: { kind: "service" },
		});
		const second = h.manager.spawn(snapshot, "Explore", "b", {
			description: "b",
			background: bg,
			origin: { kind: "service" },
		});
		await firstBinding.promise;

		// Queued well past the 50 ms watchdog.
		await vi.advanceTimersByTimeAsync(500);
		expect(policy).toHaveBeenCalledTimes(1);
		expect(h.manager.getRecord(second)?.status).toBe("queued");
		release.resolve();
		await h.manager.getRecord(second)?.promise;

		expect(policy).toHaveBeenCalledTimes(2);
		expect(seen).toEqual([false, false]);
		expect(h.sessionOpts(1).thinkingLevel).toBe("low");
	});

	it("resume does not consult the policy", async () => {
		const h = harness();
		const policy = register(h);
		await h.call("call_1", explore);
		const id = h.manager.listAgents()[0]!.id;

		await h.call("call_2", { ...explore, prompt: "more", resume: id });

		expect(policy).toHaveBeenCalledOnce();
	});

	it("with no policy the launch runs as upstream, disallowed_tools still applied", async () => {
		const h = harness({
			agent: { toolNames: ["read", "bash"], disallowedTools: ["bash"] },
		});

		await h.call("call_1", explore);

		expect(h.sessionOpts().tools).toContain("read");
		expect(h.sessionOpts().tools).not.toContain("bash");
		expect(h.manager.listAgents()[0]!.status).toBe("completed");
	});
});

describe("launch request", () => {
	it("tool-call origin, agent type and requested model", async () => {
		const h = harness();
		const policy = register(h);

		await h.call("call_7", { ...explore, model: "fixture/fixture-main" });

		const request = requestOf(policy);
		expect(request.origin).toEqual({ kind: "tool", toolCallId: "call_7" });
		expect(request.agentType).toBe("Explore");
		expect(request.requested.model).toBe("fixture/fixture-main");
		expect(request).toMatchObject({
			agentId: h.manager.listAgents()[0]!.id,
			parentSessionId: "p1",
			prompt: "go",
			description: "d",
			inheritContext: false,
			isBackground: false,
		});
		expect(request.agent.name).toBe("Explore");
		expect(request.toolSet.declared).toEqual(["read"]);
		expect(request.toolSet.defaults).toEqual(["read"]);
		expect(Object.isFrozen(request)).toBe(true);
		expect(Object.isFrozen(request.toolSet)).toBe(true);
	});

	it("orchestration tools are never offered", async () => {
		const h = harness({
			parentTools: [
				"read",
				"subagent",
				"web_search",
				"get_subagent_result",
				"steer_subagent",
				"ask_parent",
				"notify_parent",
			].map(topLevel),
		});
		const policy = register(h);

		await h.call("call_1", explore);

		expect(requestOf(policy).toolSet.parentTools).toEqual([
			"read",
			"web_search",
		]);
	});

	it("an excluded extension's tool is not offered", async () => {
		const h = harness({
			parentTools: [
				topLevel("read"),
				{
					name: "deploy",
					sourceInfo: { source: "npm:deployer", origin: "package" },
				},
			],
			excludedPackages: ["npm:deployer"],
		});
		const policy = register(h);

		await h.call("call_1", explore);

		expect(requestOf(policy).toolSet.parentTools).toEqual(["read"]);
	});

	it("a locked caller value is not requested", async () => {
		const h = harness({
			agent: { model: "fixture/fixture-deep", locked: ["model"] },
		});
		const policy = register(h);

		await h.call("call_1", { ...explore, model: "fixture/fixture-fast" });

		expect(requestOf(policy).requested.model).toBe("fixture/fixture-deep");
		expect(requestOf(policy).locked).toContain("model");
	});

	it("a service launch requests the locked agent values, and the session runs them", async () => {
		const h = harness({
			agent: {
				model: "fixture/fixture-deep",
				thinking: "high",
				locked: ["model", "thinking"],
			},
		});
		const policy = register(h);

		const id = h.service.spawn("Explore", "go", {
			model: "fixture/fixture-fast",
			thinkingLevel: "low",
			foreground: true,
		});
		await h.manager.getRecord(id)!.promise;

		expect(requestOf(policy).requested).toEqual({
			model: "fixture/fixture-deep",
			thinking: "high",
		});
		expect(requestOf(policy).locked).toEqual(["model", "thinking"]);
		expect(h.sessionOpts().model?.id).toBe("fixture-deep");
		expect(h.sessionOpts().thinkingLevel).toBe("high");
	});

	it("a service launch with no policy keeps upstream precedence: the caller's values win", async () => {
		const h = harness({
			agent: {
				model: "fixture/fixture-deep",
				thinking: "high",
				locked: ["model", "thinking"],
			},
		});

		const id = h.service.spawn("Explore", "go", {
			model: "fixture/fixture-fast",
			thinkingLevel: "low",
			foreground: true,
		});
		await h.manager.getRecord(id)?.promise;

		expect(h.sessionOpts().model?.id).toBe("fixture-fast");
		expect(h.sessionOpts().thinkingLevel).toBe("low");
	});

	it("a rewritten model and thinking are the effective facts everywhere", async () => {
		const h = harness();
		register(h, () => ({ model: "fixture/fixture-fast", thinking: "medium" }));

		await h.call("call_1", { ...explore, model: "fixture/fixture-main" });

		const expected = {
			effectiveModel: "fixture/fixture-fast",
			effectiveThinking: "medium",
		};
		expect(h.on("subagents:child:session-created")[0]?.data).toMatchObject(
			expected,
		);
		const record = h.manager.listAgents()[0]!;
		expect(toSubagentRecord(h.manager.getRecord(record.id)!)).toMatchObject(
			expected,
		);
		expect(h.sessionOpts().model?.id).toBe("fixture-fast");
		expect(h.sessionOpts().thinkingLevel).toBe("medium");
	});
});

describe("applying the adjustment", () => {
	it("model and thinking are applied", async () => {
		const h = harness();
		register(h, () => ({ model: "fixture/fixture-fast", thinking: "low" }));

		await h.call("call_1", explore);

		expect(h.sessionOpts().model?.id).toBe("fixture-fast");
		expect(h.sessionOpts().thinkingLevel).toBe("low");
	});

	it("policy-changed thinking is the record's thinking", async () => {
		const h = harness();
		register(h, () => ({ thinking: "low" }));

		await h.call("call_1", { ...explore, thinking: "high" });

		expect(h.manager.listAgents()[0]!.thinkingLevel).toBe("low");
	});

	it("a locked field is kept, with a debug note", async () => {
		const h = harness({ agent: { thinking: "high", locked: ["thinking"] } });
		register(h, () => ({ thinking: "max" }));

		await h.call("call_1", explore);

		expect(h.sessionOpts().thinkingLevel).toBe("high");
		expect(warnings.some((w) => w.includes("thinking"))).toBe(true);
	});

	it("an extension tool is granted", async () => {
		const h = harness({
			agent: { toolNames: undefined, toolsDeclared: false },
		});
		register(h, () => ({ addTools: ["web_search"] }));

		await h.call("call_1", explore);

		expect(h.sessionOpts().tools).toContain("web_search");
		expect(h.on("subagents:child:bound")[0]?.data.grantedTools).toEqual([
			"web_search",
		]);
	});

	it("a declared tool is not removable", async () => {
		const h = harness({ agent: { toolNames: ["read", "edit"] } });
		register(h, () => ({ removeTools: ["edit"] }));

		await h.call("call_1", explore);

		expect(h.sessionOpts().tools).toContain("edit");
		expect(warnings.some((w) => w.includes("edit"))).toBe(true);
	});

	it("a tool declared through an MCP wildcard is not removable", async () => {
		const h = harness({
			agent: { toolNames: ["read", "mcp__github__*"] },
			parentTools: ["read", "mcp__github__issues"].map(topLevel),
		});
		const policy = register(h, () => ({
			removeTools: ["mcp__github__issues"],
		}));

		await h.call("call_1", explore);

		expect(h.sessionOpts().tools).toContain("mcp__github__issues");
		expect(requestOf(policy).toolSet.declared).toEqual([
			"read",
			"mcp__github__*",
		]);
	});

	it("a default tool is removed", async () => {
		const h = harness({
			agent: { toolNames: undefined, toolsDeclared: false },
		});
		register(h, () => ({ removeTools: ["bash"] }));

		await h.call("call_1", explore);

		expect(h.sessionOpts().tools).not.toContain("bash");
		expect(h.sessionOpts().tools).toContain("read");
	});

	it("a grant outside the parent's tools is dropped", async () => {
		const h = harness();
		register(h, () => ({ addTools: ["not_registered"] }));

		await h.call("call_1", explore);

		expect(h.sessionOpts().tools).not.toContain("not_registered");
		expect(h.manager.listAgents()[0]!.status).toBe("completed");
		expect(warnings.some((w) => w.includes("not_registered"))).toBe(true);
	});

	it("a tool the child already has is not reported as granted", async () => {
		const h = harness();
		register(h, () => ({ addTools: ["read"] }));

		await h.call("call_1", explore);

		expect(h.on("subagents:child:bound")[0]?.data.grantedTools).toEqual([]);
	});

	it("a disallowed tool cannot be granted", async () => {
		const h = harness({ agent: { disallowedTools: ["web_search"] } });
		register(h, () => ({ addTools: ["web_search"] }));

		await h.call("call_1", explore);

		expect(h.sessionOpts().tools).not.toContain("web_search");
	});
});

describe("the plan's accepted removals", () => {
	function planFor(config: Partial<AgentConfig>, removeTools: string[]) {
		const request = buildLaunchRequest({
			agentId: "a1",
			agentType: "Explore",
			config: makeAgentConfig({ name: "Explore", ...config }),
			origin: { kind: "service" },
			prompt: "p",
			description: "d",
			requested: {},
			inheritContext: false,
			isBackground: false,
			parentTools: ["read", "edit", "web_search"].map(topLevel),
			excludedPackages: [],
		});
		return applyAdjustment(request, { removeTools });
	}

	it("lists an accepted removal of a default", () => {
		const plan = planFor(
			{ toolNames: undefined, toolsDeclared: false },
			["edit"],
		);
		expect(plan.removed).toEqual(["edit"]);
	});

	it("does not list a refused removal", () => {
		const plan = planFor({ toolNames: ["read", "edit"] }, ["edit"]);
		expect(plan.removed).toEqual([]);
	});

	it("does not list a removal outside the defaults", () => {
		const plan = planFor(
			{ toolNames: undefined, toolsDeclared: false },
			["web_search"],
		);
		expect(plan.removed).toEqual([]);
	});
});

describe("the policy fails open", () => {
	it("a throwing policy leaves the requested values", async () => {
		const h = harness();
		register(h, () => {
			throw new Error("boom");
		});

		await h.call("call_1", {
			...explore,
			model: "fixture/fixture-deep",
			thinking: "medium",
		});

		expect(h.sessionOpts().model?.id).toBe("fixture-deep");
		expect(h.sessionOpts().thinkingLevel).toBe("medium");
		expect(h.sessionOpts().tools).toEqual([
			"read",
			"ask_parent",
			"notify_parent",
		]);
	});

	it("a rejecting policy leaves the requested values", async () => {
		const h = harness();
		register(h, async () => {
			throw new Error("boom");
		});

		await h.call("call_1", { ...explore, model: "fixture/fixture-deep" });

		expect(h.sessionOpts().model?.id).toBe("fixture-deep");
	});

	it("a slow policy is cut at timeoutMs and its signal aborted", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
		const h = harness();
		const called = deferred();
		let policySignal!: AbortSignal;
		register(
			h,
			(_req, signal) => {
				policySignal = signal;
				called.resolve();
				return new Promise((r) =>
					setTimeout(() => r({ thinking: "low" }), 1000),
				);
			},
			200,
		);

		const result = h.call("call_1", { ...explore, thinking: "medium" });
		await called.promise;
		await vi.advanceTimersByTimeAsync(199);
		expect(h.io.createSession).not.toHaveBeenCalled();
		expect(policySignal.aborted).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		await result;

		expect(h.io.createSession).toHaveBeenCalledOnce();
		expect(policySignal.aborted).toBe(true);
		expect(h.sessionOpts().thinkingLevel).toBe("medium");
	});

	it("a failure building the request leaves the launch unchanged", async () => {
		const h = harness({ parentToolsThrow: true });
		const policy = register(h, () => ({ thinking: "low" }));

		await h.call("call_1", { ...explore, thinking: "medium" });

		expect(policy).not.toHaveBeenCalled();
		expect(h.sessionOpts().thinkingLevel).toBe("medium");
		expect(h.manager.listAgents()[0]!.status).toBe("completed");
	});

	it("a malformed adjustment leaves the requested values", async () => {
		const h = harness();
		register(h, () => ({ model: 42 }) as never);

		await h.call("call_1", { ...explore, model: "fixture/fixture-deep" });

		expect(h.sessionOpts().model?.id).toBe("fixture-deep");
	});

	it("cancelling while the policy runs stops the launch before its session", async () => {
		const h = harness();
		let policySignal!: AbortSignal;
		register(h, (_req, signal) => {
			policySignal = signal;
			return new Promise<undefined>(() => {});
		});
		const controller = new AbortController();

		const result = h.call("call_1", explore, controller.signal);
		await vi.waitFor(() => expect(policySignal).toBeDefined());
		controller.abort();
		expect(policySignal.aborted).toBe(true);
		await result;

		expect(h.manager.listAgents()[0]!.status).toBe("stopped");
		expect(h.io.createSession).not.toHaveBeenCalled();
		expect(h.on("subagents:child:session-created")).toEqual([]);
	});
});

describe("consult after the guard aborts", () => {
	const request = {} as LaunchRequest;

	it("discards an adjustment the policy resolves from its abort handler", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const slot = new LaunchPolicySlot();
		const called = deferred();
		slot.register(
			(_req, signal) =>
				new Promise((resolve) => {
					signal.addEventListener("abort", () => resolve({ thinking: "low" }));
					called.resolve();
				}),
			{ timeoutMs: 5 },
		);

		const consulted = slot.consult(request);
		await called.promise;
		await vi.advanceTimersByTimeAsync(5);

		expect(await consulted).toBeUndefined();
	});

	it.each([
		[
			"a throwing getter",
			() =>
				Object.defineProperty({}, "model", {
					enumerable: true,
					get() {
						throw new Error("bad accessor");
					},
				}),
		],
		[
			"a throwing Proxy",
			() =>
				new Proxy(
					{},
					{
						// `then` reads as absent, so the value reaches validation.
						get(_target, key) {
							if (key === "then") return undefined;
							throw new Error("bad proxy");
						},
					},
				),
		],
	])(
		"an adjustment with %s fails open and aborts the policy signal",
		async (_label, make) => {
			const slot = new LaunchPolicySlot();
			let policySignal!: AbortSignal;
			slot.register(
				(_req, signal) => {
					policySignal = signal;
					return make() as LaunchAdjustment;
				},
				{ timeoutMs: 10_000 },
			);

			await expect(slot.consult(request)).resolves.toBeUndefined();
			expect(policySignal.aborted).toBe(true);
		},
	);

	it("discards an adjustment resolved when the run is cancelled", async () => {
		const slot = new LaunchPolicySlot();
		const run = new AbortController();
		slot.register(
			(_req, signal) =>
				new Promise((resolve) => {
					signal.addEventListener("abort", () => resolve({ thinking: "low" }));
					run.abort();
				}),
			{ timeoutMs: 10_000 },
		);

		expect(await slot.consult(request, run.signal)).toBeUndefined();
	});

	it.each([
		["throws", "sync"],
		["rejects", "async"],
	] as const)(
		"a policy that cancels the run then %s leaves no unhandled rejection",
		async (_label, mode) => {
			const unhandled: unknown[] = [];
			const onUnhandled = (reason: unknown) => unhandled.push(reason);
			process.on("unhandledRejection", onUnhandled);
			try {
				const slot = new LaunchPolicySlot();
				const run = new AbortController();
				slot.register(
					(() => {
						run.abort();
						if (mode === "sync") throw new Error("boom");
						return Promise.reject(new Error("boom"));
					}) as LaunchPolicy,
					{ timeoutMs: 10_000 },
				);

				expect(await slot.consult(request, run.signal)).toBeUndefined();
				await new Promise((r) => setImmediate(r));
				await new Promise((r) => setImmediate(r));
				expect(unhandled).toEqual([]);
			} finally {
				process.off("unhandledRejection", onUnhandled);
			}
		},
	);

	it("a run already cancelled before consult leaves no unhandled rejection", async () => {
		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => unhandled.push(reason);
		process.on("unhandledRejection", onUnhandled);
		try {
			const slot = new LaunchPolicySlot();
			const run = new AbortController();
			run.abort();
			slot.register(() => Promise.reject(new Error("boom")), {
				timeoutMs: 10_000,
			});

			expect(await slot.consult(request, run.signal)).toBeUndefined();
			await new Promise((r) => setImmediate(r));
			await new Promise((r) => setImmediate(r));
			expect(unhandled).toEqual([]);
		} finally {
			process.off("unhandledRejection", onUnhandled);
		}
	});
});

describe("validAdjustment", () => {
	it.each([
		[undefined, undefined],
		[null, undefined],
		[42, undefined],
		[{ model: 42 }, undefined],
		[{ thinking: "huge" }, undefined],
		[{ addTools: "web_search" }, undefined],
		[{ removeTools: [1] }, undefined],
	])("rejects %j", (value, expected) => {
		expect(validAdjustment(value)).toBe(expected);
	});

	it("accepts a well-formed adjustment", () => {
		const value: LaunchAdjustment = {
			model: "fixture/fixture-fast",
			thinking: "low",
			addTools: ["web_search"],
			removeTools: ["bash"],
		};

		expect(validAdjustment(value)).toEqual(value);
	});
});
