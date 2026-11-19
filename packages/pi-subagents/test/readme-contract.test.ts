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

	it("states the fresh-only rule for launch resources", () => {
		expect(readme).toContain("Launch resources apply to fresh launches only");
	});

	it("documents requestedCwd for workspace providers", () => {
		expect(readme).toContain("requestedCwd");
	});

	it("documents the inherit_skills pin", () => {
		expect(readme).toContain("inherit_skills");
	});

	it("documents the skill collision refusal and its prefix", () => {
		expect(readme).toContain("Skill name collision: <name> (<winnerPath>, <loserPath>)");
	});

	it("documents the run-start refusal prefix", () => {
		expect(readme).toContain("Launch resources no longer valid: <path> (<reason>)");
	});
});
