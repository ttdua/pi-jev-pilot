/**
 * Launch metadata, driven through the real boundaries:
 * `SubagentsServiceAdapter.spawn` / `AgentTool.execute` → `SubagentManager` →
 * `Subagent.run` → `createSubagentSession` → lifecycle publisher / events
 * observer / service snapshot / launch policy. Only the SDK session factory is
 * faked. The registry is process-wide, so every test resets it.
 */
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { createChildLifecyclePublisher } from "#src/lifecycle/child-lifecycle";
import { CHILD_SHUTDOWN_TIMEOUT_MS } from "#src/lifecycle/child-shutdown";
import { ConcurrencyLimiter } from "#src/lifecycle/concurrency-limiter";
import { createSubagentSession } from "#src/lifecycle/create-subagent-session";
import type { ParentSnapshot } from "#src/lifecycle/parent-snapshot";
import { SubagentManager } from "#src/lifecycle/subagent-manager";
import { CompositeSubagentObserver } from "#src/observation/composite-subagent-observer";
import { SubagentEventsObserver } from "#src/observation/subagent-events-observer";
import { readPersistedRuns, SUBAGENT_RECORD_ENTRY } from "#src/persisted-record";
import { resetChildSessions } from "#src/seams/child-sessions";
import { AgentTypeCatalog } from "#src/seams/registry";
import type {
	ChildSessionInfo,
	LaunchRequest,
	ResumeOptions,
} from "#src/service/service";
import { SubagentsServiceAdapter, toSubagentRecord } from "#src/service/service-adapter";
import { resolveModel } from "#src/session/model-resolver";
import { AgentTool } from "#src/tools/agent-tool";
import { makeAgentConfig } from "#test/helpers/make-agent-config";
import { registryWithGeneral } from "#test/helpers/make-registry";
import { makeModel } from "#test/helpers/make-model";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";
import {
	createAgentLookup,
	createFactorySession,
	createSubagentSessionDeps,
	createSubagentSessionIO,
} from "#test/helpers/subagent-session-io";

const MAIN = makeModel({ provider: "fixture", id: "fixture-main" });
const modelRegistry = {
	find: () => undefined,
	getAll: () => [MAIN],
	getAvailable: () => [MAIN],
};
const snapshot: ParentSnapshot = { ...STUB_SNAPSHOT, model: MAIN, modelRegistry };

type Event = { channel: string; data: Record<string, any> };
type Session = ReturnType<typeof createFactorySession>;

const CHILD = "subagents:child:";
const CHILD_EVENTS = ["spawning", "session-created", "bound"].map((n) => CHILD + n);
const RECORD_EVENTS = ["created", "started", "completed", "resuming", "resumed"].map(
	(n) => `subagents:${n}`,
);

/** Child session ids are unique across harnesses, as Pi's are across sessions. */
let childCounter = 0;

interface Options {
	/** Background concurrency limit; 0 keeps every background launch queued. */
	maxConcurrent?: number;
	/** Runs inside `bindExtensions` (the child's `session_start`). */
	bind?: (session: Session, sessionId: string) => void | Promise<void>;
	/** Runs when the child's `session_shutdown` is emitted to its extensions. */
	shutdown?: (sessionId: string) => Promise<unknown>;
}

interface Harness {
	service: SubagentsServiceAdapter;
	manager: SubagentManager;
	events: Event[];
	entries: { customType: string; data: unknown }[];
	call(toolCallId: string, params: Record<string, unknown>): Promise<unknown>;
	on(channel: string): Event[];
	subscribe(channel: string, fn: (data: Record<string, any>) => void): void;
	run(metadata?: Record<string, string>): Promise<string>;
	sessionIdOf(agentId: string): string;
}

const harnesses: { manager: SubagentManager }[] = [];

