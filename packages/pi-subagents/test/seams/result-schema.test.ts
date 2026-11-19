import { describe, expect, it } from "vitest";
import { parseResultSchema, validateResult } from "#src/seams/result-schema";
import type { ResultSchema } from "#src/service/service";

const issueSchema = {
	type: "object",
	properties: { status: { enum: ["done", "blocked"] } },
	required: ["status"],
	additionalProperties: false,
};

function deepFrozen(value: unknown): boolean {
	if (typeof value !== "object" || value === null) return true;
	if (!Object.isFrozen(value)) return false;
	return Object.values(value).every(deepFrozen);
}

describe("parseResultSchema", () => {
	it("returns undefined for undefined", () => {
		expect(parseResultSchema(undefined)).toBeUndefined();
	});

	it("accepts the issue example and returns a deep-frozen copy", () => {
		const parsed = parseResultSchema(issueSchema);

		expect(parsed).toEqual(issueSchema);
		expect(parsed).not.toBe(issueSchema);
		expect(deepFrozen(parsed)).toBe(true);
	});

	it("keeps the parsed copy unchanged when the input enum is mutated", () => {
		const input = {
			type: "object",
			properties: { status: { enum: ["done", "blocked"] } },
		};
		const parsed = parseResultSchema(input);

		input.properties.status.enum.push("partial");

		expect(parsed).toEqual({
			type: "object",
			properties: { status: { enum: ["done", "blocked"] } },
		});
	});

	it("refuses a nested type key present with value undefined", () => {
		expect(() =>
			parseResultSchema({
				type: "object",
				properties: { status: { type: undefined } },
			}),
		).toThrow(/\/properties\/status\/type: type must be/);
	});

	it("names minimum and its pointer for an unsupported keyword", () => {
		expect(() =>
			parseResultSchema({
				type: "object",
				properties: { n: { type: "number", minimum: 0 } },
			}),
		).toThrow(/minimum.*\/properties\/n\/minimum/);
	});

	it.each([
		["no root type", { properties: {} }],
		["null type", { type: "null" }],
		["array type", { type: ["string"] }],
	])("refuses %s naming type", (_label, input) => {
		expect(() => parseResultSchema(input)).toThrow(/type/);
	});

	it("refuses the draft-07 $schema naming $schema", () => {
		expect(() =>
			parseResultSchema({
				$schema: "http://json-schema.org/draft-07/schema#",
				type: "string",
			}),
		).toThrow(/\$schema/);
	});

	it("accepts the 2020-12 $schema with title and description", () => {
		expect(() =>
			parseResultSchema({
				$schema: "https://json-schema.org/draft/2020-12/schema",
				title: "Result",
				description: "Final status",
				type: "string",
			}),
		).not.toThrow();
	});

	it.each([
		["array root", []],
		["class instance root", new (class Foo {})()],
		["null root", null],
	])("refuses a non-plain %s", (_label, input) => {
		expect(() => parseResultSchema(input)).toThrow();
	});

	it.each([
		["array nested", { type: "object", properties: { a: [] } }],
		["null nested", { type: "object", properties: { a: null } }],
		[
			"class instance nested",
			{ type: "object", properties: { a: new (class Bar {})() } },
		],
	])("refuses a %s schema", (_label, input) => {
		expect(() => parseResultSchema(input)).toThrow();
	});

	it.each([
		["empty enum", { type: "string", enum: [] }],
		["object enum member", { type: "string", enum: [{}] }],
		["null enum member", { type: "string", enum: [null] }],
		["duplicate required", { type: "object", required: ["a", "a"] }],
	])("refuses %s", (_label, input) => {
		expect(() => parseResultSchema(input)).toThrow();
	});

	it("refuses a self-referencing schema as a cycle", () => {
		const schema: Record<string, unknown> = { type: "object", properties: {} };
		(schema.properties as Record<string, unknown>).self = schema;

		expect(() => parseResultSchema(schema)).toThrow(/cycle/i);
	});

	it("accepts a sub-schema object shared by two properties", () => {
		const shared = { type: "string" };
		const input = {
			type: "object",
			properties: { a: shared, b: shared },
		};

		expect(() => parseResultSchema(input)).not.toThrow();
	});

	it.each([
		["items array", { type: "array", items: [{ type: "string" }] }, /items/],
		["items string", { type: "array", items: "string" }, /\/items/],
		["properties array", { type: "object", properties: [] }, /\/properties/],
		["properties string", { type: "object", properties: "x" }, /\/properties/],
		[
			"properties member non-object",
			{ type: "object", properties: { a: 1 } },
			/\/properties\/a/,
		],
		["required string", { type: "object", required: "status" }, /required/],
		[
			"required non-string member",
			{ type: "object", required: [1] },
			/required/,
		],
		[
			"additionalProperties string",
			{ type: "object", additionalProperties: "no" },
			/additionalProperties/,
		],
		["title non-string", { type: "string", title: 1 }, /title/],
		[
			"description non-string",
			{ type: "string", description: 1 },
			/description/,
		],
	])("refuses %s naming keyword and pointer", (_label, input, pattern) => {
		expect(() => parseResultSchema(input)).toThrow(pattern);
	});

	it("escapes property names in the pointer", () => {
		expect(() =>
			parseResultSchema({
				type: "object",
				properties: { "a/b~c": { type: "number", minimum: 0 } },
			}),
		).toThrow(/\/properties\/a~1b~0c\/minimum/);
	});
});

