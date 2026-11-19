/**
 * launch-metadata.ts — Validation of caller-supplied launch metadata.
 *
 * The service is the trust boundary: metadata is refused here, before any
 * record or session exists. Nothing is truncated or coerced.
 */

import type { LaunchMetadata } from "#src/service/service";

export const METADATA_LIMITS = {
	maxKeys: 32,
	keyPattern: /^[a-z][a-z0-9_.-]{0,63}$/,
	maxValueLength: 1024,
} as const;

function refuse(message: string): never {
	throw new Error(`spawn metadata: ${message}`);
}

/**
 * Bounded, escaped rendering of a caller-supplied key for error text.
 * JSON.stringify escapes only U+0000–U+001F, so DEL and C1 controls are escaped here.
 */
function show(key: string): string {
	return JSON.stringify(key.length > 80 ? `${key.slice(0, 80)}…` : key).replace(
		/[\u007f-\u009f]/g,
		(c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
	);
}

function isPlainObject(input: unknown): input is Record<string, unknown> {
	if (typeof input !== "object" || input === null) return false;
	const proto = Object.getPrototypeOf(input);
	return proto === Object.prototype || proto === null;
}

/**
 * Validate and copy a metadata map. Returns `undefined` for `undefined` and
 * for an empty map; otherwise a frozen null-prototype copy.
 */
export function parseLaunchMetadata(
	input: unknown,
): LaunchMetadata | undefined {
	if (input === undefined) return undefined;
	if (!isPlainObject(input)) refuse("must be a plain object");

	const keys = Object.keys(input);
	if (Reflect.ownKeys(input).length !== keys.length) {
		refuse("must have only enumerable string keys");
	}
	if (keys.length === 0) return undefined;
	if (keys.length > METADATA_LIMITS.maxKeys) {
		refuse(
			`at most ${METADATA_LIMITS.maxKeys} keys allowed, got ${keys.length}`,
		);
	}

	const out: Record<string, string> = Object.create(null);
	for (const key of keys) {
		if (!METADATA_LIMITS.keyPattern.test(key)) {
			refuse(`key ${show(key)} must match ${METADATA_LIMITS.keyPattern.source}`);
		}
		const value = input[key];
		if (typeof value !== "string") {
			refuse(`value for key ${show(key)} must be a string`);
		}
		if (value.length > METADATA_LIMITS.maxValueLength) {
			refuse(
				`value for key ${show(key)} exceeds ${METADATA_LIMITS.maxValueLength} characters`,
			);
		}
		out[key] = value;
	}
	return Object.freeze(out);
}
