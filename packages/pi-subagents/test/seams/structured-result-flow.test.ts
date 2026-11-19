/**
 * Structured result, driven through the real boundaries:
 * `SubagentsServiceAdapter.spawn` → `SubagentManager` → `Subagent.run` →
 * `createSubagentSession` → the installed `submit_result` tool → lifecycle
 * events and the service snapshot. Only the SDK session factory is faked; the
 * fake child calls the tool definition it was given.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChildLifecyclePublisher } from "#src/lifecycle/child-lifecycle";
import { ConcurrencyLimiter } from "#src/lifecycle/concurrency-limiter";
import { createSubagentSession } from "#src/lifecycle/create-subagent-session";
import type { ParentSnapshot } from "#src/lifecycle/parent-snapshot";
import { SubagentManager } from "#src/lifecycle/subagent-manager";
import { CompositeSubagentObserver } from "#src/observation/composite-subagent-observer";
import { SubagentEventsObserver } from "#src/observation/subagent-events-observer";
import { resetChildSessions } from "#src/seams/child-sessions";
import { AgentTypeCatalog } from "#src/seams/registry";
import type { ResultSchema } from "#src/service/service";
import { SubagentsServiceAdapter } from "#src/service/service-adapter";
import { resolveModel } from "#src/session/model-resolver";
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
	find: () => undefined,
	getAll: () => [MAIN],
	getAvailable: () => [MAIN],
};
const snapshot: ParentSnapshot = {
	...STUB_SNAPSHOT,
	model: MAIN,
	modelRegistry,
};

type Event = { channel: string; data: unknown };
type ToolResult = { content: { text: string }[]; isError?: boolean };
type Tool = {
	name: string;
	execute(...args: unknown[]): Promise<ToolResult> | ToolResult;
};

let childCounter = 0;
const managers: SubagentManager[] = [];

/** What the fake child can do inside a turn besides submitting. */
interface ChildActions {
	/** Answer in text, the way a model streams its final message. */
	say(text: string): void;
	/** Call the installed `ask_parent` tool. */
	ask(question: string): Promise<ToolResult>;
}

/** What the fake child does with its `submit_result` tool, and what each call returned. */
type ChildScript = (
	submit: (value: unknown) => Promise<ToolResult>,
	child: ChildActions,
) => Promise<void>;

function harness() {
	const events: Event[] = [];
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
			]),
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
	let script: ChildScript = async () => {};
	io.createSession.mockImplementation(
		async (opts: { customTools?: Tool[] }) => {
			const session = createFactorySession();
			Object.assign(session, { model: MAIN, thinkingLevel: "off", agent: {} });
			session.prompt.mockImplementation(async () => {
				const tool = opts.customTools?.find((t) => t.name === "submit_result");
				const askTool = opts.customTools?.find((t) => t.name === "ask_parent");
				if (!tool) return;
				await script(
					async (value) => {
						session.emit({
							type: "tool_execution_start",
							toolName: "submit_result",
							toolCallId: "c",
						});
						return tool.execute("c", { result: value }, undefined, undefined, {});
					},
					{
						say: (text) => {
							session.emit({ type: "message_start" });
							session.emit({
								type: "message_update",
								assistantMessageEvent: { type: "text_delta", delta: text },
							});
						},
						ask: async (question) =>
							(await askTool?.execute("q", { question }, undefined, undefined, {})) as ToolResult,
					},
				);
			});
			return { session };
		},
	);
	const emit = (channel: string, data: unknown) => {
		events.push({ channel, data });
	};
	const sessionDeps = {
		...createSubagentSessionDeps({
			io,
			registry,
			listParentToolNames: () => ["read"],
		}),
		lifecycle: createChildLifecyclePublisher(emit),
	};
	const manager = new SubagentManager({
		createSubagentSession: (params) =>
			createSubagentSession(params, sessionDeps),
		baseCwd: "/repo",
		observer: new CompositeSubagentObserver([
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
		]),
		limiter: new ConcurrencyLimiter(() => 4),
		registry,
		launchContext: {
			listParentTools: () => [
				{ name: "read", sourceInfo: { source: "local", origin: "top-level" } },
			],
			excludedPackages: () => [],
		},
	});
	managers.push(manager);
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
	return {
		service,
		/** The payload of the first event on `channel`; fails the test when none was emitted. */
		first(channel: string): Record<string, unknown> {
			const event = events.find((e) => e.channel === channel);
			expect(event, `no ${channel} event`).toBeDefined();
			return event?.data as Record<string, unknown>;
		},
		/** The record `id`; fails the test when the service has none. */
		record(id: string) {
			const record = service.getRecord(id);
			expect(record, `no record ${id}`).toBeDefined();
			return record as NonNullable<typeof record>;
		},
		/** Spawn with `schema`, let the child run `childScript`, wait for the run. */
		async run(schema: ResultSchema, childScript: ChildScript): Promise<string> {
			script = childScript;
			const id = service.spawn("Explore", "go", {
				foreground: true,
				resultSchema: schema,
			});
			await manager.getRecord(id)?.promise;
			return id;
		},
		/** Resume the finished run `id`, the child running `childScript`. */
		async resume(id: string, childScript: ChildScript): Promise<void> {
			script = childScript;
			await service.resume(id, "go on");
			await manager.getRecord(id)?.promise;
		},
		spawnOnly(schema: ResultSchema, childScript: ChildScript): string {
			script = childScript;
			return service.spawn("Explore", "go", {
				foreground: true,
				resultSchema: schema,
			});
		},
		manager,
	};
}