function harness(options: Options = {}): Harness {
	const events: Event[] = [];
	const entries: { customType: string; data: unknown }[] = [];
	const subscribers = new Map<string, ((data: Record<string, any>) => void)[]>();
	const registry = registryWithGeneral(
		() =>
			new Map([["Explore", makeAgentConfig({ name: "Explore", toolNames: ["read"], runInBackground: true })]]),
	);
	const io = createSubagentSessionIO();
	io.createSessionManager.mockImplementation(() => {
		const id = `child-${++childCounter}`;
		return {
			newSession: vi.fn(),
			getSessionFile: vi.fn().mockReturnValue(`/sessions/${id}.jsonl`),
			getSessionId: vi.fn().mockReturnValue(id),
		};
	});
	io.createSession.mockImplementation(
		async (opts: { sessionManager: { getSessionId(): string } }) => {
			const sessionId = opts.sessionManager.getSessionId();
			const session = createFactorySession();
			Object.assign(session, { model: MAIN, thinkingLevel: "off" });
			session.getActiveToolNames.mockImplementation(() => ["read"]);
			session.bindExtensions.mockImplementation(async () =>
				options.bind?.(session, sessionId),
			);
			if (options.shutdown)
				session.extensionRunner.emit.mockImplementation(() =>
					options.shutdown!(sessionId),
				);
			return { session };
		},
	);
	// Synchronous, like Pi's event bus: a subscriber runs inside the publisher's call.
	const emit = (channel: string, data: unknown) => {
		const event = { channel, data: data as Record<string, any> };
		events.push(event);
		for (const fn of subscribers.get(channel) ?? []) fn(event.data);
	};
	const sessionDeps = {
		...createSubagentSessionDeps({
			io,
			registry,
			listParentToolNames: () => ["read"],
		}),
		lifecycle: createChildLifecyclePublisher(emit),
	};
	const observer = new CompositeSubagentObserver([
		new SubagentEventsObserver({
			emit,
			appendEntry: (customType, data) => entries.push({ customType, data }),
			notifications: {
				sendCompletion: () => undefined,
				sendUpdate: () => undefined,
				sendWorkspaceNotice: () => undefined,
				dispose: () => undefined,
			},
		}),
	]);
	const manager = new SubagentManager({
		createSubagentSession: (params) => createSubagentSession(params, sessionDeps),
		baseCwd: "/repo",
		observer,
		limiter: new ConcurrencyLimiter(() => options.maxConcurrent ?? 4),
		registry,
		launchContext: {
			listParentTools: () => [
				{ name: "read", sourceInfo: { source: "local", origin: "top-level" } },
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
	const h: Harness = {
		service,
		manager,
		events,
		entries,
		call: (toolCallId: string, params: Record<string, unknown>) =>
			tool.execute(toolCallId, params, undefined, undefined, {} as never),
		on: (channel: string) => events.filter((e) => e.channel === channel),
		subscribe: (channel: string, fn: (data: Record<string, any>) => void) => {
			subscribers.set(channel, [...(subscribers.get(channel) ?? []), fn]);
		},
		/** Spawn through the service door, in the foreground, and wait for the run. */
		async run(metadata?: Record<string, string>): Promise<string> {
			const id = service.spawn("Explore", "go", { foreground: true, metadata });
			await manager.getRecord(id)!.promise;
			return id;
		},
		/** The child session id of the launch's `session-created` event. */
		sessionIdOf: (agentId: string): string =>
			events.find(
				(e) =>
					e.channel === `${CHILD}session-created` && e.data.agentId === agentId,
			)!.data.sessionId,
	};
	harnesses.push(h);
	return h;
}

const explore = {
	prompt: "go",
	description: "d",
	subagent_type: "Explore",
	run_in_background: false,
};

beforeEach(() => {
	vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
	vi.useRealTimers();
	await Promise.all(harnesses.splice(0).map((h) => h.manager.dispose()));
	resetChildSessions();
	vi.restoreAllMocks();
});

/** Every `metadata` a launch's events carried, for every channel in `channels`. */
function metadataOn(h: Harness, channels: string[]) {
	return channels.flatMap((c) => h.on(c)).map((e) => e.data.metadata);
}

describe("Launch metadata on service launches", () => {
	it("Metadata accepted", async () => {
		const h = harness();
		const id = await h.run({ change: "c1", "lane.root": "/w/c1" });

		expect(h.service.getRecord(id)?.metadata).toEqual({
			change: "c1",
			"lane.root": "/w/c1",
		});
	});

	it("Empty map is no metadata", async () => {
		const h = harness();
		const id = await h.run({});

		expect(h.service.getRecord(id)).not.toHaveProperty("metadata");
		for (const e of h.events) expect(e.data).not.toHaveProperty("metadata");
	});

	it("Tool-call launch", async () => {
		const h = harness();
		await h.call("call_1", explore);

		const record = toSubagentRecord(h.manager.listAgents()[0]!);
		expect(record).not.toHaveProperty("metadata");
		for (const e of h.events) expect(e.data).not.toHaveProperty("metadata");
	});

	it("Resume takes no metadata", () => {
		expectTypeOf<ResumeOptions>().not.toHaveProperty("metadata");
	});
});

describe("Refused metadata", () => {
	const keys33 = Object.fromEntries(
		Array.from({ length: 33 }, (_, i) => [`k${i}`, "v"]),
	);

	it("Too many keys", () => {
		const h = harness();

		expect(() => h.service.spawn("Explore", "go", { metadata: keys33 })).toThrow(
			/32/,
		);
		expect(h.service.listAgents()).toEqual([]);
	});

	it("Nothing created on refusal", () => {
		const h = harness();
		const policy = vi.fn(() => undefined);
		h.service.registerLaunchPolicy(policy, { timeoutMs: 1000 });

		expect(() =>
			h.service.spawn("Explore", "go", { metadata: { Change: "c1" } }),
		).toThrow(/Change/);

		expect(h.service.listAgents()).toEqual([]);
		expect(h.events).toEqual([]);
		expect(policy).not.toHaveBeenCalled();
	});
});

describe("Metadata is immutable", () => {
	it("Caller mutates its object", async () => {
		const h = harness();
		const metadata: Record<string, string> = { change: "c1" };
		const id = h.service.spawn("Explore", "go", { foreground: true, metadata });
		metadata.extra = "late";
		await h.manager.getRecord(id)!.promise;

		expect(h.service.getRecord(id)?.metadata).toEqual({ change: "c1" });
		for (const m of metadataOn(h, [...CHILD_EVENTS, ...RECORD_EVENTS]))
			expect(m).toEqual({ change: "c1" });
	});

	it("Consumer cannot write", async () => {
		const h = harness();
		const thrown: unknown[] = [];
		let sessionId = "";
		h.subscribe(`${CHILD}session-created`, (data) => {
			sessionId = data.sessionId;
			try {
				data.metadata.extra = "x";
			} catch (error) {
				thrown.push(error);
			}
		});

		await h.run({ change: "c1" });

		expect(thrown).toHaveLength(1);
		expect(thrown[0]).toBeInstanceOf(TypeError);
		expect(h.service.childSession(sessionId)?.metadata).toEqual({ change: "c1" });
	});

	it("Every surface is frozen", async () => {
		const h = harness();
		const requests: LaunchRequest[] = [];
		h.service.registerLaunchPolicy(
			(request) => {
				requests.push(request);
				return undefined;
			},
			{ timeoutMs: 1000 },
		);
		let looked: ChildSessionInfo | undefined;
		h.subscribe(`${CHILD}session-created`, (data) => {
			looked = h.service.childSession(data.sessionId);
		});

		// Background: `subagents:created` is emitted only for background launches.
		const id = h.service.spawn("Explore", "go", { metadata: { change: "c1" } });
		await h.manager.getRecord(id)!.promise;
		const record = h.service.getRecord(id);
		await h.service.resume(id, "more");

		const channels = [...CHILD_EVENTS, ...RECORD_EVENTS];
		for (const channel of channels) {
			expect(h.on(channel), channel).not.toHaveLength(0);
			for (const e of h.on(channel)) {
				expect(e.data.metadata, channel).toEqual({ change: "c1" });
				expect(Object.isFrozen(e.data.metadata), channel).toBe(true);
			}
		}
		const entry = h.service.childSession(h.sessionIdOf(id));
		expect(requests).toHaveLength(1);
		for (const surface of [
			record?.metadata,
			h.service.getRecord(id)?.metadata,
			requests[0]?.metadata,
			looked,
			looked?.metadata,
			entry,
			entry?.metadata,
		]) {
			expect(surface).toBeDefined();
			expect(Object.isFrozen(surface)).toBe(true);
		}
	});

	it("Empty lookup metadata is frozen", async () => {
		const h = harness();
		await h.call("call_1", explore);

		const info = h.service.childSession(
			h.on(`${CHILD}session-created`)[0]!.data.sessionId,
		);
		expect(info?.metadata).toEqual({});
		expect(Object.isFrozen(info?.metadata)).toBe(true);
	});
});

describe("Metadata on child events", () => {
	it("Child events of a launch with metadata", async () => {
		const h = harness();
		const id = await h.run({ change: "c1" });

		for (const channel of CHILD_EVENTS) {
			expect(h.on(channel)[0]?.data).toMatchObject({
				agentId: id,
				metadata: { change: "c1" },
			});
		}
	});

	it("Child events without metadata", async () => {
		const h = harness();
		await h.run();

		for (const channel of CHILD_EVENTS) {
			expect(h.on(channel)).toHaveLength(1);
			expect(h.on(channel)[0]!.data).not.toHaveProperty("metadata");
		}
	});
});

describe("Metadata on record events and snapshots", () => {
	it("Queued record", () => {
		const h = harness({ maxConcurrent: 0 });
		const id = h.service.spawn("Explore", "go", { metadata: { change: "c1" } });

		expect(h.service.getRecord(id)).toMatchObject({
			status: "queued",
			metadata: { change: "c1" },
		});
	});

	it("Every record event of a launch with metadata", async () => {
		const h = harness();
		const id = h.service.spawn("Explore", "go", { metadata: { change: "c1" } });
		await h.manager.getRecord(id)!.promise;
		await h.service.resume(id, "more");

		for (const channel of RECORD_EVENTS) {
			expect(h.on(channel).length).toBeGreaterThan(0);
			for (const e of h.on(channel))
				expect(e.data).toMatchObject({ metadata: { change: "c1" } });
		}
	});

	it("Failure", async () => {
		const h = harness({
			bind: () => {
				throw new Error("bind failed");
			},
		});
		await h.run({ change: "c1" });

		expect(h.on("subagents:failed")).toHaveLength(1);
		expect(h.on("subagents:failed")[0]!.data).toMatchObject({
			metadata: { change: "c1" },
		});
	});

	it("Record events without metadata", async () => {
		const h = harness();
		const id = h.service.spawn("Explore", "go");
		await h.manager.getRecord(id)!.promise;

		for (const channel of RECORD_EVENTS.slice(0, 3)) {
			expect(h.on(channel).length).toBeGreaterThan(0);
			for (const e of h.on(channel)) expect(e.data).not.toHaveProperty("metadata");
		}
	});

	it("Tool-call resume of a service launch", async () => {
		const h = harness();
		const id = await h.run({ change: "c1" });

		await h.call("call_4", { ...explore, resume: id });

		for (const channel of ["subagents:resuming", "subagents:resumed"]) {
			expect(h.on(channel)[0]?.data).toMatchObject({
				toolCallId: "call_4",
				metadata: { change: "c1" },
			});
		}
	});
});

describe("Metadata is not persisted", () => {
	it("Persisted entry", async () => {
		const h = harness();
		const id = await h.run({ change: "c1" });

		const entry = h.entries.find((e) => e.customType === SUBAGENT_RECORD_ENTRY);
		expect(entry?.data).not.toHaveProperty("metadata");
		const runs = readPersistedRuns(
			h.entries.map((e) => ({ type: "custom", ...e })),
		);
		expect(runs.map((r) => r.id)).toEqual([id]);
		expect(runs[0]).not.toHaveProperty("metadata");
	});
});

describe("Child session lookup", () => {
	it("Main session and unknown ids", async () => {
		const h = harness();
		await h.run({ change: "c1" });

		expect(h.service.childSession("p1")).toBeUndefined();
		expect(h.service.childSession("unknown")).toBeUndefined();
	});

	it("Tool-call child", async () => {
		const h = harness();
		await h.call("call_1", explore);

		const id = h.manager.listAgents()[0]!.id;
		expect(h.service.childSession(h.sessionIdOf(id))).toEqual({
			agentId: id,
			agentType: "Explore",
			metadata: {},
		});
	});
});

describe("Child session registry lifetime", () => {
	it("Lookup from the child's session_start", async () => {
		let seen: ChildSessionInfo | undefined;
		const h = harness({
			bind: (_s, sessionId) => {
				seen = h.service.childSession(sessionId);
			},
		});
		const id = await h.run({ change: "c1" });

		expect(seen).toEqual({
			agentId: id,
			agentType: "Explore",
			metadata: { change: "c1" },
		});
	});

	it("Lookup during shutdown", async () => {
		let seen: ChildSessionInfo | undefined;
		const h = harness({
			shutdown: async (sessionId) => {
				seen = h.service.childSession(sessionId);
			},
		});
		const id = await h.run({ change: "c1" });
		await h.manager.dispose();

		expect(seen).toEqual({
			agentId: id,
			agentType: "Explore",
			metadata: { change: "c1" },
		});
	});

	it("Shutdown handler past the bound", async () => {
		const h = harness({ shutdown: () => new Promise(() => undefined) });
		const id = await h.run({ change: "c1" });
		const sessionId = h.sessionIdOf(id);
		vi.useFakeTimers();

		const disposal = h.manager.dispose();
		await vi.advanceTimersByTimeAsync(CHILD_SHUTDOWN_TIMEOUT_MS);
		await disposal;

		expect(h.service.childSession(sessionId)).toBeUndefined();
	});

	it("Present during event dispatch", async () => {
		const h = harness();
		const seen: Record<string, ChildSessionInfo | undefined> = {};
		for (const name of ["session-created", "disposed"])
			h.subscribe(CHILD + name, (data) => {
				seen[name] = h.service.childSession(data.sessionId);
			});
		const id = await h.run({ change: "c1" });
		await h.manager.dispose();

		for (const name of ["session-created", "disposed"])
			expect(seen[name]).toEqual({
				agentId: id,
				agentType: "Explore",
				metadata: { change: "c1" },
			});
	});

	it("Removed after disposal", async () => {
		const h = harness();
		const id = await h.run({ change: "c1" });
		const sessionId = h.sessionIdOf(id);
		expect(h.service.childSession(sessionId)).toBeDefined();

		await h.manager.dispose();

		expect(h.on(`${CHILD}disposed`)).toHaveLength(1);
		expect(h.service.childSession(sessionId)).toBeUndefined();
	});

	it("Failed bind", async () => {
		const h = harness({
			bind: () => {
				throw new Error("bind failed");
			},
		});
		const id = await h.run({ change: "c1" });

		expect(h.service.getRecord(id)?.status).toBe("error");
		expect(h.service.childSession(h.sessionIdOf(id))).toBeUndefined();
	});

	it("Failed grant check", async () => {
		const events: Event[] = [];
		const io = createSubagentSessionIO();
		const session = createFactorySession();
		io.createSession.mockResolvedValue({ session });
		Object.assign(session, {
			getAllTools: () => {
				throw new Error("registry unavailable");
			},
		});
		session.setActiveToolsByName.mockImplementation(() => {
			throw new Error("setActiveToolsByName failed");
		});
		const lifecycle = createChildLifecyclePublisher((channel, data) => {
			events.push({ channel, data: data as Record<string, any> });
		});

		await expect(
			createSubagentSession(
				{
					agentId: "a1",
					snapshot: STUB_SNAPSHOT,
					type: "Explore",
					metadata: Object.freeze({ change: "c1" }),
					tools: { toolNames: ["read", "edit"], grants: ["web_search"], removed: [] },
				},
				{
					...createSubagentSessionDeps({
						io,
						registry: createAgentLookup({ toolNames: ["read", "edit"] }),
					}),
					lifecycle,
				},
			),
		).rejects.toThrow();

		const created = events.find((e) => e.channel === `${CHILD}session-created`);
		expect(created?.data.metadata).toEqual({ change: "c1" });
		expect(events.some((e) => e.channel === `${CHILD}disposed`)).toBe(true);
		const { lookupChildSession } = await import("#src/seams/child-sessions");
		expect(lookupChildSession(created!.data.sessionId)).toBeUndefined();
	});

	it("Shared across executor instances", async () => {
		const first = harness();
		const second = harness();
		const id = await first.run({ change: "c1" });
		const sessionId = first.sessionIdOf(id);

		expect(second.service.childSession(sessionId)).toEqual({
			agentId: id,
			agentType: "Explore",
			metadata: { change: "c1" },
		});
	});

	it("Gone after the parent session shuts down", async () => {
		const h = harness();
		const id = await h.run({ change: "c1" });
		const sessionId = h.sessionIdOf(id);

		// What the executor's shutdown handler does on /reload and quit.
		h.manager.abortAll();
		await h.manager.dispose();

		expect(h.service.childSession(sessionId)).toBeUndefined();
	});
});

describe("Launch request given to the policy", () => {
	function registered(h: Harness) {
		const requests: LaunchRequest[] = [];
		h.service.registerLaunchPolicy(
			(request) => {
				requests.push(request);
				return undefined;
			},
			{ timeoutMs: 1000 },
		);
		return requests;
	}

	it("Service launch with metadata", async () => {
		const h = harness();
		const requests = registered(h);
		await h.run({ change: "c1" });

		expect(requests[0]).toMatchObject({
			origin: { kind: "service" },
			metadata: { change: "c1" },
		});
		expect(() => {
			(requests[0]!.metadata as Record<string, string>).change = "x";
		}).toThrow(TypeError);
	});

	it("No metadata in the request", async () => {
		const h = harness();
		const requests = registered(h);
		await h.run();
		await h.call("call_1", explore);

		expect(requests).toHaveLength(2);
		for (const request of requests) expect(request).not.toHaveProperty("metadata");
	});
});
