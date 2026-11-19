/**
 * Launch resources, driven through the real boundaries:
 * `SubagentsServiceAdapter.spawn` / `AgentTool.execute` → `SubagentManager` →
 * `Subagent.run` → a recording `createSubagentSession`. Only the SDK session is faked.
 */
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	expectTypeOf,
	it,
	vi,
} from "vitest";
import { createChildLifecyclePublisher } from "#src/lifecycle/child-lifecycle";
import { ConcurrencyLimiter } from "#src/lifecycle/concurrency-limiter";
import {
	type CreateSubagentSessionParams,
	createSubagentSession,
} from "#src/lifecycle/create-subagent-session";
import type { ParentSnapshot } from "#src/lifecycle/parent-snapshot";
import { SubagentManager } from "#src/lifecycle/subagent-manager";
import { resetChildSessions } from "#src/seams/child-sessions";
import { effectiveSkillChoice } from "#src/seams/launch-resources";
import { AgentTypeCatalog } from "#src/seams/registry";
import type {
	LaunchRequest,
	ResumeOptions,
	SpawnOptions,
} from "#src/service/service";
import { SubagentsServiceAdapter } from "#src/service/service-adapter";
import { resolveModel } from "#src/session/model-resolver";
import { AgentTool } from "#src/tools/agent-tool";
import { makeAgentConfig } from "#test/helpers/make-agent-config";
import { makeModel } from "#test/helpers/make-model";
import { registryWithGeneral } from "#test/helpers/make-registry";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";
import {
	createFactorySession,
	createSubagentSessionDeps,
	createSubagentSessionIO,
} from "#test/helpers/subagent-session-io";

const MAIN = makeModel({ provider: "fixture", id: "fixture-main" });
const modelRegistry = {
	find: (_p: string, _i: string) => MAIN,
	getAll: () => [MAIN],
	getAvailable: () => [MAIN],
};

let root: string;
const harnesses: { manager: SubagentManager }[] = [];

function skill(dir: string, name: string): string {
	mkdirSync(dir, { recursive: true });
	const file = join(dir, "SKILL.md");
	writeFileSync(
		file,
		`---\nname: ${name}\ndescription: does ${name}\n---\nBody\n`,
	);
	return file;
}
function dir(name: string): string {
	const d = join(root, name);
	mkdirSync(d, { recursive: true });
	return d;
}

interface Options {
	maxConcurrent?: number;
	branch?: boolean;
	/** When set, the first factory call waits for it. */
	hold?: Promise<void>;
	withPackageTool?: boolean;
}

function harness(options: Options = {}) {
	const snapshot: ParentSnapshot = {
		...STUB_SNAPSHOT,
		model: MAIN,
		modelRegistry,
		branch: options.branch ? [{ type: "message", id: "e1" } as never] : [],
	};
	const events: { channel: string; data: Record<string, any> }[] = [];
	const registry = registryWithGeneral(
		() =>
			new Map([
				[
					"Explore",
					makeAgentConfig({
						name: "Explore",
						toolNames: ["read"],
						runInBackground: true,
					}),
				],
				[
					"Pinned",
					makeAgentConfig({
						name: "Pinned",
						toolNames: ["read"],
						inheritSkills: false,
						runInBackground: false,
					}),
				],
				[
					"LockedFork",
					makeAgentConfig({
						name: "LockedFork",
						toolNames: ["read"],
						context: "fork",
						locked: true,
						runInBackground: false,
					}),
				],
				[
					"AgentFork",
					makeAgentConfig({
						name: "AgentFork",
						toolNames: ["read"],
						context: "fork",
						runInBackground: false,
					}),
				],
				[
					"PinnedFork",
					makeAgentConfig({
						name: "PinnedFork",
						toolNames: ["read"],
						context: "fork",
						inheritSkills: false,
						runInBackground: false,
					}),
				],
			]),
	);
	const io = createSubagentSessionIO();
	let n = 0;
	io.createSessionManager.mockImplementation(() => {
		const id = `child-${Date.now()}-${++n}`;
		return {
			newSession: vi.fn(),
			getSessionFile: vi.fn().mockReturnValue(`/sessions/${id}.jsonl`),
			getSessionId: vi.fn().mockReturnValue(id),
		};
	});
	io.createSession.mockImplementation(async () => {
		const session = createFactorySession();
		Object.assign(session, { model: MAIN, thinkingLevel: "off" });
		return { session };
	});
	const emit = (channel: string, data: unknown) =>
		events.push({ channel, data: data as Record<string, any> });
	const sessionDeps = {
		...createSubagentSessionDeps({
			io,
			registry,
			listParentToolNames: () => ["read"],
		}),
		lifecycle: createChildLifecyclePublisher(emit),
	};
	const calls: CreateSubagentSessionParams[] = [];
	let first = true;
	const factory = vi.fn(async (params: CreateSubagentSessionParams) => {
		calls.push(params);
		if (first && options.hold) {
			first = false;
			await options.hold;
		}
		return createSubagentSession(params, sessionDeps);
	});
	const manager = new SubagentManager({
		createSubagentSession: factory,
		baseCwd: "/repo",
		limiter: new ConcurrencyLimiter(() => options.maxConcurrent ?? 4),
		registry,
		launchContext: {
			listParentTools: () => [
				{ name: "read", sourceInfo: { source: "local", origin: "top-level" } },
				...(options.withPackageTool
					? [
							{
								name: "pack_tool",
								sourceInfo: { source: "npm:flow-pack", origin: "package" },
							},
						]
					: []),
				...(options.withPackageTool
					? [
							{
								name: "sib_tool",
								sourceInfo: { source: "npm:sibling", origin: "package" },
							},
						]
					: []),
			],
			excludedPackages: () => [],
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
	const h = {
		service,
		manager,
		events,
		calls,
		factory,
		io,
		call: (params: Record<string, unknown>) =>
			tool.execute("call_1", params, undefined, undefined, {} as never),
		on: (channel: string) => events.filter((e) => e.channel === channel),
		async run(type: string, options?: SpawnOptions): Promise<string> {
			const id = service.spawn(type, "go", { foreground: true, ...options });
			await manager.getRecord(id)!.promise;
			return id;
		},
		tool,
	};
	harnesses.push(h);
	return h;
}

beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "launch-res-flow-")));
	vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
	await Promise.all(harnesses.splice(0).map((h) => h.manager.dispose()));
	resetChildSessions();
	vi.restoreAllMocks();
	rmSync(root, { recursive: true, force: true });
});

