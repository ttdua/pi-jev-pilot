import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateSessionOptions } from "#src/lifecycle/create-subagent-session";
import { createSubagentSession } from "#src/lifecycle/create-subagent-session";
import { Subagent } from "#src/lifecycle/subagent";
import { makeStubExecution } from "#test/helpers/make-subagent";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";
import {
	createAgentLookup,
	createChildLifecycleMock,
	createSubagentSessionDeps,
	createSubagentSessionIO,
} from "#test/helpers/subagent-session-io";

/** One tool call the scripted model makes. */
interface ScriptedCall {
	name: string;
	args: object;
}

/** What the model does on one provider request: call tools, or answer in text. */
type ScriptedReply = ScriptedCall[] | string | { httpStatus: number };

const sse = (delta: object, finish: string | null) =>
	`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

/** A loopback `openai-completions` endpoint answering request N with `script[N]` (text "ok" past the end). */
async function startLoopback(script: ScriptedReply[]) {
	let requests = 0;
	const server = createServer((req, res) => {
		req.on("data", () => {});
		req.on("end", () => {
			const reply = script[requests++] ?? "ok";
			if (typeof reply === "object" && "httpStatus" in reply) {
				res.writeHead(reply.httpStatus, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: { message: "provider exploded" } }));
				return;
			}
			res.writeHead(200, { "content-type": "text/event-stream" });
			if (typeof reply === "string") {
				res.write(sse({ role: "assistant", content: reply }, null));
				res.write(sse({}, "stop"));
			} else {
				const tool_calls = reply.map((call, index) => ({
					index,
					id: `call_${requests}_${index}`,
					type: "function",
					function: { name: call.name, arguments: JSON.stringify(call.args) },
				}));
				res.write(sse({ role: "assistant", tool_calls }, null));
				res.write(sse({}, "tool_calls"));
			}
			res.end("data: [DONE]\n\n");
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}/v1`,
		requestCount: () => requests,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

const SCHEMA = {
	type: "object",
	properties: { status: { enum: ["done", "blocked"] } },
	required: ["status"],
	additionalProperties: false,
} as const;

const VALID = { name: "submit_result", args: { result: { status: "done" } } };
const INVALID = {
	name: "submit_result",
	args: { result: { status: "maybe" } },
};

/**
 * A real child (production factory over `createAgentSession`) with a scripted
 * loopback provider, run by a `Subagent` launched with a schema.
 */
