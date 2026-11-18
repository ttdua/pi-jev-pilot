import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type StreamedRecord, startProgressStream } from "#src/tools/progress-stream";
import { createTestSubagent, makeStubExecution } from "#test/helpers/make-subagent";

const detailBase = {
	displayName: "Explore",
	description: "map the retry path",
	subagentType: "Explore",
	modelName: "anthropic/claude-haiku-5-5",
	tags: undefined,
};

describe("startProgressStream", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("streams the presentation alone before the run has a record", () => {
		const onUpdate = vi.fn();

		const stop = startProgressStream({ detailBase, onUpdate, getRecord: () => undefined });
		stop();

		expect(onUpdate).toHaveBeenCalledExactlyOnceWith({
			content: [{ type: "text", text: "0 tool uses..." }],
			details: {
				...detailBase,
				toolUses: 0,
				tokens: "",
				durationMs: 0,
				status: "running",
				activity: "thinking…",
				spinnerFrame: 0,
			},
		});
	});

	it("reads the record afresh on every tick", async () => {
		const onUpdate = vi.fn();
		const current: { record?: StreamedRecord } = {};
		const stop = startProgressStream({ detailBase, onUpdate, getRecord: () => current.record });

		current.record = createTestSubagent({
			status: "running",
			completedAt: undefined,
			toolUses: 7,
			lifetimeUsage: { input: 2000, output: 0, cacheWrite: 0 },
			responseText: "The retry wrapper swallows the error.",
			turnBudget: { maxTurns: 10, used: 3, phase: "within" },
		});
		await vi.advanceTimersByTimeAsync(80);
		stop();

		expect(onUpdate).toHaveBeenLastCalledWith({
			content: [{ type: "text", text: "7 tool uses..." }],
			details: {
				...detailBase,
				toolUses: 7,
				tokens: "2.0k token",
				turnBudget: { maxTurns: 10, used: 3, phase: "within" },
				durationMs: 80,
				status: "running",
				activity: "The retry wrapper swallows the error.",
				spinnerFrame: 1,
			},
		});
	});

	it("streams the record's live thinking", () => {
		const onUpdate = vi.fn();
		const record: StreamedRecord = {
			toolUses: 0,
			model: undefined,
			lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
			turnBudget: undefined,
			activeTools: new Map(),
			responseText: "",
			thinkingLevel: "low",
			toolFacts: { toolCount: 4, blockedToolCount: 1 },
			context: "fresh",
			contextFallback: undefined,
		};

		const stop = startProgressStream({
			detailBase: { ...detailBase, thinking: "high" },
			onUpdate,
			getRecord: () => record,
		});
		stop();

		const details = onUpdate.mock.calls[0][0].details;
		expect(details.thinking).toBe("low");
		expect(details.toolCount).toBe(4);
		expect(details.blockedToolCount).toBe(1);
	});

	it.each([
		["a fork", { context: "fork" as const, contextFallback: undefined }, "fork"],
		["a fresh run after a fallback", { context: "fresh" as const, contextFallback: "no-parent-session" as const }, "fork → fresh"],
		["a fresh run without a fallback", { context: "fresh" as const, contextFallback: undefined }, undefined],
	])("labels %s from the record on every streamed update", (_name, run, label) => {
		const onUpdate = vi.fn();
		const stop = startProgressStream({
			detailBase: { ...detailBase, modeLabel: "stale" },
			onUpdate,
			getRecord: () =>
				createTestSubagent({
					status: "running",
					completedAt: undefined,
					execution: makeStubExecution({ context: run.context, contextFallback: run.contextFallback }),
				}) as StreamedRecord,
		});
		stop();

		expect(onUpdate.mock.calls[0][0].details.modeLabel).toBe(label);
	});

	it("streams nothing more once stopped, and stops again harmlessly", async () => {
		const onUpdate = vi.fn();
		const stop = startProgressStream({ detailBase, onUpdate, getRecord: () => undefined });

		stop();
		stop();
		onUpdate.mockClear();
		await vi.advanceTimersByTimeAsync(400);

		expect(onUpdate).not.toHaveBeenCalled();
	});
});
