/**
 * SubagentsService.wait, driven through the real boundaries: service adapter →
 * SubagentManager (+ ConcurrencyLimiter) → Subagent → createSubagentSession →
 * events observer → NotificationManager. Only the SDK session is scripted.
 */
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChildLifecyclePublisher } from "#src/lifecycle/child-lifecycle";
import { ConcurrencyLimiter } from "#src/lifecycle/concurrency-limiter";
import { createSubagentSession } from "#src/lifecycle/create-subagent-session";
import type { ParentSnapshot } from "#src/lifecycle/parent-snapshot";
import type { SubagentRun } from "#src/lifecycle/subagent-run";
import { SubagentManager } from "#src/lifecycle/subagent-manager";
import { CompositeSubagentObserver } from "#src/observation/composite-subagent-observer";
import { NotificationManager } from "#src/observation/notification";
import { SubagentEventsObserver } from "#src/observation/subagent-events-observer";
import { resetChildSessions } from "#src/seams/child-sessions";
import { AgentTypeCatalog } from "#src/seams/registry";
import { SubagentsServiceAdapter } from "#src/service/service-adapter";
import { resolveModel } from "#src/session/model-resolver";
import { GetResultTool } from "#src/tools/get-result-tool";
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
const modelRegistry = { find: () => undefined, getAll: () => [MAIN], getAvailable: () => [MAIN] };
const snapshot: ParentSnapshot = { ...STUB_SNAPSHOT, model: MAIN, modelRegistry };

type Session = ReturnType<typeof createFactorySession> & { sendCustomMessage: ReturnType<typeof vi.fn> };
type Event = { channel: string; data: Record<string, any> };

/** What a scripted prompt gets: the child's tools, its session, and helpers to act like a model. */
interface Turn {
	/** Which prompt this is, across the whole harness (0-based). */
	n: number;
	prompt: string;
	session: Session;
	tool(name: "ask_parent" | "notify_parent" | "submit_result", params: Record<string, unknown>): Promise<void>;
	/** Append the assistant's final text, as Pi does when a turn settles. */
	say(text: string): void;
	/** Park until `gate` resolves or the session is aborted (an abort ends the child's turn). */
	park(gate: Promise<unknown>): Promise<void>;
}

interface Options {
	maxConcurrent?: number;
	script: (turn: Turn) => Promise<void>;
}

let childCounter = 0;
const toClean: SubagentManager[] = [];

