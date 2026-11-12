/**
 * Launch identity and effective facts, driven through the real boundaries:
 * `AgentTool.execute` → `SubagentManager` → `createSubagentSession` →
 * lifecycle publisher / events observer / service snapshot. Only the SDK
 * session factory is faked, and it echoes the model and thinking level it is
 * given, as `createAgentSession` does.
 */
import { describe, expect, it } from "vitest";
import { AgentTypeRegistry } from "#src/config/agent-types";
import { createChildLifecyclePublisher } from "#src/lifecycle/child-lifecycle";
import { ConcurrencyLimiter } from "#src/lifecycle/concurrency-limiter";
import { createSubagentSession } from "#src/lifecycle/create-subagent-session";
import { SubagentManager } from "#src/lifecycle/subagent-manager";
import { CompositeSubagentObserver } from "#src/observation/composite-subagent-observer";
import { SubagentEventsObserver } from "#src/observation/subagent-events-observer";
import { toSubagentRecord } from "#src/service/service-adapter";
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

function agents(extra: Partial<AgentConfig> = {}) {
	return new AgentTypeRegistry(
		() =>
			new Map([
				[
					"Explore",
					makeAgentConfig({ name: "Explore", toolNames: ["read"], ...extra }),
				],
			]),
	);
}

interface Options {
	agent?: Partial<AgentConfig>;
	/** Background concurrency limit; 0 keeps every background launch queued. */
	maxConcurrent?: number;
	/** Runs inside `bindExtensions`, after `session-created` has been emitted. */
	bind?: (
		session: ReturnType<typeof createFactorySession>,
	) => void | Promise<void>;
}

function harness(options: Options = {}) {
	const events: Event[] = [];
	const recordsSeenInCreated: unknown[] = [];
	const registry = agents(options.agent);
	const io = createSubagentSessionIO();
	io.createSession.mockImplementation(
		async (opts: { model?: unknown; thinkingLevel?: string }) => {
			const session = createFactorySession();
			Object.assign(session, {
				model: opts.model ?? MAIN,
				thinkingLevel: opts.thinkingLevel ?? "off",
			});
			session.bindExtensions.mockImplementation(async () =>
				options.bind?.(session),
			);
			return { session };
		},
	);

	// `manager` is assigned below; the lifecycle emit only runs after that.
	let manager!: SubagentManager;
	const emit = (channel: string, data: unknown) => {
		const event = { channel, data: data as Record<string, any> };
		events.push(event);
		if (channel === "subagents:child:session-created") {
			const record = manager.getRecord(event.data.agentId);
			recordsSeenInCreated.push(record ? toSubagentRecord(record) : undefined);
		}
	};
	const deps = createSubagentSessionDeps({
		io,
		registry,
		// The parent registers read and bash; the child keeps read, grep and edit.
		listParentToolNames: () => ["read", "bash"],
	});
	const sessionDeps = {
		...deps,
		lifecycle: createChildLifecyclePublisher(emit),
	};
	const observer = new CompositeSubagentObserver([
		new SubagentEventsObserver({
			emit,
			appendEntry: () => undefined,
			notifications: {
				sendCompletion: () => undefined,
				sendUpdate: () => undefined,
				sendWorkspaceNotice: () => undefined,
				dispose: () => undefined,
			},
		}),
	]);
	manager = new SubagentManager({
		createSubagentSession: (params) =>
			createSubagentSession(params, sessionDeps),
		baseCwd: "/repo",
		observer,
		limiter: new ConcurrencyLimiter(() => options.maxConcurrent ?? 4),
		registry,
	});
	const tool = new AgentTool(
		manager,
		{
			buildSnapshot: () => snapshot,
			getModelInfo: () => ({ parentModel: MAIN, modelRegistry }),
			getSessionInfo: () => ({
				parentSessionFile: "/sessions/p.jsonl",
				parentSessionId: "p1",
			}),
		},
		{ defaultMaxTurns: undefined, maxConcurrent: 4 },
		registry,
		"/home/user/.pi",
	);
	const call = (toolCallId: string, params: Record<string, unknown>) =>
		tool.execute(toolCallId, params, undefined, undefined, {} as never);
	const on = (channel: string) => events.filter((e) => e.channel === channel);
	return { call, events, on, manager, recordsSeenInCreated };
}