describe("structured result turn loop (real SDK session)", () => {
	let root: string;
	let projectDir: string;
	let agentDir: string;
	let loopback: Awaited<ReturnType<typeof startLoopback>>;
	let agent: Subagent | undefined;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "structured-loop-"));
		projectDir = join(root, "project");
		agentDir = join(root, "agent");
		mkdirSync(projectDir, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(join(projectDir, "notes.txt"), "hello\n");
	});

	afterEach(async () => {
		await agent?.subagentSession?.dispose();
		agent = undefined;
		await loopback.close();
		rmSync(root, { recursive: true, force: true });
	});

	/** Run the agent to the end of its run under `script`, with `onSession` called once its session is bound. */
	async function runChild(
		script: ScriptedReply[],
		onSession?: (agent: Subagent) => void,
		maxTurns?: number,
		withSchema = true,
	): Promise<Subagent> {
		loopback = await startLoopback(script);
		const runtime = await ModelRuntime.create({
			authPath: join(agentDir, "auth.json"),
			modelsPath: join(agentDir, "models.json"),
		});
		runtime.registerProvider("loop", {
			baseUrl: loopback.url,
			api: "openai-completions",
			apiKey: "test-key",
			models: [
				{
					id: "m",
					name: "m",
					reasoning: false,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 8000,
					maxTokens: 1000,
				},
			],
		});
		const model = runtime.getModel("loop", "m");
		const io = createSubagentSessionIO();
		io.getAgentDir.mockReturnValue(agentDir);
		io.createSettingsManager.mockImplementation(() =>
			SettingsManager.create(projectDir, agentDir),
		);
		io.createSessionManager.mockImplementation(() =>
			SessionManager.inMemory(projectDir),
		);
		io.createResourceLoader.mockImplementation(
			(opts) => new DefaultResourceLoader(opts),
		);
		io.createSession.mockImplementation(async (opts: CreateSessionOptions) => {
			const created = await createAgentSession({
				cwd: opts.cwd,
				agentDir: opts.agentDir,
				sessionManager: opts.sessionManager as SessionManager,
				settingsManager: opts.settingsManager,
				resourceLoader: opts.resourceLoader as DefaultResourceLoader,
				modelRuntime: runtime,
				model,
				tools: opts.tools,
				customTools: opts.customTools,
			});
			return { session: created.session };
		});

		const deps = createSubagentSessionDeps({
			io,
			exec: vi.fn(),
			registry: createAgentLookup({
				name: "reader",
				toolNames: ["read"],
				systemPrompt: "Read things.",
			}),
			lifecycle: createChildLifecycleMock(),
		});
		const launched = new Subagent({
			id: "a1",
			type: "reader",
			description: "structured result loop",
			isBackground: false,
			execution: makeStubExecution({
				createSubagentSession: (params) => createSubagentSession(params, deps),
				snapshot: { ...STUB_SNAPSHOT, cwd: projectDir },
				prompt: "TASK",
				baseCwd: projectDir,
				resultSchema: withSchema ? SCHEMA : undefined,
				maxTurns,
				observer: { onSessionCreated: (created) => onSession?.(created) },
			}),
		});
		agent = launched;
		await launched.run();
		return launched;
	}

	it("makes exactly one provider request when turn 1 only submits a valid result", async () => {
		const launched = await runChild([[VALID]]);

		expect(loopback.requestCount()).toBe(1);
		expect(launched.structuredResult).toEqual({ status: "done" });
	});

	it("emits both tool results and makes no further request when submit_result shares the batch", async () => {
		const toolResults: string[] = [];
		const launched = await runChild(
			[[{ name: "read", args: { path: "notes.txt" } }, VALID]],
			(launched) => {
				launched.subscribeToUpdates((event) => {
					if (event.type === "tool_execution_end")
						toolResults.push(event.toolName);
				});
			},
		);

		expect(loopback.requestCount()).toBe(1);
		expect(toolResults.sort()).toEqual(["read", "submit_result"]);
		expect(launched.structuredResult).toEqual({ status: "done" });
	});

	it("lets the child retry after an invalid submission", async () => {
		const launched = await runChild([[INVALID], [VALID]]);

		expect(loopback.requestCount()).toBe(2);
		expect(launched.structuredResult).toEqual({ status: "done" });
	});
	const READ = { name: "read", args: { path: "notes.txt" } };

	it.each([
		["alone", [VALID]],
		["beside read", [READ, VALID]],
	])("settles completed when %s submits on the last permitted turn", async (_kind, ceilingTurn) => {
		const launched = await runChild([[READ], ceilingTurn, "unexpected next turn"], undefined, 2);

		expect(loopback.requestCount()).toBe(2);
		expect(launched.turnBudget?.phase).toBe("exhausted");
		expect(launched.status).toBe("completed");
		expect(launched.structuredResult).toEqual({ status: "done" });
		expect(launched.structuredResultError).toBeUndefined();
	});

	describe("turn limit reached without a submission", () => {
		const reads = [[READ], [READ], [READ], "late"];

		it("settles aborted, exhausted and missing with a schema", async () => {
			const launched = await runChild(reads, undefined, 2);

			expect(launched.status).toBe("aborted");
			expect(launched.turnBudget?.phase).toBe("exhausted");
			expect(launched.structuredResultError).toBe("missing");
		});

		it("settles aborted and exhausted with no schema", async () => {
			const launched = await runChild(reads, undefined, 2, false);

			expect(launched.status).toBe("aborted");
			expect(launched.turnBudget?.phase).toBe("exhausted");
		});

		it("still settles error when the provider rejects a turn", async () => {
			const launched = await runChild([{ httpStatus: 400 }], undefined, 2);

			expect(launched.status).toBe("error");
			expect(launched.error).toContain("provider exploded");
		});
	});

	/** Queue `queue` on the session once `submit_result` finishes, while the turn is still running. */
	function queueAfterSubmit(queue: (launched: Subagent) => Promise<unknown>) {
		return (launched: Subagent) => {
			launched.subscribeToUpdates((event) => {
				if (event.type === "tool_execution_end" && event.toolName === "submit_result")
					void queue(launched);
			});
		};
	}

	it.each([
		["a steer", (launched: Subagent) => launched.steer("one more thing")],
		[
			"a follow-up",
			(launched: Subagent) => launched.subagentSession?.session.followUp("one more thing") ?? Promise.resolve(),
		],
	])("starts no further turn when %s is queued after a valid submission", async (_kind, queue) => {
		const toolResults: string[] = [];
		const launched = await runChild(
			[[{ name: "read", args: { path: "notes.txt" } }, VALID], "unexpected next turn"],
			(created) => {
				created.subscribeToUpdates((event) => {
					if (event.type === "tool_execution_end") toolResults.push(event.toolName);
				});
				queueAfterSubmit(queue)(created);
			},
		);

		expect(loopback.requestCount()).toBe(1);
		expect(toolResults.sort()).toEqual(["read", "submit_result"]);
		expect(launched.status).toBe("completed");
		expect(launched.structuredResult).toEqual({ status: "done" });
		expect(launched.result).not.toContain("unexpected next turn");
		// Ending the run drops nothing: the message stays queued, as on any Pi abort.
		expect(launched.subagentSession?.session.pendingMessageCount).toBe(1);
	});

	it("reads stopped when aborted from outside after a valid submission", async () => {
		const launched = await runChild(
			[[VALID], "unexpected next turn"],
			queueAfterSubmit(async (created) => created.abort()),
		);

		expect(loopback.requestCount()).toBe(1);
		expect(launched.status).toBe("stopped");
		expect(launched.structuredResult).toEqual({ status: "done" });
	});
});
