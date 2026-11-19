/**
 * result-schema.ts — Parsing and validation of the structured-result schema subset.
 *
 * The service parses a caller's schema once at spawn into a frozen deep copy;
 * the child's `submit_result` validates against that copy only.
 */

import type { ResultSchema } from "#src/service/service";

export interface ResultViolation {
	path: string;
	message: string;
}

const TYPE_NAMES = [
	"object",
	"array",
	"string",
	"number",
	"integer",
	"boolean",
] as const;

const DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema";

const KNOWN_KEYWORDS = new Set([
	"type",
	"enum",
	"properties",
	"items",
	"required",
	"additionalProperties",
	"title",
	"description",
	"$schema",
]);

type Pointer = string;

function refuse(pointer: Pointer, message: string): never {
	throw new Error(`resultSchema ${pointer || "/"}: ${message}`);
}

function escapeSegment(key: string): string {
	return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

function isPlainObject(input: unknown): input is Record<string, unknown> {
	if (typeof input !== "object" || input === null) return false;
	const proto = Object.getPrototypeOf(input);
	return proto === Object.prototype || proto === null;
}

function hasOwn(object: object, key: string): boolean {
	return Object.hasOwn(object, key);
}

/**
 * Validate and copy a result schema. Returns `undefined` for `undefined`;
 * otherwise a deep-frozen copy sharing no objects with the input.
 */
export function parseResultSchema(input: unknown): ResultSchema | undefined {
	if (input === undefined) return undefined;
	return parseNode(input, "", true, new WeakSet());
}

function parseNode(
	input: unknown,
	pointer: Pointer,
	isRoot: boolean,
	ancestors: WeakSet<object>,
): ResultSchema {
	if (!isPlainObject(input)) refuse(pointer, "schema must be a plain object");
	if (ancestors.has(input)) refuse(pointer, "schema contains a cycle");

	for (const keyword of Object.keys(input)) {
		if (!KNOWN_KEYWORDS.has(keyword)) {
			const where = `${pointer}/${escapeSegment(keyword)}`;
			refuse(where, `unsupported keyword "${keyword}" at ${where}`);
		}
	}

	ancestors.add(input);
	const out: Record<string, unknown> = {};
	if (hasOwn(input, "type") || isRoot) {
		out.type = parseType(input.type, pointer);
	}
	if (hasOwn(input, "enum")) out.enum = parseEnum(input.enum, pointer);
	if (hasOwn(input, "properties")) {
		out.properties = parseProperties(input.properties, pointer, ancestors);
	}
	if (hasOwn(input, "items")) {
		out.items = parseNode(input.items, `${pointer}/items`, false, ancestors);
	}
	if (hasOwn(input, "required"))
		out.required = parseRequired(input.required, pointer);
	if (hasOwn(input, "additionalProperties")) {
		out.additionalProperties = parseAdditional(
			input.additionalProperties,
			pointer,
			ancestors,
		);
	}
	if (hasOwn(input, "title"))
		out.title = parseString(input.title, pointer, "title");
	if (hasOwn(input, "description")) {
		out.description = parseString(input.description, pointer, "description");
	}
	if (hasOwn(input, "$schema"))
		out.$schema = parseDraft(input.$schema, pointer);
	ancestors.delete(input);

	return Object.freeze(out) as ResultSchema;
}

function parseType(value: unknown, pointer: Pointer): string {
	if (!TYPE_NAMES.includes(value as (typeof TYPE_NAMES)[number])) {
		refuse(`${pointer}/type`, `type must be one of ${TYPE_NAMES.join(", ")}`);
	}
	return value as string;
}

function parseEnum(
	value: unknown,
	pointer: Pointer,
): readonly (string | number | boolean)[] {
	const where = `${pointer}/enum`;
	if (!Array.isArray(value)) refuse(where, "enum must be an array");
	if (value.length === 0) refuse(where, "enum must not be empty");
	for (const member of value) {
		const scalar =
			typeof member === "string" ||
			typeof member === "boolean" ||
			(typeof member === "number" && Number.isFinite(member));
		if (!scalar)
			refuse(where, "enum members must be strings, numbers or booleans");
	}
	return Object.freeze([...value]) as readonly (string | number | boolean)[];
}

function parseProperties(
	value: unknown,
	pointer: Pointer,
	ancestors: WeakSet<object>,
): Readonly<Record<string, ResultSchema>> {
	const where = `${pointer}/properties`;
	if (!isPlainObject(value)) refuse(where, "properties must be a plain object");
	const out: Record<string, ResultSchema> = Object.create(null);
	for (const key of Object.keys(value)) {
		out[key] = parseNode(
			value[key],
			`${where}/${escapeSegment(key)}`,
			false,
			ancestors,
		);
	}
	return Object.freeze(out);
}

function parseRequired(value: unknown, pointer: Pointer): readonly string[] {
	const where = `${pointer}/required`;
	if (!Array.isArray(value)) refuse(where, "required must be an array");
	const seen = new Set<string>();
	for (const name of value) {
		if (typeof name !== "string")
			refuse(where, "required members must be strings");
		if (seen.has(name)) refuse(where, `required names "${name}" twice`);
		seen.add(name);
	}
	return Object.freeze([...value]) as readonly string[];
}

function parseAdditional(
	value: unknown,
	pointer: Pointer,
	ancestors: WeakSet<object>,
): boolean | ResultSchema {
	const where = `${pointer}/additionalProperties`;
	if (typeof value === "boolean") return value;
	if (isPlainObject(value)) return parseNode(value, where, false, ancestors);
	return refuse(where, "additionalProperties must be a boolean or a schema");
}

function parseString(
	value: unknown,
	pointer: Pointer,
	keyword: string,
): string {
	if (typeof value !== "string")
		refuse(`${pointer}/${keyword}`, `${keyword} must be a string`);
	return value;
}

function parseDraft(value: unknown, pointer: Pointer): typeof DRAFT_2020_12 {
	if (value !== DRAFT_2020_12) {
		refuse(`${pointer}/$schema`, `$schema must be ${DRAFT_2020_12}`);
	}
	return DRAFT_2020_12;
}

export function validateResult(
	schema: ResultSchema,
	value: unknown,
): ResultViolation[] {
	const violations: ResultViolation[] = [];
	checkNode(schema, value, "result", violations);
	return violations;
}

function checkNode(
	schema: ResultSchema,
	value: unknown,
	path: string,
	out: ResultViolation[],
): void {
	if (schema.type !== undefined && !matchesType(schema.type, value)) {
		out.push({ path, message: `must be of type ${schema.type}` });
	}
	if (schema.enum !== undefined && !schema.enum.includes(value as never)) {
		const allowed = schema.enum
			.map((member) => JSON.stringify(member))
			.join(", ");
		out.push({ path, message: `must be one of ${allowed}` });
	}
	if (isPlainObject(value)) checkObject(schema, value, path, out);
	if (Array.isArray(value) && schema.items !== undefined) {
		value.forEach((item, index) => {
			checkNode(schema.items as ResultSchema, item, `${path}.${index}`, out);
		});
	}
}

function checkObject(
	schema: ResultSchema,
	value: Record<string, unknown>,
	path: string,
	out: ResultViolation[],
): void {
	for (const name of schema.required ?? []) {
		if (!hasOwn(value, name))
			out.push({ path: `${path}.${name}`, message: "is required" });
	}
	const properties = schema.properties ?? {};
	for (const key of Object.keys(properties)) {
		if (hasOwn(value, key)) {
			checkNode(
				properties[key] as ResultSchema,
				value[key],
				`${path}.${key}`,
				out,
			);
		}
	}
	for (const key of Object.keys(value)) {
		if (!hasOwn(properties, key))
			checkExtra(schema, value[key], `${path}.${key}`, out);
	}
}

function checkExtra(
	schema: ResultSchema,
	value: unknown,
	path: string,
	out: ResultViolation[],
): void {
	const additional = schema.additionalProperties;
	if (additional === false) {
		out.push({ path, message: "is not allowed" });
	} else if (additional !== undefined && additional !== true) {
		checkNode(additional, value, path, out);
	}
}

function matchesType(type: string, value: unknown): boolean {
	switch (type) {
		case "object":
			return isPlainObject(value);
		case "array":
			return Array.isArray(value);
		case "string":
			return typeof value === "string";
		case "number":
			return typeof value === "number" && Number.isFinite(value);
		case "integer":
			return Number.isInteger(value);
		case "boolean":
			return typeof value === "boolean";
		default:
			return false;
	}
}