describe("refusal at spawn", () => {
	it.each([
		["a missing cwd", () => ({ cwd: join(root, "missing") })],
		[
			"a missing skill path",
			() => ({ skills: { inherit: false, paths: [join(root, "nope")] } }),
		],
	])("refusal leaves nothing: %s", (_name, make) => {
		const h = harness();
		const policy = vi.fn();
		h.service.registerLaunchPolicy(policy, { timeoutMs: 10_000 });
		expect(() => h.service.spawn("Explore", "go", make())).toThrow();
		expect(h.service.listAgents()).toEqual([]);
		expect(h.events.filter((e) => e.channel.startsWith("subagents:"))).toEqual(
			[],
		);
		expect(policy).not.toHaveBeenCalled();
		expect(h.factory).not.toHaveBeenCalled();
	});
});

describe("run start", () => {
	it("no-provider timing kept", () => {
		const h = harness();
		h.service.spawn("Explore", "go", { foreground: true });
		expect(h.factory).toHaveBeenCalledOnce();
	});

	it("cwd without a provider", async () => {
		const h = harness();
		const u1 = dir("u1");
		await h.run("Explore", { cwd: u1 });
		expect(h.calls[0]!.cwd).toBe(u1);
		expect(h.on("subagents:child:session-created")[0]!.data.cwd).toBe(u1);
	});

	it("provider sees the request", async () => {
		const h = harness();
		const prepare = vi.fn(async () => undefined);
		h.service.registerWorkspaceProvider({ prepare });
		const u1 = dir("u1");
		await h.run("Explore", { cwd: u1, metadata: { change: "c1" } });
		expect(prepare).toHaveBeenCalledWith(
			expect.objectContaining({ requestedCwd: u1, metadata: { change: "c1" } }),
		);
	});

	it("provider ctx omits what the launch lacks", async () => {
		const h = harness();
		const prepare = vi.fn(async () => undefined);
		h.service.registerWorkspaceProvider({ prepare });
		await h.run("Explore");
		const ctx = (prepare.mock.calls[0] as unknown[])[0] as Record<
			string,
			unknown
		>;
		expect(ctx).not.toHaveProperty("requestedCwd");
		expect(ctx).not.toHaveProperty("metadata");
	});

	it("provider returns nothing", async () => {
		const h = harness();
		h.service.registerWorkspaceProvider({ prepare: async () => undefined });
		const u1 = dir("u1");
		await h.run("Explore", { cwd: u1 });
		expect(h.calls[0]!.cwd).toBe(u1);
	});

	it("provider refuses", async () => {
		const h = harness();
		h.service.registerWorkspaceProvider({
			prepare: async () => {
				throw new Error("no room");
			},
		});
		const id = await h.run("Explore", { cwd: dir("u1") });
		expect(h.service.getRecord(id)?.status).toBe("error");
		expect(h.factory).not.toHaveBeenCalled();
	});

	it("provider wrap is reported", async () => {
		const h = harness();
		const wrapped = dir("wrapped");
		h.service.registerWorkspaceProvider({
			prepare: async () => ({ cwd: wrapped, dispose: () => undefined }),
		});
		await h.run("Explore", { cwd: dir("u1") });
		expect(h.calls[0]!.cwd).toBe(wrapped);
		expect(h.on("subagents:child:session-created")[0]!.data.cwd).toBe(wrapped);
	});

	it("policy cannot change resources", async () => {
		const h = harness();
		const u1 = dir("u1");
		h.service.registerLaunchPolicy(
			() =>
				({
					model: "fixture/fixture-main",
					cwd: "/tmp",
					skills: { inherit: false },
				}) as never,
			{ timeoutMs: 10_000 },
		);
		await h.run("Explore", { cwd: u1 });
		expect(h.calls[0]!.cwd).toBe(u1);
		expect(h.calls[0]!.model).toBe(MAIN);
		expect(h.calls[0]!.resources?.skills).toBeUndefined();
	});

	it("launch-excluded tool not offered", async () => {
		const requests: LaunchRequest[] = [];
		const h = harness({ withPackageTool: true });
		h.service.registerLaunchPolicy(
			(r) => {
				requests.push(r);
				return undefined;
			},
			{ timeoutMs: 10_000 },
		);
		await h.run("Explore", { excludeExtensionPackages: ["npm:flow-pack"] });
		await h.run("Explore");
		expect(requests[0]!.toolSet.parentTools).not.toContain("pack_tool");
		expect(requests[0]!.toolSet.parentTools).toContain("sib_tool");
		expect(requests[1]!.toolSet.parentTools).toContain("pack_tool");
	});

	it("resume does not reapply", async () => {
		const h = harness();
		const id = await h.run("Explore", { cwd: dir("u1") });
		const before = h.factory.mock.calls.length;
		await h.service.resume(id, "more");
		expect(h.factory.mock.calls.length).toBe(before);
	});
});