function harness(options: Options) {
	const events: Event[] = [];
	const sent: { customType: string; content: string }[] = [];
	const prompts: string[] = [];
	const subscribers = new Map<string, ((data: Record<string, any>) => void)[]>();
	let limit = options.maxConcurrent ?? 4;
	const registry = registryWithGeneral(
		() => new Map([["Explore", makeAgentConfig({ name: "Explore", toolNames: ["read"], runInBackground: true })]]),
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
		async (opts: { sessionManager: { getSessionId(): string }; customTools?: ToolDefinition[] }) => {
			const session = createFactorySession() as Session;
			Object.assign(session, { model: MAIN, thinkingLevel: "off" });
			session.sendCustomMessage = vi.fn(() => Promise.resolve());
			const aborted = Promise.withResolvers<void>();
			session.abort.mockImplementation(() => { aborted.resolve(); });
			session.prompt.mockImplementation(async (prompt: string) => {
				const n = prompts.length;
				prompts.push(prompt);
				const tools = opts.customTools ?? [];
				await options.script({
					n,
					prompt,
					session,
					tool: async (name, params) => {
						const tool = tools.find((t) => t.name === name);
						if (!tool) throw new Error(`tool ${name} not installed`);
						await tool.execute("tc", params as never, new AbortController().signal, () => {}, {} as never);
					},
					say: (text) => {
						session.messages.push({ role: "assistant", content: [{ type: "text", text }] });
					},
					park: async (gate) => { await Promise.race([gate, aborted.promise]); },
				});
			});
			return { session };
		},
	);
	const emit = (channel: string, data: unknown) => {
		const event = { channel, data: data as Record<string, any> };
		events.push(event);
		for (const fn of subscribers.get(channel) ?? []) fn(event.data);
	};
	const notifications = new NotificationManager((msg) => { sent.push(msg); });
	const sessionDeps = {
		...createSubagentSessionDeps({ io, registry, listParentToolNames: () => ["read"] }),
		lifecycle: createChildLifecyclePublisher(emit),
	};
	const limiter = new ConcurrencyLimiter(() => limit);
	const manager = new SubagentManager({
		createSubagentSession: (params) => createSubagentSession(params, sessionDeps),
		baseCwd: "/repo",
		observer: new CompositeSubagentObserver([
			new SubagentEventsObserver({ emit, appendEntry: () => undefined, notifications }),
		]),
		limiter,
		registry,
		launchContext: {
			listParentTools: () => [{ name: "read", sourceInfo: { source: "local", origin: "top-level" } }],
			excludedPackages: () => [],
		},
	});
	toClean.push(manager);
	const runtime = {
		currentCtx: { modelRegistry } as never,
		buildSnapshot: () => snapshot,
		getModelInfo: () => ({ parentModel: MAIN, modelRegistry }),
		getSessionInfo: () => ({ parentSessionFile: "/sessions/p.jsonl", parentSessionId: "p1" }),
	};
	const service = new SubagentsServiceAdapter(manager, resolveModel, runtime, new AgentTypeCatalog(registry));
	return {
		service,
		manager,
		sent,
		prompts,
		registry,
		on: (channel: string) => events.filter((e) => e.channel === channel),
		subscribe: (channel: string, fn: (data: Record<string, any>) => void) => {
			subscribers.set(channel, [...(subscribers.get(channel) ?? []), fn]);
		},
		setLimit: (n: number) => { limit = n; limiter.recheck(); },
		spawn: (opts: Record<string, unknown> = {}) => service.spawn("Explore", "go", opts),
		nudges: () => sent.filter((m) => m.customType === "subagent-notification"),
		updates: () => sent.filter((m) => m.customType === "subagent-update"),
		settled: (id: string) => manager.getRecord(id)!.promise,
	};
}

beforeEach(() => {
	vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
	await Promise.all(toClean.splice(0).map((m) => m.dispose()));
	resetChildSessions();
	vi.restoreAllMocks();
});

/** Let pending microtasks (and the short chains behind them) run. */
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

/** Whether a promise has settled yet, after a flush. */
async function pending(promise: Promise<unknown>): Promise<boolean> {
	let done = false;
	void promise.then(() => { done = true; }, () => { done = true; });
	await flush();
	return !done;
}

const finish = (text = "done") => async (t: Turn) => { t.say(text); };

