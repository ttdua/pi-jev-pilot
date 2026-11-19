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

type Event = { channel: string; data: Record<string, any> };
type ToolResult = { content: { text: string }[]; isError?: boolean };
type Tool = {
	name: string;
	execute(...args: unknown[]): Promise<ToolResult> | ToolResult;
};

let childCounter = 0;
const managers: SubagentManager[] = [];

/** What the fake child does with its `submit_result` tool, and what each call returned. */
type ChildScript = (
	submit: (value: unknown) => Promise<ToolResult>,
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
				if (!tool) return;
				await script(async (value) => {
					session.emit({
						type: "tool_execution_start",
						toolName: "submit_result",
						toolCallId: "c",
					});
					return tool.execute("c", { result: value }, undefined, undefined, {});
				});
			});
			return { session };
		},
	);
	const emit = (channel: string, data: unknown) => {
		events.push({ channel, data: data as Record<string, any> });
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
		on: (channel: string) => events.filter((e) => e.channel === channel),
		/** Spawn with `schema`, let the child run `childScript`, wait for the run. */
		async run(schema: ResultSchema, childScript: ChildScript): Promise<string> {
			script = childScript;
			const id = service.spawn("Explore", "go", {
				foreground: true,
				resultSchema: schema,
			});
			await manager.getRecord(id)!.promise;
			return id;
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

		expect(replies[0]!.isError).toBe(true);
		expect(replies[0]!.content[0]!.text).toContain("result.status");
		expect(replies[1]!.isError).toBeUndefined();

		const completed = h.on("subagents:completed")[0]!.data;
		expect(completed.structuredResult).toEqual({ status: "done" });
		expect(completed).not.toHaveProperty("structuredResultError");

		const record = h.service.getRecord(id)!;
		expect(record.structuredResult).toEqual({ status: "done" });
		expect(Object.isFrozen(record.structuredResult)).toBe(true);
		expect(record).not.toHaveProperty("structuredResultError");
	});

	it("reports missing when the child never calls the tool", async () => {
		const h = harness();
		const id = await h.run(SCHEMA, async () => {});

		const completed = h.on("subagents:completed")[0]!.data;
		expect(completed.structuredResultError).toBe("missing");
		expect(completed).not.toHaveProperty("structuredResult");
		expect(h.service.getRecord(id)!.structuredResultError).toBe("missing");
	});

	it("validates against the schema copied at spawn, not the caller's later edits", async () => {
		const h = harness();
		const schema = {
			type: "object",
			properties: { status: { enum: ["done", "blocked"] } },
		} as { type: "object"; properties: { status: { enum: string[] } } };
		let reply: ToolResult | undefined;
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const id = h.spawnOnly(schema as ResultSchema, async (submit) => {
			await gate;
			reply = await submit({ status: "added" });
		});
		schema.properties.status.enum.push("added");
		release();
		await h.manager.getRecord(id)!.promise;

		expect(reply?.isError).toBe(true);
		expect(h.service.getRecord(id)).not.toHaveProperty("structuredResult");
	});
});
