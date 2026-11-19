import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

describe("README contract", () => {
	it("spawn contract states metadata visibility", () => {
		expect(readme).toContain(
			"Metadata is delivered on `pi.events` to every extension in the process; do not put secrets in it.",
		);
	});

	it("documents the childSession contract", () => {
		expect(readme).toContain("#### `childSession` contract");
	});
});
