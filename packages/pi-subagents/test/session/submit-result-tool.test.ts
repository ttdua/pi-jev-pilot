import { validateToolArguments } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import {
	SubmitResultTool,
	type StructuredResultSink,
} from "#src/session/submit-result-tool";
import type { ResultSchema } from "#src/service/service";
import { STUB_CTX } from "#test/helpers/stub-ctx";

const STATUS_SCHEMA: ResultSchema = {
	type: "object",
	properties: { status: { enum: ["done", "blocked"] } },
	required: ["status"],
	additionalProperties: false,
};

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
				vi.fn(),
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
				vi.fn(),
			).toToolDefinition();

			expect(description).toMatch(/once/);
			expect(description).toMatch(/final result/);
			expect(description).toMatch(/before you finish/);
		});
	});

	describe("submitting", () => {
		it("rejects an invalid value with the violations and stores nothing", () => {
			const sink = vi.fn<StructuredResultSink>();

			const result = call(STATUS_SCHEMA, sink, { status: "maybe" });

			expect(result.isError).toBe(true);
			expect(textOf(result)).toContain("result.status");
			expect(textOf(result)).toContain("done");
			expect(sink).not.toHaveBeenCalled();
		});

		it("stores a valid value and terminates the batch", () => {
			const sink = vi.fn<StructuredResultSink>(() => "stored");

			const result = call(STATUS_SCHEMA, sink, { status: "done" });

			expect(sink).toHaveBeenCalledWith({ status: "done" });
			expect(result).toMatchObject({ terminate: true });
			expect(result).not.toHaveProperty("isError");
		});

		it("refuses a second submission as already submitted", () => {
			const result = call(STATUS_SCHEMA, () => "already-submitted", {
				status: "done",
			});

			expect(result.isError).toBe(true);
			expect(textOf(result)).toMatch(/already submitted/);
		});

		it.each([
			[{ type: "boolean" }, false],
			[{ type: "number" }, 0],
			[{ type: "string" }, ""],
		] as const)(
			"passes the falsy valid value %j to the sink",
			(schema, value) => {
				const sink = vi.fn<StructuredResultSink>(() => "stored");

				call(schema as ResultSchema, sink, value);

				expect(sink).toHaveBeenCalledWith(value);
			},
		);

		it("stores the value Pi coerced before execute", () => {
			const sink = vi.fn<StructuredResultSink>(() => "stored");
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

			expect(sink).toHaveBeenCalledWith(42);
		});
	});
});