const explore = {
	prompt: "go",
	description: "d",
	subagent_type: "Explore",
	run_in_background: false,
};

describe("launch identity on child events", () => {
	it("tool-call launch names agent, type and tool call", async () => {
		const h = harness();

		await h.call("call_1", explore);

		const id = h.manager.listAgents()[0]!.id;
		for (const channel of [
			"subagents:child:spawning",
			"subagents:child:session-created",
			"subagents:child:bound",
		]) {
			expect(h.on(channel)[0]?.data).toMatchObject({
				agentId: id,
				agentType: "Explore",
				toolCallId: "call_1",
			});
		}
		expect(h.on("subagents:child:session-created")[0]?.data.sessionId).toBe(
			"child-session-id",
		);
	});

	it("service launch omits toolCallId", async () => {
		const h = harness();

		const id = h.manager.spawn(snapshot, "Explore", "go", {
			origin: { kind: "service" },
			description: "d",
			background: { kind: "explicit", isBackground: false },
		});
		await h.manager.getRecord(id)!.promise;

		const created = h.on("subagents:child:session-created")[0]!.data;
		expect(created).toMatchObject({ agentId: id, agentType: "Explore" });
		expect(created).not.toHaveProperty("toolCallId");
		for (const channel of [
			"subagents:created",
			"subagents:started",
			"subagents:completed",
		]) {
			for (const e of h.on(channel))
				expect(e.data).not.toHaveProperty("toolCallId");
		}
	});

	it("completion carries the launching tool call", async () => {
		const h = harness();

		await h.call("call_2", explore);

		expect(h.on("subagents:completed")[0]?.data).toMatchObject({
			toolCallId: "call_2",
		});
		expect(h.on("subagents:started")[0]?.data).toMatchObject({
			toolCallId: "call_2",
		});
	});

	it("resume carries the resuming call, not the spawning one", async () => {
		const h = harness();
		await h.call("call_1", explore);
		const id = h.manager.listAgents()[0]!.id;

		await h.call("call_3", {
			prompt: "more",
			description: "d",
			subagent_type: "Explore",
			resume: id,
		});

		expect(h.on("subagents:resuming")[0]?.data).toMatchObject({
			id,
			toolCallId: "call_3",
		});
		expect(h.on("subagents:resumed")[0]?.data).toMatchObject({
			id,
			toolCallId: "call_3",
		});
	});
});