afterEach(async () => {
	await Promise.all(managers.splice(0).map((m) => m.dispose()));
	resetChildSessions();
	vi.restoreAllMocks();
});

const SCHEMA: ResultSchema = {
	type: "object",
	properties: { status: { enum: ["done", "blocked"] } },
	required: ["status"],
	additionalProperties: false,
};

describe("Structured result through the service door", () => {
	it("stores a valid value after an invalid one and reports it on the event and record", async () => {
		const h = harness();
		const replies: ToolResult[] = [];
		const id = await h.run(SCHEMA, async (submit) => {
			replies.push(await submit({ status: "maybe" }));
			replies.push(await submit({ status: "done" }));
		});

		expect(replies).toHaveLength(2);
		expect(replies[0]?.isError).toBe(true);
		expect(replies[0]?.content[0]?.text).toContain("result.status");
		expect(replies[1]?.isError).toBeUndefined();

		const completed = h.first("subagents:completed");
		expect(completed.structuredResult).toEqual({ status: "done" });
		expect(completed).not.toHaveProperty("structuredResultError");

		const record = h.record(id);
		expect(record.structuredResult).toEqual({ status: "done" });
		expect(Object.isFrozen(record.structuredResult)).toBe(true);
		expect(record).not.toHaveProperty("structuredResultError");
	});

	it("reports missing when the child never calls the tool", async () => {
		const h = harness();
		const id = await h.run(SCHEMA, async () => {});

		const completed = h.first("subagents:completed");
		expect(completed.structuredResultError).toBe("missing");
		expect(completed).not.toHaveProperty("structuredResult");
		expect(h.record(id).structuredResultError).toBe("missing");
	});

	it("keeps the free-text result beside a missing structured result", async () => {
		const h = harness();
		const id = await h.run(SCHEMA, async (_submit, child) => {
			child.say("I looked and found nothing.");
		});

		const record = h.record(id);
		expect(record.structuredResultError).toBe("missing");
		expect(record.result).toBe("I looked and found nothing.");
	});

	it("reports invalid on the run when two invalid calls are the last word", async () => {
		const h = harness();
		const id = await h.run(SCHEMA, async (submit) => {
			await submit({ status: "maybe" });
			await submit({ status: 1 });
		});

		expect(h.first("subagents:completed").structuredResultError).toBe("invalid");
		expect(h.record(id).structuredResultError).toBe("invalid");
		expect(h.record(id)).not.toHaveProperty("structuredResult");
	});

	it("gives a resumed run its own outcome after a pending question", async () => {
		const h = harness();
		const id = await h.run(SCHEMA, async (_submit, child) => {
			await child.ask("Which config wins?");
		});
		expect(h.record(id).structuredResultError).toBeUndefined();

		await h.resume(id, async (submit) => {
			await submit({ status: "done" });
		});

		const record = h.record(id);
		expect(record.structuredResult).toEqual({ status: "done" });
		expect(record).not.toHaveProperty("structuredResultError");
	});

	it("validates against the schema copied at spawn, not the caller's later edits", async () => {
		const h = harness();
		const schema = {
			type: "object",
			properties: { status: { enum: ["done", "blocked"] } },
		} as { type: "object"; properties: { status: { enum: string[] } } };
		let reply: ToolResult | undefined;
		const gate = Promise.withResolvers<void>();
		const id = h.spawnOnly(schema as ResultSchema, async (submit) => {
			await gate.promise;
			reply = await submit({ status: "added" });
		});
		schema.properties.status.enum.push("added");
		gate.resolve();
		await h.manager.getRecord(id)?.promise;

		expect(reply?.isError).toBe(true);
		expect(h.service.getRecord(id)).not.toHaveProperty("structuredResult");
	});
});
