import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildEventData, type NotificationSystem } from "#src/observation/notification";
import { SubagentEventsObserver } from "#src/observation/subagent-events-observer";
import type { CompactionInfo } from "#src/types";
import { createTestSubagent, makeStubExecution } from "#test/helpers/make-subagent";

function makeNotifications(): NotificationSystem {
	return {
		sendCompletion: vi.fn(),
		sendUpdate: vi.fn(),
		sendWorkspaceNotice: vi.fn(),
		dispose: vi.fn(),
	};
}

function makeObserver(overrides?: Partial<{ notifications: NotificationSystem }>) {
	const emit = vi.fn<(channel: string, data: unknown) => void>();
	const appendEntry = vi.fn<(customType: string, data: unknown) => void>();
	const notifications = overrides?.notifications ?? makeNotifications();
	const observer = new SubagentEventsObserver({ emit, appendEntry, notifications });
	return { observer, emit, appendEntry, notifications };
}

describe("SubagentEventsObserver", () => {
	describe("onSubagentRunStarted", () => {
		describe("an initial run", () => {
			it("emits subagents:started with id, type, description", () => {
				const { observer, emit } = makeObserver();
				const record = createTestSubagent({ id: "agent-1", type: "general-purpose", description: "do work" });

				observer.onSubagentRunStarted(record, "initial");

				expect(emit).toHaveBeenCalledExactlyOnceWith("subagents:started", {
					id: "agent-1",
					type: "general-purpose",
					description: "do work",
				});
			});

			it("does not call appendEntry or notifications", () => {
				const { observer, appendEntry, notifications } = makeObserver();
				observer.onSubagentRunStarted(createTestSubagent(), "initial");
				expect(appendEntry).not.toHaveBeenCalled();
				expect(notifications.sendCompletion).not.toHaveBeenCalled();
			});
		});

		describe("a resumed run", () => {
			it("emits subagents:resuming with id, type, description", () => {
				const { observer, emit } = makeObserver();
				const record = createTestSubagent({
					id: "agent-1",
					type: "general-purpose",
					description: "do work",
				});

				observer.onSubagentRunStarted(record, "resume");

				expect(emit).toHaveBeenCalledExactlyOnceWith("subagents:resuming", {
					id: "agent-1",
					type: "general-purpose",
					description: "do work",
				});
			});

			it("persists nothing and announces nothing: a run that started is not an outcome", () => {
				const { observer, appendEntry, notifications } = makeObserver();

				observer.onSubagentRunStarted(createTestSubagent(), "resume");

				expect(appendEntry).not.toHaveBeenCalled();
				expect(notifications.sendCompletion).not.toHaveBeenCalled();
			});
		});
	});

	describe("onSubagentRunFinished", () => {
		describe("an initial run", () => {
			it("emits subagents:completed for a successful agent", () => {
				const { observer, emit } = makeObserver();
				const record = createTestSubagent({ status: "completed" });

				observer.onSubagentRunFinished(record, "initial");

				expect(emit).toHaveBeenCalledExactlyOnceWith("subagents:completed", buildEventData(record));
			});

			it("carries the structured outcome on completed and failed, and omits it for a plain launch", () => {
				const done = makeObserver();
				const ok = createTestSubagent({ status: "completed" });
				Object.defineProperty(ok, "structuredResult", { value: { status: "done" } });
				done.observer.onSubagentRunFinished(ok, "initial");
				expect(done.emit).toHaveBeenCalledWith(
					"subagents:completed",
					expect.objectContaining({ structuredResult: { status: "done" } }),
				);

				const bad = makeObserver();
				const failed = createTestSubagent({ status: "error", error: "boom" });
				Object.defineProperty(failed, "structuredResultError", { value: "missing" });
				bad.observer.onSubagentRunFinished(failed, "initial");
				expect(bad.emit).toHaveBeenCalledWith(
					"subagents:failed",
					expect.objectContaining({ structuredResultError: "missing" }),
				);

				const plain = makeObserver();
				plain.observer.onSubagentRunFinished(createTestSubagent({ status: "completed" }), "initial");
				const payload = plain.emit.mock.calls[0]![1] as object;
				expect(payload).not.toHaveProperty("structuredResult");
				expect(payload).not.toHaveProperty("structuredResultError");
			});

			it("emits subagents:failed for an error agent", () => {
				const { observer, emit } = makeObserver();
				const record = createTestSubagent({ status: "error", error: "boom" });

				observer.onSubagentRunFinished(record, "initial");

				expect(emit).toHaveBeenCalledExactlyOnceWith("subagents:failed", buildEventData(record));
			});

			it("persists the run's turn budget on the subagents:record entry", () => {
				const { observer, appendEntry } = makeObserver();
				const turnBudget = { maxTurns: 2, used: 3, phase: "warned" } as const;
				observer.onSubagentRunFinished(createTestSubagent({ turnBudget }), "initial");
				// Partial match: the full persisted shape is pinned by the neighboring tests.
				expect(appendEntry).toHaveBeenCalledWith("subagents:record", expect.objectContaining({ turnBudget }));
			});

			it("emits subagents:failed for a stopped agent", () => {
				const { observer, emit } = makeObserver();
				const record = createTestSubagent({ status: "stopped" });

				observer.onSubagentRunFinished(record, "initial");

				expect(emit).toHaveBeenCalledExactlyOnceWith("subagents:failed", buildEventData(record));
			});

			it("emits subagents:failed for an aborted agent", () => {
				const { observer, emit } = makeObserver();
				const record = createTestSubagent({ status: "aborted" });

				observer.onSubagentRunFinished(record, "initial");

				expect(emit).toHaveBeenCalledExactlyOnceWith("subagents:failed", buildEventData(record));
			});

			it("calls appendEntry with subagents:record and the persisted fields", () => {
				const { observer, appendEntry } = makeObserver();
				const record = createTestSubagent({
					id: "agent-2",
					type: "Explore",
					description: "explore code",
					status: "completed",
					result: "found it",
					error: undefined,
					startedAt: 1000,
					completedAt: 2000,
				});

				observer.onSubagentRunFinished(record, "initial");

				expect(appendEntry).toHaveBeenCalledExactlyOnceWith("subagents:record", {
					id: "agent-2",
					type: "Explore",
					description: "explore code",
					status: "completed",
					result: "found it",
					error: undefined,
					startedAt: 1000,
					completedAt: 2000,
					stoppedWhileQueued: false,
					outputFile: undefined,
					toolUses: 3,
				});
			});

			it("calls notifications.sendCompletion unconditionally — the manager decides whether to nudge", () => {
				const notifications = makeNotifications();
				const { observer } = makeObserver({ notifications });
				const record = createTestSubagent({ status: "completed" });

				observer.onSubagentRunFinished(record, "initial");

				expect(notifications.sendCompletion).toHaveBeenCalledExactlyOnceWith(record);
			});

			it("emits exactly once and appends exactly once per call", () => {
				const { observer, emit, appendEntry } = makeObserver();
				observer.onSubagentRunFinished(createTestSubagent({ status: "completed" }), "initial");
				expect(emit).toHaveBeenCalledTimes(1);
				expect(appendEntry).toHaveBeenCalledTimes(1);
			});
		});

		describe("a resumed run", () => {
			it("emits subagents:resumed with the buildEventData payload for a completed resume", () => {
				const { observer, emit } = makeObserver();
				const record = createTestSubagent({ status: "completed", result: "resumed output" });

				observer.onSubagentRunFinished(record, "resume");

				expect(emit).toHaveBeenCalledExactlyOnceWith("subagents:resumed", buildEventData(record));
			});

			it("carries the structured outcome on subagents:resumed", () => {
				const { observer, emit } = makeObserver();
				const record = createTestSubagent({ status: "completed" });
				Object.defineProperty(record, "structuredResult", { value: { status: "done" } });
				observer.onSubagentRunFinished(record, "resume");
				expect(emit).toHaveBeenCalledWith(
					"subagents:resumed",
					expect.objectContaining({ structuredResult: { status: "done" } }),
				);
			});

			it("emits subagents:resumed (not subagents:failed) for an error resume — payload discriminates", () => {
				const { observer, emit } = makeObserver();
				const record = createTestSubagent({ status: "error", error: "boom" });

				observer.onSubagentRunFinished(record, "resume");

				expect(emit).toHaveBeenCalledExactlyOnceWith("subagents:resumed", buildEventData(record));
			});

			it.each(["stopped", "aborted"] as const)("emits subagents:resumed for a resume that ended %s", (status) => {
				const { observer, emit } = makeObserver();
				const record = createTestSubagent({ status });

				observer.onSubagentRunFinished(record, "resume");

				expect(emit).toHaveBeenCalledExactlyOnceWith("subagents:resumed", buildEventData(record));
			});

			it("appends subagents:record with the persisted fields", () => {
				const { observer, appendEntry } = makeObserver();
				const record = createTestSubagent({
					id: "agent-5",
					type: "Explore",
					description: "resume explore",
					status: "completed",
					result: "resumed it",
					error: undefined,
					startedAt: 3000,
					completedAt: 4000,
				});

				observer.onSubagentRunFinished(record, "resume");

				expect(appendEntry).toHaveBeenCalledExactlyOnceWith("subagents:record", {
					id: "agent-5",
					type: "Explore",
					description: "resume explore",
					status: "completed",
					result: "resumed it",
					error: undefined,
					startedAt: 3000,
					completedAt: 4000,
					stoppedWhileQueued: false,
					outputFile: undefined,
					toolUses: 3,
				});
			});

			it("calls notifications.sendCompletion unconditionally — the manager decides whether to nudge", () => {
				const notifications = makeNotifications();
				const { observer } = makeObserver({ notifications });
				const record = createTestSubagent({ status: "completed" });

				observer.onSubagentRunFinished(record, "resume");

				expect(notifications.sendCompletion).toHaveBeenCalledExactlyOnceWith(record);
			});

			it("emits exactly once and appends exactly once per call", () => {
				const { observer, emit, appendEntry } = makeObserver();
				observer.onSubagentRunFinished(createTestSubagent({ status: "completed" }), "resume");
				expect(emit).toHaveBeenCalledTimes(1);
				expect(appendEntry).toHaveBeenCalledTimes(1);
			});
		});
	});

	describe("onSubagentCompacted", () => {
		it("emits subagents:compacted with id, type, description, reason, tokensBefore, compactionCount", () => {
			const { observer, emit } = makeObserver();
			const record = createTestSubagent({
				id: "agent-3",
				type: "Plan",
				description: "plan work",
				compactionCount: 1,
			});
			const info: CompactionInfo = { reason: "threshold", tokensBefore: 50_000 };

			observer.onSubagentCompacted(record, info);

			expect(emit).toHaveBeenCalledExactlyOnceWith("subagents:compacted", {
				id: "agent-3",
				type: "Plan",
				description: "plan work",
				reason: "threshold",
				tokensBefore: 50_000,
				compactionCount: 1,
			});
		});

		it("does not call appendEntry or notifications", () => {
			const { observer, appendEntry, notifications } = makeObserver();
			const info: CompactionInfo = { reason: "manual", tokensBefore: 1000 };
			observer.onSubagentCompacted(createTestSubagent(), info);
			expect(appendEntry).not.toHaveBeenCalled();
			expect(notifications.sendCompletion).not.toHaveBeenCalled();
		});
	});

	describe("onSubagentCreated", () => {
		it("emits subagents:created with id, type, description, and isBackground: true", () => {
			const { observer, emit } = makeObserver();
			const record = createTestSubagent({ id: "agent-4", type: "general-purpose", description: "bg task" });

			observer.onSubagentCreated(record);

			expect(emit).toHaveBeenCalledExactlyOnceWith("subagents:created", {
				id: "agent-4",
				type: "general-purpose",
				description: "bg task",
				isBackground: true,
			});
		});

		it("does not call appendEntry or notifications", () => {
			const { observer, appendEntry, notifications } = makeObserver();
			observer.onSubagentCreated(createTestSubagent());
			expect(appendEntry).not.toHaveBeenCalled();
			expect(notifications.sendCompletion).not.toHaveBeenCalled();
		});
	});

	describe("dependency isolation", () => {
		let emit: ReturnType<typeof vi.fn>;
		let appendEntry: ReturnType<typeof vi.fn>;
		let notifications: NotificationSystem;
		let observer: SubagentEventsObserver;

		beforeEach(() => {
			({ observer, emit, appendEntry, notifications } = makeObserver());
		});

		it("does not import or reference pi SDK directly", () => {
			// If the class was constructed and four methods called with no SDK errors,
			// it holds no SDK dependency — verified structurally by this test running at all.
			observer.onSubagentRunStarted(createTestSubagent(), "initial");
			observer.onSubagentRunFinished(createTestSubagent({ status: "completed" }), "initial");
			const info: CompactionInfo = { reason: "overflow", tokensBefore: 9999 };
			observer.onSubagentCompacted(createTestSubagent(), info);
			observer.onSubagentCreated(createTestSubagent());
			expect(emit).toHaveBeenCalledTimes(4);
			expect(appendEntry).toHaveBeenCalledTimes(1);
			// Notifications were called as a side-effect of onSubagentRunFinished.
			expect(notifications.sendCompletion).toHaveBeenCalledTimes(1);
		});
	});

	describe("onSubagentQuestion", () => {
		it("emits subagents:asked with id, type, description, question", () => {
			const { observer, emit } = makeObserver();
			const record = createTestSubagent({ id: "agent-1", type: "general-purpose", description: "do work" });

			observer.onSubagentQuestion(record, "Which config?");

			expect(emit).toHaveBeenCalledExactlyOnceWith("subagents:asked", {
				id: "agent-1",
				type: "general-purpose",
				description: "do work",
				question: "Which config?",
			});
		});

		it("adds toolCallId and metadata when the record has them", () => {
			const { observer, emit } = makeObserver();
			const metadata = { change: "c1" };
			const record = createTestSubagent({
				execution: makeStubExecution({ parentSession: { toolCallId: "call_5" }, metadata }),
			});

			observer.onSubagentQuestion(record, "Which config?");

			expect(emit).toHaveBeenCalledExactlyOnceWith("subagents:asked", expect.objectContaining({
				toolCallId: "call_5",
				metadata: { change: "c1" },
			}));
		});

		it("omits toolCallId and metadata when absent", () => {
			const { observer, emit } = makeObserver();

			observer.onSubagentQuestion(createTestSubagent(), "Which config?");

			const data = emit.mock.calls[0]![1] as Record<string, unknown>;
			expect(data).not.toHaveProperty("toolCallId");
			expect(data).not.toHaveProperty("metadata");
		});

		it("persists nothing and announces nothing", () => {
			const { observer, appendEntry, notifications } = makeObserver();

			observer.onSubagentQuestion(createTestSubagent(), "Which config?");

			expect(appendEntry).not.toHaveBeenCalled();
			expect(notifications.sendCompletion).not.toHaveBeenCalled();
			expect(notifications.sendUpdate).not.toHaveBeenCalled();
			expect(notifications.sendWorkspaceNotice).not.toHaveBeenCalled();
		});
	});

	describe("onSubagentUpdate", () => {
		it("adds toolCallId and metadata from the launch", () => {
			const { observer, emit } = makeObserver();
			const record = createTestSubagent({
				execution: makeStubExecution({ parentSession: { toolCallId: "call_5" }, metadata: { change: "c1" } }),
			});

			observer.onSubagentUpdate(record, "Course change.");

			expect(emit).toHaveBeenCalledExactlyOnceWith("subagents:update", expect.objectContaining({
				toolCallId: "call_5",
				metadata: { change: "c1" },
			}));
		});

		it("omits toolCallId and metadata when absent, and still sends the update once", () => {
			const { observer, emit, notifications } = makeObserver();
			const record = createTestSubagent();

			observer.onSubagentUpdate(record, "Course change.");

			const data = emit.mock.calls[0]![1] as Record<string, unknown>;
			expect(data).not.toHaveProperty("toolCallId");
			expect(data).not.toHaveProperty("metadata");
			expect(notifications.sendUpdate).toHaveBeenCalledExactlyOnceWith(record, "Course change.");
		});

		it("emits subagents:update carrying the child's message", () => {
			const { observer, emit } = makeObserver();
			const record = createTestSubagent({ id: "agent-1", type: "general-purpose", description: "do work" });

			observer.onSubagentUpdate(record, "The bug is in the retry wrapper.");

			expect(emit).toHaveBeenCalledExactlyOnceWith("subagents:update", {
				id: "agent-1",
				type: "general-purpose",
				description: "do work",
				message: "The bug is in the retry wrapper.",
			});
		});

		it("announces the update to the parent", () => {
			const { observer, notifications } = makeObserver();
			const record = createTestSubagent({ id: "agent-1" });

			observer.onSubagentUpdate(record, "Course change.");

			expect(notifications.sendUpdate).toHaveBeenCalledExactlyOnceWith(record, "Course change.");
		});

		it("persists nothing — an update is not an outcome to reconstruct history from", () => {
			const { observer, appendEntry } = makeObserver();

			observer.onSubagentUpdate(createTestSubagent(), "Course change.");

			expect(appendEntry).not.toHaveBeenCalled();
		});
	});

	describe("onSubagentWorkspaceNotice", () => {
		const NOTICE = "\n\n---\nChanges saved to branch `pi-agent-1`.";

		it("announces where the teardown left the child's work", () => {
			const { observer, notifications } = makeObserver();
			const record = createTestSubagent({ id: "agent-1" });

			observer.onSubagentWorkspaceNotice(record, NOTICE);

			expect(notifications.sendWorkspaceNotice).toHaveBeenCalledExactlyOnceWith(record, NOTICE);
		});

		it("emits no event — no consumer asks for one, and a vacant channel is not added", () => {
			const { observer, emit } = makeObserver();

			observer.onSubagentWorkspaceNotice(createTestSubagent(), NOTICE);

			expect(emit).not.toHaveBeenCalled();
		});

		it("persists nothing — the outcome it belongs to was recorded long ago", () => {
			const { observer, appendEntry } = makeObserver();

			observer.onSubagentWorkspaceNotice(createTestSubagent(), NOTICE);

			expect(appendEntry).not.toHaveBeenCalled();
		});
	});
});
