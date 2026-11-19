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
import type { SubagentSession } from "#src/lifecycle/subagent-session";
import { SubagentRun } from "#src/lifecycle/subagent-run";
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
type ScriptedReply = ScriptedCall[] | string;

const sse = (delta: object, finish: string | null) =>
	`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

/** A loopback `openai-completions` endpoint answering request N with `script[N]` (text "ok" past the end). */
async function startLoopback(script: ScriptedReply[]) {
	let requests = 0;
	const server = createServer((req, res) => {
		req.on("data", () => {});
		req.on("end", () => {
			const reply = script[requests++] ?? "ok";
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
 * loopback provider, driven by the turn loop with the hooks `Subagent` passes.
 */
describe("structured result turn loop (real SDK session)", () => {
	let root: string;
	let projectDir: string;
	let agentDir: string;
	let loopback: Awaited<ReturnType<typeof startLoopback>>;
	let child: SubagentSession | undefined;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "structured-loop-"));
		projectDir = join(root, "project");
		agentDir = join(root, "agent");
		mkdirSync(projectDir, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(join(projectDir, "notes.txt"), "hello\n");
	});

	afterEach(async () => {
		await child?.dispose();
		child = undefined;
		await loopback.close();
		rmSync(root, { recursive: true, force: true });
	});

	/** Run the child to the end of its turn loop under `script`, with `onSession` called once it is bound; returns the run it wrote to. */
	async function runChild(
		script: ScriptedReply[],
		onSession?: (session: SubagentSession) => void,
	): Promise<SubagentRun> {
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

		const run = new SubagentRun("initial", false, {
			status: "running",
			expectsStructuredResult: true,
		});
		child = await createSubagentSession(
			{
				agentId: "a1",
				snapshot: { ...STUB_SNAPSHOT, cwd: projectDir },
				type: "reader",
				cwd: projectDir,
				resultSchema: SCHEMA,
				submitResult: (value) => run.submitStructuredResult(value),
			},
			createSubagentSessionDeps({
				io,
				exec: vi.fn(),
				registry: createAgentLookup({
					name: "reader",
					toolNames: ["read"],
					systemPrompt: "Read things.",
				}),
				lifecycle: createChildLifecycleMock(),
			}),
		);
		await child.session.bindExtensions({});
		onSession?.(child);
		await child.runTurnLoop("TASK", {
			onSubmitAttempt: () => run.recordSubmitAttempt(),
			hasStructuredResult: () => run.hasStructuredResult,
		});
		return run;
	}

	it("makes exactly one provider request when turn 1 only submits a valid result", async () => {
		const run = await runChild([[VALID]]);

		expect(loopback.requestCount()).toBe(1);
		expect(run.structuredResult).toEqual({ status: "done" });
	});

	it("emits both tool results and makes no further request when submit_result shares the batch", async () => {
		const toolResults: string[] = [];
		const run = await runChild(
			[[{ name: "read", args: { path: "notes.txt" } }, VALID]],
			(session) => {
				session.subscribe((event) => {
					if (event.type === "tool_execution_end")
						toolResults.push(event.toolName);
				});
			},
		);

		expect(loopback.requestCount()).toBe(1);
		expect(toolResults.sort()).toEqual(["read", "submit_result"]);
		expect(run.structuredResult).toEqual({ status: "done" });
	});

	it("lets the child retry after an invalid submission", async () => {
		const run = await runChild([[INVALID], [VALID]]);

		expect(loopback.requestCount()).toBe(2);
		expect(run.structuredResult).toEqual({ status: "done" });
	});
});
