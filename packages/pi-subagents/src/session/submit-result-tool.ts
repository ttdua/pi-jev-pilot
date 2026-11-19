/**
 * submit-result-tool.ts — The tool a child submits its structured final result with.
 *
 * Installed only on a child launched with a result schema. The tool validates
 * the value against the caller's schema and is the authority on what is stored:
 * whatever Pi's own argument validation lets through, nothing outside the
 * schema subset's rules reaches the sink. The first valid submission is final
 * for the run; the result carries `terminate: true`, and the turn loop ends the
 * run after the current turn.
 *
 * Lives in `session/` for the same reason as `ask-parent-tool.ts`: it is
 * installed on the child's session by the assembly factory.
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { validateResult } from "#src/seams/result-schema";
import type { ResultSchema } from "#src/service/service";

export const SUBMIT_RESULT_TOOL_NAME = "submit_result";

/**
 * The current run's result slot. `hasResult` lets the tool answer "already
 * submitted" before it validates; `submit` stores a validated value and refuses
 * once one is stored.
 */
export interface StructuredResultSink {
	hasResult(): boolean;
	submit(value: unknown): "stored" | "already-submitted";
}

const STORED_TEXT = "Result submitted. Your run ends after this turn.";
const ALREADY_SUBMITTED_TEXT =
	"A result was already submitted for this run. It is final; do not submit again.";

interface SubmitResultOutput {
	content: { type: "text"; text: string }[];
	details: undefined;
	isError?: boolean;
	terminate?: boolean;
}

export class SubmitResultTool {
	constructor(
		private readonly schema: ResultSchema,
		private readonly sink: StructuredResultSink,
	) {}

	execute(
		_toolCallId: string,
		params: { result: unknown },
		_signal: AbortSignal,
		_onUpdate: unknown,
		_ctx: unknown,
	): SubmitResultOutput {
		if (this.sink.hasResult()) return this.error(ALREADY_SUBMITTED_TEXT);
		const violations = validateResult(this.schema, params.result);
		if (violations.length > 0) {
			const lines = violations.map(
				(violation) => `- ${violation.path}: ${violation.message}`,
			);
			return this.error(
				`The result does not match the required schema:\n${lines.join("\n")}\nFix it and call submit_result again.`,
			);
		}
		if (this.sink.submit(params.result) === "already-submitted")
			return this.error(ALREADY_SUBMITTED_TEXT);
		return {
			content: [{ type: "text" as const, text: STORED_TEXT }],
			details: undefined,
			terminate: true,
		};
	}

	private error(text: string): SubmitResultOutput {
		return {
			content: [{ type: "text" as const, text }],
			details: undefined,
			isError: true,
		};
	}

	toToolDefinition() {
		return defineTool({
			name: SUBMIT_RESULT_TOOL_NAME,
			label: "Submit Result",
			promptSnippet:
				"Submit your final structured result, once, before finishing.",
			description:
				"Submit your final result as structured data matching the required schema. Call it once, " +
				"with your final result, before you finish; the first valid submission is final and ends your run. " +
				"If the call is rejected, fix the value and call again.",
			// The caller's schema is the validated JSON Schema subset, which is what the tool-parameter type carries.
			parameters: {
				type: "object",
				properties: { result: this.schema },
				required: ["result"],
				additionalProperties: false,
			} as unknown as TSchema,
			execute: (
				toolCallId: string,
				params: { result: unknown },
				signal: AbortSignal,
				onUpdate: unknown,
				ctx: unknown,
			) =>
				Promise.resolve(
					this.execute(toolCallId, params, signal, onUpdate, ctx),
				),
		});
	}
}