describe("effective model and thinking", () => {
	it("locked model wins over the caller's request", async () => {
		const h = harness({
			agent: { model: "fixture/fixture-deep", locked: ["model"] },
		});

		await h.call("call_1", { ...explore, model: "fixture/fixture-fast" });

		const id = h.manager.listAgents()[0]!.id;
		expect(
			h.on("subagents:child:session-created")[0]?.data.effectiveModel,
		).toBe("fixture/fixture-deep");
		expect(toSubagentRecord(h.manager.getRecord(id)!).effectiveModel).toBe(
			"fixture/fixture-deep",
		);
	});

	it("an unlocked request wins, with its thinking level", async () => {
		const h = harness();

		await h.call("call_1", {
			...explore,
			model: "fixture/fixture-fast",
			thinking: "medium",
		});

		const created = h.on("subagents:child:session-created")[0]!.data;
		expect(created).toMatchObject({
			effectiveModel: "fixture/fixture-fast",
			effectiveThinking: "medium",
		});
		expect(toSubagentRecord(h.manager.listAgents()[0]!)).toMatchObject({
			effectiveModel: "fixture/fixture-fast",
			effectiveThinking: "medium",
		});
	});

	it("the record already carries the facts inside the session-created event", async () => {
		const h = harness();

		await h.call("call_1", {
			...explore,
			model: "fixture/fixture-fast",
			thinking: "medium",
		});

		expect(h.recordsSeenInCreated[0]).toMatchObject({
			effectiveModel: "fixture/fixture-fast",
			effectiveThinking: "medium",
		});
	});

	it("a model change during bind leaves record and event on the creation snapshot", async () => {
		const h = harness({
			bind: (session) => {
				Object.assign(session, { model: DEEP, thinkingLevel: "high" });
			},
		});

		await h.call("call_1", {
			...explore,
			model: "fixture/fixture-fast",
			thinking: "medium",
		});

		const expected = {
			effectiveModel: "fixture/fixture-fast",
			effectiveThinking: "medium",
		};
		expect(h.on("subagents:child:session-created")[0]?.data).toMatchObject(
			expected,
		);
		expect(toSubagentRecord(h.manager.listAgents()[0]!)).toMatchObject(
			expected,
		);
	});

	it("a bind failure keeps the facts on the record", async () => {
		const h = harness({
			bind: () => {
				throw new Error("bind failed");
			},
		});

		await h.call("call_1", { ...explore, model: "fixture/fixture-fast" });

		const record = toSubagentRecord(h.manager.listAgents()[0]!);
		expect(record.status).toBe("error");
		expect(record.effectiveModel).toBe("fixture/fixture-fast");
	});

	it("a queued record has neither field", () => {
		const h = harness({ maxConcurrent: 0 });
		const id = h.manager.spawn(snapshot, "Explore", "go", {
			origin: { kind: "service" },
			description: "d",
			background: { kind: "explicit", isBackground: true },
		});
		const record = toSubagentRecord(h.manager.getRecord(id)!);

		expect(record.status).toBe("queued");
		expect(record).not.toHaveProperty("effectiveModel");
		expect(record).not.toHaveProperty("effectiveThinking");
	});
});

describe("tool facts", () => {
	const withBash = { disallowedTools: ["bash"], toolNames: ["read", "bash"] };

	it("bound record carries tool facts", async () => {
		const h = harness({
			agent: withBash,
			bind: (session) => {
				session.getActiveToolNames.mockReturnValue(["read", "grep", "edit"]);
			},
		});

		await h.call("call_1", explore);

		const record = toSubagentRecord(h.manager.listAgents()[0]!);
		expect(record.toolCount).toBe(3);
		expect(record.blockedToolCount).toBe(1);
	});

	it("queued record has none", () => {
		const h = harness({ maxConcurrent: 0 });
		const id = h.manager.spawn(snapshot, "Explore", "go", {
			origin: { kind: "service" },
			description: "d",
			background: { kind: "explicit", isBackground: true },
		});
		const record = toSubagentRecord(h.manager.getRecord(id)!);

		expect(record.status).toBe("queued");
		expect(record).not.toHaveProperty("toolCount");
		expect(record).not.toHaveProperty("blockedToolCount");
	});

	it("facts survive release", async () => {
		const h = harness({ agent: withBash });
		await h.call("call_1", explore);
		const record = h.manager.listAgents()[0]!;
		const before = record.toolFacts;

		await record.releaseSession();

		expect(before).toEqual({ toolCount: 1, blockedToolCount: 1 });
		expect(record.toolFacts).toEqual(before);
	});

	it("facts stay unchanged across a resume that reuses the session", async () => {
		const h = harness({ agent: withBash });
		await h.call("call_1", explore);
		const record = h.manager.listAgents()[0]!;
		const before = record.toolFacts;

		await h.call("call_2", {
			prompt: "more",
			description: "d",
			subagent_type: "Explore",
			resume: record.id,
		});

		expect(h.on("subagents:resumed")).toHaveLength(1);
		expect(record.toolFacts).toEqual(before);
	});
});
