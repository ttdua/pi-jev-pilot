import { describe, expect, it } from "vitest";
import { parseLaunchMetadata } from "#src/seams/launch-metadata";

const longValue = "x".repeat(1024);

function manyKeys(count: number, value = "v"): Record<string, string> {
	const out: Record<string, string> = {};
	for (let i = 0; i < count; i++) out[`k${i}`] = value;
	return out;
}

describe("parseLaunchMetadata", () => {
	it("returns undefined for undefined and for an empty map", () => {
		expect(parseLaunchMetadata(undefined)).toBeUndefined();
		expect(parseLaunchMetadata({})).toBeUndefined();
	});

	it("accepts 32 keys with 1024-char values and returns a frozen null-prototype copy", () => {
		const input = manyKeys(32, longValue);
		const result = parseLaunchMetadata(input);

		expect(result).toEqual(input);
		expect(Object.isFrozen(result)).toBe(true);
		expect(Object.getPrototypeOf(result)).toBeNull();
	});

	it("copies the input so later mutation does not change the result", () => {
		const input: Record<string, string> = { change: "c" };
		const result = parseLaunchMetadata(input);

		input.change = "changed";
		input.extra = "e";

		expect(result).toEqual({ change: "c" });
	});

	it("accepts a null-prototype object with valid keys", () => {
		const input = Object.create(null) as Record<string, string>;
		input.change = "c";

		expect(parseLaunchMetadata(input)).toEqual({ change: "c" });
	});

	it("accepts keys with dots, dashes and underscores, and a 64-char key", () => {
		const longKey = `a${"b".repeat(63)}`;
		expect(parseLaunchMetadata({ "a.b-c_d": "1", [longKey]: "2" })).toEqual({
			"a.b-c_d": "1",
			[longKey]: "2",
		});
	});

	it("refuses more than 32 keys", () => {
		expect(() => parseLaunchMetadata(manyKeys(33))).toThrow(/32/);
	});

	it("refuses a key that does not match the pattern (uppercase)", () => {
		expect(() => parseLaunchMetadata({ Change: "c" })).toThrow(/Change/);
		expect(() => parseLaunchMetadata({ Change: "c" })).toThrow(
			/\^\[a-z\]\[a-z0-9_\.-\]\{0,63\}\$/,
		);
	});

	it("refuses a key starting with a digit", () => {
		expect(() => parseLaunchMetadata({ "9a": "x" })).toThrow(/9a/);
	});

	it("refuses a 65-char key", () => {
		const key = `a${"b".repeat(64)}`;
		expect(() => parseLaunchMetadata({ [key]: "x" })).toThrow(key);
	});

	it("refuses a value longer than 1024 chars", () => {
		expect(() => parseLaunchMetadata({ packet: "x".repeat(1025) })).toThrow(
			/packet/,
		);
		expect(() => parseLaunchMetadata({ packet: "x".repeat(1025) })).toThrow(
			/1024/,
		);
	});

	it("refuses a non-string value", () => {
		expect(() => parseLaunchMetadata({ unit: 3 })).toThrow(/unit/);
	});

	it("refuses an array", () => {
		expect(() => parseLaunchMetadata([])).toThrow(/plain object/);
	});

	it("refuses a Map", () => {
		expect(() => parseLaunchMetadata(new Map())).toThrow(/plain object/);
	});

	it("refuses null", () => {
		expect(() => parseLaunchMetadata(null)).toThrow(/plain object/);
	});

	it("refuses a string", () => {
		expect(() => parseLaunchMetadata("s")).toThrow(/plain object/);
	});

	it("refuses an object with an inherited prototype", () => {
		expect(() => parseLaunchMetadata(Object.create({ x: "1" }))).toThrow(
			/plain object/,
		);
	});

	it("refuses symbol keys", () => {
		expect(() => parseLaunchMetadata({ [Symbol("s")]: "x" })).toThrow(
			/enumerable string keys/,
		);
	});

	it("refuses a non-enumerable own property", () => {
		const input: Record<string, string> = { change: "c" };
		Object.defineProperty(input, "hidden", { value: "h", enumerable: false });

		expect(() => parseLaunchMetadata(input)).toThrow(/enumerable string keys/);
	});

	it("refuses a __proto__ own key parsed from JSON", () => {
		const input = JSON.parse('{"__proto__":"x"}');
		expect(() => parseLaunchMetadata(input)).toThrow(/__proto__/);
	});
});

describe("parseLaunchMetadata error text", () => {
	it("escapes DEL and C1 control characters in the offending key", () => {
		for (const key of ["A\u007f", "A\u0085", "A\u009b31m"]) {
			let message = "";
			try {
				parseLaunchMetadata({ [key]: "v" });
			} catch (error) {
				message = (error as Error).message;
			}
			expect(message).not.toBe("");
			expect(message).not.toMatch(/[\u007f-\u009f]/);
		}
		expect(() => parseLaunchMetadata({ "A\u009b31m": "v" })).toThrow("\\u009b");
	});

	it("bounds and escapes an offending key in the message", () => {
		const key = `A\n${"k".repeat(200)}`;
		let message = "";
		try {
			parseLaunchMetadata({ [key]: "v" });
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message).not.toBe("");
		expect(message.length).toBeLessThan(200);
		expect(message).not.toContain("\n");
	});
});