describe("queued launches", () => {
	async function queued(setup: (second: string) => void | Promise<void>) {
		let release!: () => void;
		const hold = new Promise<void>((r) => {
			release = r;
		});
		const h = harness({ maxConcurrent: 1, hold });
		const policy = vi.fn(() => undefined);
		const first = h.service.spawn("Explore", "one");
		expect(h.service.getRecord(first)?.status).not.toBe("queued");
		return { h, release, first, policy };
	}

	it("queued launch keeps its frozen resources", async () => {
		const { h, release } = await queued(() => undefined);
		const a = skill(dir("sa"), "a");
		const paths = [a];
		h.service.spawn("Explore", "one");
		const second = h.service.spawn("Explore", "two", {
			skills: { inherit: false, paths },
		});
		expect(h.service.getRecord(second)?.status).toBe("queued");
		paths.push(join(root, "evil"));
		release();
		await h.manager.getRecord(second)!.promise;
		const resources = h.calls.at(-1)!.resources!;
		expect(resources.skills?.paths).toEqual([a]);
		expect(Object.isFrozen(resources)).toBe(true);
	});

	it.each([
		["skill removed while queued", (file: string) => rmSync(file)],
		[
			"skill turned invalid while queued",
			(file: string) => writeFileSync(file, "---\nname: a\n---\nBody\n"),
		],
	])("%s", async (_name, damage) => {
		const { h, release } = await queued(() => undefined);
		const file = skill(dir("sa"), "a");
		h.service.spawn("Explore", "one");
		const policy = vi.fn(() => undefined);
		h.service.registerLaunchPolicy(policy, { timeoutMs: 10_000 });
		const second = h.service.spawn("Explore", "two", {
			skills: { inherit: false, paths: [file] },
		});
		damage(file);
		release();
		await h.manager.getRecord(second)!.promise;
		const record = h.service.getRecord(second)!;
		expect(record.status).toBe("error");
		expect(record.error).toContain("Launch resources no longer valid:");
		expect(record.error).toContain("SKILL.md");
		expect(h.calls.filter((c) => c.agentId === second)).toEqual([]);
	});

	it("worktree removed while queued", async () => {
		const { h, release } = await queued(() => undefined);
		const wt = dir("wt");
		h.service.spawn("Explore", "one");
		const prepare = vi.fn(async () => undefined);
		h.service.registerWorkspaceProvider({ prepare });
		const second = h.service.spawn("Explore", "two", { cwd: wt });
		rmSync(wt, { recursive: true });
		const callsBefore = h.calls.length;
		prepare.mockClear();
		release();
		await h.manager.getRecord(second)!.promise;
		const record = h.service.getRecord(second)!;
		expect(record.status).toBe("error");
		expect(record.error).toContain("Launch resources no longer valid:");
		expect(record.error).toContain(wt);
		expect(prepare).not.toHaveBeenCalledWith(
			expect.objectContaining({ requestedCwd: wt }),
		);
		expect(h.calls.slice(callsBefore).some((c) => c.agentId === second)).toBe(
			false,
		);
	});
});