describe("validateResult type matrix", () => {
	const samples: [string, unknown][] = [
		["object", { a: 1 }],
		["array", [1]],
		["null", null],
		["string", "s"],
		["finite number", 1.5],
		["integer", 3],
		["NaN", Number.NaN],
		["Infinity", Number.POSITIVE_INFINITY],
		["boolean", true],
	];
	const accepts: Record<string, string[]> = {
		object: ["object"],
		array: ["array"],
		string: ["string"],
		number: ["finite number", "integer"],
		integer: ["integer"],
		boolean: ["boolean"],
	};
	const cases = Object.entries(accepts).flatMap(([type, ok]) =>
		samples.map(
			([label, value]) => [type, label, value, ok.includes(label)] as const,
		),
	);

	it.each(cases)("type %s vs %s: valid=%s", (type, _label, value, valid) => {
		const violations = validateResult(
			{ type: type as ResultSchema["type"] },
			value,
		);

		expect(violations.length === 0).toBe(valid);
	});

	it("applies other keywords of a nested schema without type", () => {
		const schema: ResultSchema = {
			type: "object",
			properties: { a: { enum: ["x"] } },
		};

		expect(validateResult(schema, { a: "x" })).toEqual([]);
		expect(validateResult(schema, { a: "y" })).toHaveLength(1);
	});
});

describe("validateResult", () => {
	const schema = issueSchema as ResultSchema;

	it("returns no violations for a valid value", () => {
		expect(validateResult(schema, { status: "done" })).toEqual([]);
	});

	it("reports an enum miss at result.status listing the allowed values", () => {
		const violations = validateResult(schema, { status: "maybe" });

		expect(violations).toHaveLength(1);
		expect(violations[0]?.path).toBe("result.status");
		expect(violations[0]?.message).toContain("done");
		expect(violations[0]?.message).toContain("blocked");
	});

	it("reports an extra property rejected by additionalProperties false", () => {
		const violations = validateResult(schema, {
			status: "done",
			note: "x",
		});

		expect(violations).toHaveLength(1);
		expect(violations[0]?.path).toBe("result.note");
	});

	it("accepts a whole float for integer and rejects 1.5", () => {
		expect(validateResult({ type: "integer" }, 3)).toEqual([]);
		expect(validateResult({ type: "integer" }, 1.5)).toHaveLength(1);
	});

	it("reports a missing required property at its path", () => {
		const violations = validateResult(schema, {});

		expect(violations).toHaveLength(1);
		expect(violations[0]?.path).toBe("result.status");
	});

	it("enforces required names that have no declared property", () => {
		const violations = validateResult({ type: "object", required: ["x"] }, {});

		expect(violations.map((v) => v.path)).toEqual(["result.x"]);
	});

	it("reports an items violation at result.0", () => {
		const violations = validateResult(
			{ type: "array", items: { type: "string" } },
			[1],
		);

		expect(violations.map((v) => v.path)).toEqual(["result.0"]);
	});

	it("applies a nested additionalProperties schema", () => {
		const nested: ResultSchema = {
			type: "object",
			properties: {
				m: { type: "object", additionalProperties: { type: "number" } },
			},
		};

		const violations = validateResult(nested, { m: { a: "x" } });

		expect(violations.map((v) => v.path)).toEqual(["result.m.a"]);
	});

	it("reports every violation", () => {
		const violations = validateResult(
			{ type: "object", required: ["a", "b"] },
			{},
		);

		expect(violations.map((v) => v.path)).toEqual(["result.a", "result.b"]);
	});
});
