import { validateToolArguments } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import {
	SubmitResultTool,
	type StructuredResultSink,
} from "#src/session/submit-result-tool";
import { SubagentRun } from "#src/lifecycle/subagent-run";
import type { ResultSchema } from "#src/service/service";
import { STUB_CTX } from "#test/helpers/stub-ctx";

const STATUS_SCHEMA: ResultSchema = {
	type: "object",
	properties: { status: { enum: ["done", "blocked"] } },
	required: ["status"],
	additionalProperties: false,
};

/** A sink over a stub that has no result yet and stores whatever it is given. */
function stubSink(outcome: "stored" | "already-submitted" = "stored") {
	return {
		hasResult: vi.fn(() => outcome === "already-submitted"),
		submit: vi.fn<StructuredResultSink["submit"]>(() => outcome),
	};
}

function runSink(run: SubagentRun): StructuredResultSink {
	return {
		hasResult: () => run.hasStructuredResult,
		submit: (value) => run.submitStructuredResult(value),
	};
}

function call(
	schema: ResultSchema,
	sink: StructuredResultSink,
	result: unknown,
) {
	const tool = new SubmitResultTool(schema, sink);
	return tool.execute(
		"tc-1",
		{ result },
		new AbortController().signal,
		undefined,
		STUB_CTX,
	);
}

function textOf(result: {
	content: readonly { type: string; text?: string }[];
}): string {
	return result.content.map((part) => part.text ?? "").join("");
}

describe("SubmitResultTool", () => {
	describe("the definition the child session receives", () => {
		it("is named submit_result and wraps the caller's schema under result", () => {
			const definition = new SubmitResultTool(
				STATUS_SCHEMA,
				stubSink(),
			).toToolDefinition();

			expect(definition.name).toBe("submit_result");
			expect(definition.parameters).toEqual({
				type: "object",
				properties: { result: STATUS_SCHEMA },
				required: ["result"],
				additionalProperties: false,
			});
		});

		it("tells the child to call it once with its final result before finishing", () => {
			const { description } = new SubmitResultTool(
				STATUS_SCHEMA,
				stubSink(),
			).toToolDefinition();

			expect(description).toMatch(/once/);
			expect(description).toMatch(/final result/);
			expect(description).toMatch(/before you finish/);
		});
	});

	describe("submitting", () => {
		it("rejects an invalid value with the violations and stores nothing", () => {
			const sink = stubSink();

			const result = call(STATUS_SCHEMA, sink, { status: "maybe" });

			expect(result.isError).toBe(true);
			expect(textOf(result)).toContain("result.status");
			expect(textOf(result)).toContain("done");
			expect(sink.submit).not.toHaveBeenCalled();
		});

		it("lists every violation of one node in the error text", () => {
			const sink = stubSink();

			const result = call(
				{ type: "integer", enum: [1] } as ResultSchema,
				sink,
				"bad",
			);

			expect(result.isError).toBe(true);
			expect(textOf(result)).toContain("integer");
			expect(textOf(result)).toContain("one of");
			expect(sink.submit).not.toHaveBeenCalled();
		});

		it("stores a valid value and terminates the batch", () => {
			const sink = stubSink();

			const result = call(STATUS_SCHEMA, sink, { status: "done" });

			expect(sink.submit).toHaveBeenCalledWith({ status: "done" });
			expect(result).toMatchObject({ terminate: true });
			expect(result).not.toHaveProperty("isError");
		});

		it("refuses a second submission as already submitted", () => {
			const result = call(STATUS_SCHEMA, stubSink("already-submitted"), {
				status: "done",
			});

			expect(result.isError).toBe(true);
			expect(textOf(result)).toMatch(/already submitted/);
		});

		it("names the offending property when the schema forbids extras", () => {
			const result = call(STATUS_SCHEMA, stubSink(), { status: "done", note: "x" });

			expect(result.isError).toBe(true);
			expect(textOf(result)).toContain("note");
		});

		it("names a property submitted as a non-integer", () => {
			const schema: ResultSchema = {
				type: "object",
				properties: { count: { type: "integer" } },
				required: ["count"],
			};

			const result = call(schema, stubSink(), { count: 1.5 });

			expect(result.isError).toBe(true);
			expect(textOf(result)).toContain("count");
		});

		describe("against a real run", () => {
			it("reports already submitted, not a schema error, for an invalid call after a stored result", () => {
				const run = new SubagentRun("initial", false, { status: "running", expectsStructuredResult: true });
				const sink = runSink(run);
				call(STATUS_SCHEMA, sink, { status: "done" });

				const result = call(STATUS_SCHEMA, sink, { status: "maybe" });

				expect(result.isError).toBe(true);
				expect(textOf(result)).toMatch(/already submitted/);
				expect(textOf(result)).not.toMatch(/does not match/);
				expect(run.structuredResult).toEqual({ status: "done" });
			});

			it("reports already submitted for a second valid call and keeps the first value", () => {
				const run = new SubagentRun("initial", false, { status: "running", expectsStructuredResult: true });
				const sink = runSink(run);
				call(STATUS_SCHEMA, sink, { status: "done" });

				const result = call(STATUS_SCHEMA, sink, { status: "blocked" });

				expect(result.isError).toBe(true);
				expect(textOf(result)).toMatch(/already submitted/);
				expect(run.structuredResult).toEqual({ status: "done" });
			});
		});

		it.each([
			[{ type: "boolean" }, false],
			[{ type: "number" }, 0],
			[{ type: "string" }, ""],
		] as const)(
			"passes the falsy valid value %j to the sink",
			(schema, value) => {
				const sink = stubSink();

				call(schema as ResultSchema, sink, value);

				expect(sink.submit).toHaveBeenCalledWith(value);
			},
		);

		it("stores the value Pi coerced before execute", () => {
			const sink = stubSink();
			const tool = new SubmitResultTool({ type: "integer" }, sink);
			const definition = tool.toToolDefinition();

			const args = validateToolArguments(definition, {
				type: "toolCall",
				id: "tc-1",
				name: "submit_result",
				arguments: { result: "42" },
			});
			tool.execute(
				"tc-1",
				args as { result: unknown },
				new AbortController().signal,
				undefined,
				STUB_CTX,
			);

			expect(sink.submit).toHaveBeenCalledWith(42);
		});
	});
});
