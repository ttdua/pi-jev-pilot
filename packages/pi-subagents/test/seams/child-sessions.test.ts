import { afterEach, describe, expect, it, vi } from "vitest";
import {
	enterChildSession,
	leaveChildSession,
	lookupChildSession,
	resetChildSessions,
} from "#src/seams/child-sessions";

afterEach(resetChildSessions);

describe("child-session registry", () => {
	it("returns the entered agentId, agentType and metadata, frozen", () => {
		enterChildSession("s1", {
			agentId: "a1",
			agentType: "explore",
			metadata: { change: "c" },
		});

		const info = lookupChildSession("s1");

		expect(info).toEqual({
			agentId: "a1",
			agentType: "explore",
			metadata: { change: "c" },
		});
		expect(Object.isFrozen(info)).toBe(true);
		expect(Object.isFrozen(info?.metadata)).toBe(true);
	});

	it("uses a frozen empty metadata object shared across entries when none is given", () => {
		enterChildSession("s1", { agentId: "a1", agentType: "explore" });
		enterChildSession("s2", { agentId: "a2", agentType: "general" });

		const first = lookupChildSession("s1")?.metadata;
		const second = lookupChildSession("s2")?.metadata;

		expect(first).toEqual({});
		expect(Object.isFrozen(first)).toBe(true);
		expect(first).toBe(second);
	});

	it("returns undefined for an unknown id", () => {
		expect(lookupChildSession("missing")).toBeUndefined();
	});

	it("returns undefined after leaveChildSession", () => {
		enterChildSession("s1", { agentId: "a1", agentType: "explore" });
		leaveChildSession("s1");

		expect(lookupChildSession("s1")).toBeUndefined();
	});

	it("shares entries across module instances", async () => {
		enterChildSession("s1", { agentId: "a1", agentType: "explore" });

		vi.resetModules();
		const fresh = await import("#src/seams/child-sessions");

		expect(fresh.lookupChildSession("s1")).toEqual({
			agentId: "a1",
			agentType: "explore",
			metadata: {},
		});
	});

	it("shares the empty metadata object across module instances", async () => {
		enterChildSession("s1", { agentId: "a1", agentType: "explore" });
		const before = lookupChildSession("s1")?.metadata;

		vi.resetModules();
		const fresh = await import("#src/seams/child-sessions");
		fresh.enterChildSession("s2", { agentId: "a2", agentType: "general" });
		const after = fresh.lookupChildSession("s2")?.metadata;

		expect(after).toBe(before);
	});

	it("does not freeze or retain the caller's metadata object", () => {
		const input: Record<string, string> = { change: "c" };
		enterChildSession("s1", {
			agentId: "a1",
			agentType: "explore",
			metadata: input,
		});

		expect(Object.isFrozen(input)).toBe(false);

		input.change = "changed";
		input.extra = "e";

		expect(lookupChildSession("s1")?.metadata).toEqual({ change: "c" });
	});
});