describe("pins and fork", () => {
	it("pin reaches the factory", async () => {
		const h = harness();
		const p = skill(dir("sp"), "p");
		await h.run("Pinned", { skills: { inherit: true, paths: [p] } });
		const params = h.calls[0]!;
		expect(params.type).toBe("Pinned");
		expect(effectiveSkillChoice(params.resources, true)?.inherit).toBe(false);
	});

	it.each([
		[
			"caller fork with a branch and cwd",
			"Explore",
			{ context: "fork" as const, cwd: "CWD" },
			/fresh launches only: cwd/,
		],
		[
			"caller fork with a branch and contextFiles",
			"Explore",
			{ context: "fork" as const, contextFiles: true },
			/fresh launches only: contextFiles/,
		],
		[
			"locked fork with a branch and skills",
			"LockedFork",
			{ skills: { inherit: true } },
			/fresh launches only: skills/,
		],
		[
			"pinned agent fork",
			"PinnedFork",
			{},
			/pins inherit_skills: false and cannot fork/,
		],
	])("refuses: %s", (_name, type, opts, message) => {
		const h = harness({ branch: true });
		const o = JSON.parse(JSON.stringify(opts).replace("CWD", root));
		expect(() => h.service.spawn(type, "go", o)).toThrow(message);
		expect(h.service.listAgents()).toEqual([]);
	});

	it.each([
		["unlocked agent fork without a branch and cwd", "AgentFork"],
		["locked agent fork without a branch and cwd", "LockedFork"],
	])("fresh-only after fallback: %s", async (_name, type) => {
		const h = harness({ branch: false });
		const u1 = dir("u1");
		const id = await h.run(type, { cwd: u1 });
		const record = h.manager.getRecord(id)!;
		expect(record.context).toBe("fresh");
		expect(record.contextFallback).toBe("no-parent-session");
		expect(h.calls[0]!.cwd).toBe(u1);
	});

	it("a pinned agent fork without a branch runs fresh with the pin", async () => {
		const h = harness({ branch: false });
		const id = await h.run("PinnedFork");
		expect(h.manager.getRecord(id)!.context).toBe("fresh");
		expect(h.calls[0]!.type).toBe("PinnedFork");
		expect(h.on("subagents:child:session-created")[0]!.data.inheritSkills).toBe(
			false,
		);
	});

	it("pinned agent forked from the tool", async () => {
		const h = harness({ branch: true });
		const result = (await h.call({
			prompt: "go",
			description: "d",
			subagent_type: "Pinned",
			context: "fork",
			run_in_background: false,
		})) as {
			content: { text: string }[];
		};
		expect(result.content[0]!.text).toContain(
			"pins inherit_skills: false and cannot fork",
		);
		expect(h.manager.listAgents()).toEqual([]);
	});

	it("pinned agent from the tool reaches the factory", async () => {
		const h = harness();
		await h.call({
			prompt: "go",
			description: "d",
			subagent_type: "Pinned",
			run_in_background: false,
		});
		expect(h.calls[0]!.resources).toBeUndefined();
		expect(h.calls[0]!.type).toBe("Pinned");
	});
});

describe("public surface", () => {
	it("ResumeOptions has no cwd", () => {
		// @ts-expect-error resources are not a resume option
		expectTypeOf<ResumeOptions["cwd"]>().toBeString();
		expectTypeOf<ResumeOptions>().not.toHaveProperty("skills");
	});

	it("the subagent tool schema carries no launch resources", () => {
		const h = harness();
		const keys = Object.keys(
			(
				h.tool.toToolDefinition().parameters as unknown as {
					properties: object;
				}
			).properties,
		);
		for (const k of [
			"skills",
			"excludeExtensionPackages",
			"cwd",
			"contextFiles",
		])
			expect(keys).not.toContain(k);
		expect(keys).toContain("prompt");
	});
});