describe("SubagentsService.wait", () => {
	describe("resolving", () => {
		it("resolves with completed and the result", async () => {
			const h = harness({ script: finish("done") });
			const id = h.spawn();
			const record = await h.service.wait(id);
			expect([record.status, record.result]).toEqual(["completed", "done"]);
		});

		it("waits through the queue", async () => {
			const h = harness({ maxConcurrent: 0, script: finish() });
			const id = h.spawn();
			const wait = h.service.wait(id);
			expect(await pending(wait)).toBe(true);
			expect(h.service.getRecord(id)?.status).toBe("queued");

			h.setLimit(1);
			expect((await wait).status).toBe("completed");
		});

		it("stopped while queued behind a busy slot", async () => {
			const gate = Promise.withResolvers<void>();
			const h = harness({
				maxConcurrent: 1,
				script: async (t) => {
					if (t.n === 0) await t.park(gate.promise);
					t.say("done");
				},
			});
			const first = h.spawn();
			const second = h.spawn();
			const wait = h.service.wait(second);
			await flush();

			h.service.abort(second);

			expect((await wait).status).toBe("stopped");
			expect(h.service.getRecord(first)?.status).toBe("running");
			gate.resolve();
			await h.settled(first);
		});

		it("foreground service launch", async () => {
			const h = harness({ script: finish("fg") });
			const id = h.spawn({ foreground: true });
			const record = await h.service.wait(id);
			expect([record.status, record.result]).toEqual(["completed", "fg"]);
		});

		it("resolves at once when already settled", async () => {
			const h = harness({ script: finish() });
			const id = h.spawn();
			await h.settled(id);
			expect((await h.service.wait(id)).status).toBe("completed");
		});

		it("marks a settled waited outcome collected", async () => {
			const h = harness({ script: finish() });
			const id = h.spawn();
			await h.service.wait(id);
			expect(h.manager.getRecord(id)!.consumed).toBe(true);
		});

		it("resolves with error, not rejects", async () => {
			const h = harness({ script: async () => { throw new Error("boom"); } });
			const id = h.spawn();
			const record = await h.service.wait(id);
			expect([record.status, record.error]).toEqual(["error", "boom"]);
		});

		it("resolves stopped on abort(id)", async () => {
			const h = harness({ script: async (t) => { await t.park(new Promise(() => {})); } });
			const id = h.spawn();
			const wait = h.service.wait(id);
			await flush();
			h.service.abort(id);
			expect((await wait).status).toBe("stopped");
		});

		it("queued resume stopped", async () => {
			const gate = Promise.withResolvers<void>();
			const h = harness({
				maxConcurrent: 1,
				script: async (t) => {
					if (t.n === 1) await t.park(gate.promise);
					t.say("done");
				},
			});
			const id = h.spawn();
			await h.settled(id);
			const busy = h.spawn();
			await flush();
			const resumed = h.service.resume(id, "more");
			expect(h.service.getRecord(id)?.status).toBe("queued");

			const wait = h.service.wait(id);
			h.service.abort(id);

			expect((await wait).status).toBe("stopped");
			gate.resolve();
			await h.settled(busy);
			await resumed;
		});
	});

	describe("refusals and signals", () => {
		it("rejects for an unknown id", async () => {
			const h = harness({ script: finish() });
			await expect(h.service.wait("missing")).rejects.toThrow(/missing/);
		});

		it("signal abort rejects and leaves the run going", async () => {
			const gate = Promise.withResolvers<void>();
			const h = harness({ script: async (t) => { await t.park(gate.promise); t.say("late"); } });
			const id = h.spawn();
			const controller = new AbortController();
			const wait = h.service.wait(id, { signal: controller.signal });
			await flush();
			const reason = new Error("caller gave up");
			controller.abort(reason);

			await expect(wait).rejects.toBe(reason);
			expect(h.service.getRecord(id)?.status).toBe("running");
			gate.resolve();
			await h.settled(id);
			expect(h.service.getRecord(id)?.status).toBe("completed");
		});

		it("already-aborted signal on a settled run resolves", async () => {
			const h = harness({ script: finish() });
			const id = h.spawn();
			await h.settled(id);
			const record = await h.service.wait(id, { signal: AbortSignal.abort() });
			expect(record.status).toBe("completed");
		});
	});

	describe("routing while waited", () => {
		it("no nudge while waited", async () => {
			const h = harness({ script: finish() });
			const id = h.spawn();
			await h.service.wait(id);
			await flush();
			expect(h.nudges()).toHaveLength(0);
		});

		it("no update message while waited", async () => {
			const h = harness({
				script: async (t) => { await t.tool("notify_parent", { message: "Halfway." }); t.say("done"); },
			});
			const id = h.spawn();
			await h.service.wait(id);
			expect(h.on("subagents:update")).toHaveLength(1);
			expect(h.updates()).toHaveLength(0);
		});

		it("unwaited service launch unchanged", async () => {
			const h = harness({ script: finish() });
			const id = h.spawn();
			await h.settled(id);
			await flush();
			expect(h.nudges()).toHaveLength(1);
		});

		it("aborted wait gives the outcome back", async () => {
			const gate = Promise.withResolvers<void>();
			const h = harness({
				script: async (t) => {
					await t.tool("notify_parent", { message: "Halfway." });
					await t.park(gate.promise);
					t.say("done");
				},
			});
			const id = h.spawn();
			const controller = new AbortController();
			const wait = h.service.wait(id, { signal: controller.signal });
			await flush();
			expect(h.updates()).toHaveLength(0);
			controller.abort();
			await expect(wait).rejects.toBeDefined();

			gate.resolve();
			await h.settled(id);
			await flush();

			expect(h.nudges()).toHaveLength(1);
			expect(h.nudges()[0]!.content).toContain("Halfway.");
		});

		it("concurrent waiters", async () => {
			const gate = Promise.withResolvers<void>();
			const h = harness({ script: async (t) => { await t.park(gate.promise); t.say("done"); } });
			const id = h.spawn();
			const controller = new AbortController();
			const first = h.service.wait(id, { signal: controller.signal });
			const second = h.service.wait(id);
			await flush();
			controller.abort();
			await expect(first).rejects.toBeDefined();

			gate.resolve();
			expect((await second).status).toBe("completed");
			await flush();
			expect(h.nudges()).toHaveLength(0);
		});

		it("another carrier still holds the run", async () => {
			const gate = Promise.withResolvers<void>();
			const h = harness({ script: async (t) => { await t.park(gate.promise); t.say("the answer"); } });
			const id = h.spawn();
			const tool = new GetResultTool(h.manager, h.registry);
			const fetched = tool.execute("tc", { agent_id: id, wait: true }, new AbortController().signal, undefined, {});
			const controller = new AbortController();
			const wait = h.service.wait(id, { signal: controller.signal });
			await flush();
			controller.abort();
			await expect(wait).rejects.toBeDefined();

			gate.resolve();
			const result = await fetched;
			await flush();

			expect(h.nudges()).toHaveLength(0);
			expect(JSON.stringify(result.content)).toContain("the answer");
		});
	});

	describe("questions", () => {
		it("ask, answer, continue", async () => {
			const h = harness({
				script: async (t) => {
					if (t.n === 0) {
						await t.tool("ask_parent", { question: "Which config?" });
						t.say("need input");
					} else t.say("all done");
				},
			});
			const id = h.spawn();
			const first = await h.service.wait(id);
			expect(first.pendingQuestion).toBe("Which config?");
			expect(first).not.toHaveProperty("resumeRefusal");
			const initialRun = h.manager.getRecord(id)!.latestRun as SubagentRun;
			expect(initialRun.claimed).toBe(true);

			void h.service.resume(id, "The project one.");
			expect(initialRun.claimed).toBe(true);
			expect(h.manager.getRecord(id)!.latestRun).not.toBe(initialRun);
			expect(h.manager.getRecord(id)!.claimed).toBe(false);
			const second = await h.service.wait(id);

			expect([second.result, second.pendingQuestion]).toEqual(["all done", undefined]);
			expect(h.prompts.at(-1)).toBe("The project one.");
			await flush();
			expect(h.nudges()).toHaveLength(0);
		});

		it("failure after ask", async () => {
			const h = harness({
				script: async (t) => {
					await t.tool("ask_parent", { question: "Q" });
					throw new Error("boom");
				},
			});
			const id = h.spawn();
			const record = await h.service.wait(id);
			expect(record.status).toBe("error");
			expect(record).not.toHaveProperty("pendingQuestion");
			expect(h.on("subagents:asked")).toHaveLength(1);
		});

		it("question at the turn limit", async () => {
			const h = harness({
				script: async (t) => {
					await t.tool("ask_parent", { question: "Q" });
					for (let i = 0; i < 5 && t.session.abort.mock.calls.length === 0; i++) {
						// As Pi's agent loop: the completed-turn hook runs, then `turn_end`.
						const turn = {
							message: { role: "assistant", stopReason: "toolUse" },
							toolResults: [{ role: "toolResult" }],
						};
						t.session.emit({ type: "turn_start" });
						await t.session.agent.finishTurn?.(turn);
						t.session.emit({ type: "turn_end", ...turn });
					}
					t.say("partial");
				},
			});
			const id = h.spawn({ maxTurns: 2 });
			const record = await h.service.wait(id);
			expect([record.status, record.pendingQuestion]).toEqual(["aborted", "Q"]);
		});

		it("resumed before the waiter reads it", async () => {
			vi.useFakeTimers({ toFake: ["Date"] });
			try {
				vi.setSystemTime(1_000);
				const gate = Promise.withResolvers<void>();
				const h = harness({
					script: async (t) => {
						if (t.n === 0) {
							await t.tool("ask_parent", { question: "Q" });
							vi.setSystemTime(2_000);
							t.say("first");
						} else {
							await t.park(gate.promise);
							t.say("second");
						}
					},
				});
				let initial: { startedAt: number; completedAt?: number } | undefined;
				h.subscribe("subagents:completed", (data) => {
					const snap = h.service.getRecord(data.id)!;
					initial = { startedAt: snap.startedAt, completedAt: snap.completedAt };
					vi.setSystemTime(3_000);
					void h.service.resume(data.id, "A");
				});
				const id = h.spawn();

				const record = await h.service.wait(id);

				expect([record.status, record.result, record.pendingQuestion, record.resumeRefusal]).toEqual(["completed", "first", "Q", "still-running"]);
				expect(initial).toEqual({ startedAt: 1_000, completedAt: 2_000 });
				expect([record.startedAt, record.completedAt]).toEqual([initial!.startedAt, initial!.completedAt]);
				const live = h.service.getRecord(id)!;
				expect([live.status, live.startedAt]).toEqual(["running", 3_000]);
				gate.resolve();
				await h.settled(id);
			} finally {
				vi.useRealTimers();
			}
		});
	});

	describe("structured outcome", () => {
		const resultSchema = { type: "object", properties: { status: { type: "string" } }, required: ["status"] };

		it("resumed before the waiter reads it", async () => {
			const gate = Promise.withResolvers<void>();
			const h = harness({
				script: async (t) => {
					if (t.n === 0) {
						await t.tool("ask_parent", { question: "Q" });
						t.say("first");
					} else {
						await t.tool("submit_result", { result: { status: "done" } });
						await t.park(gate.promise);
						t.say("second");
					}
				},
			});
			h.subscribe("subagents:completed", (data) => { void h.service.resume(data.id, "A"); });
			const id = h.spawn({ resultSchema });

			const record = await h.service.wait(id);

			expect(h.service.getRecord(id)!.structuredResult).toEqual({ status: "done" });
			expect(record.pendingQuestion).toBe("Q");
			expect(record).not.toHaveProperty("structuredResult");
			expect(record).not.toHaveProperty("structuredResultError");
			gate.resolve();
			await h.settled(id);
		});

		it("resumed after a missing result", async () => {
			const gate = Promise.withResolvers<void>();
			const h = harness({
				script: async (t) => {
					if (t.n === 0) {
						t.say("first");
					} else {
						await t.park(gate.promise);
						t.say("second");
					}
				},
			});
			h.subscribe("subagents:completed", (data) => { void h.service.resume(data.id, "A"); });
			const id = h.spawn({ resultSchema });

			const record = await h.service.wait(id);

			expect(record.structuredResultError).toBe("missing");
			expect(h.service.getRecord(id)).not.toHaveProperty("structuredResultError");
			gate.resolve();
			await h.settled(id);
		});

		it("waited run submitted", async () => {
			const h = harness({
				script: async (t) => {
					await t.tool("submit_result", { result: { status: "done" } });
					t.say("done");
				},
			});
			const id = h.spawn({ resultSchema });

			const record = await h.service.wait(id);

			expect([record.status, record.structuredResult]).toEqual(["completed", { status: "done" }]);
			expect(record).not.toHaveProperty("structuredResultError");
		});
	});
});
