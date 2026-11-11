/**
 * Grants are checked in the child after its extensions bind: a grant takes
 * effect only when the child registered a tool of that name the model can
 * call. Driven through `createSubagentSession` with a fake SDK session whose
 * registry the test controls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSubagentSession } from "#src/lifecycle/create-subagent-session";
import { checkGrants } from "#src/seams/grant-check";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";
import {
	createAgentLookup,
	createChildLifecycleMock,
	createFactorySession,
	createSubagentSessionDeps,
	createSubagentSessionIO,
} from "#test/helpers/subagent-session-io";

type Exposure = "direct" | "model-only" | "codemode" | "deferred" | "hidden";
interface ChildTool {
	name: string;
	exposure: Exposure;
}

interface Faults {
	/** `getAllTools()` throws after bind. */
	registryThrows?: boolean;
	/** How many `setActiveToolsByName()` calls throw (Infinity: every call). */
	setActiveThrows?: number;
}

/** Child registers `registered` when its extensions bind; active = allowlist ∩ registered, as Pi does. */
async function launch(
	registered: ChildTool[],
	grants: string[],
	faults: Faults = {},
) {
	const outcome = await tryLaunch(registered, grants, faults);
	if ("error" in outcome) throw outcome.error;
	return outcome;
}

async function tryLaunch(
	registered: ChildTool[],
	grants: string[],
	faults: Faults = {},
) {
	const io = createSubagentSessionIO();
	const lifecycle = createChildLifecycleMock();
	const session = createFactorySession();
	let active: string[] = [];
	const tools: ChildTool[] = [];
	io.createSession.mockImplementation(async (opts: { tools: string[] }) => {
		session.bindExtensions.mockImplementation(async () => {
			tools.push(...registered);
			active = opts.tools.filter((name) =>
				tools.some(
					(t) =>
						t.name === name &&
						(t.exposure === "direct" || t.exposure === "model-only"),
				),
			);
		});
		return { session };
	});
	let failures = faults.setActiveThrows ?? 0;
	Object.assign(session, {
		getAllTools: () => {
			if (faults.registryThrows) throw new Error("registry unavailable");
			return tools.map((t) => ({ ...t }));
		},
	});
	session.getActiveToolNames.mockImplementation(() => [...active]);
	session.setActiveToolsByName.mockImplementation((names: string[]) => {
		if (failures > 0) {
			failures--;
			throw new Error("setActiveToolsByName failed");
		}
		active = [...names];
	});
	let result: Awaited<ReturnType<typeof createSubagentSession>> | undefined;
	try {
		result = await createSubagentSession(
			{
				agentId: "a1",
				snapshot: STUB_SNAPSHOT,
				type: "Explore",
				tools: { toolNames: ["read", "edit"], grants },
			},
			createSubagentSessionDeps({
				io,
				registry: createAgentLookup({ toolNames: ["read", "edit"] }),
				lifecycle,
			}),
		);
	} catch (error) {
		return { error, session, lifecycle };
	}
	return {
		result,
		lifecycle,
		active: () => active,
		tools,
		granted: lifecycle.bound.mock.calls[0]![0].grantedTools,
		setActive: session.setActiveToolsByName,
	};
}

const BASE: ChildTool[] = [
	{ name: "read", exposure: "direct" },
	{ name: "edit", exposure: "direct" },
];

beforeEach(() => {
	vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
	vi.restoreAllMocks();
});

describe("grants are checked in the child", () => {
	it("a grant of a tool the child does not register is dropped", async () => {
		const child = await launch(BASE, ["parent_only"]);

		expect(child.granted).toEqual([]);
		expect(child.active()).toEqual(["read", "edit"]);
	});

	it("a grant of a tool whose exposure the model cannot call is dropped", async () => {
		const hidden: ChildTool = { name: "secret", exposure: "hidden" };
		const child = await launch([...BASE, hidden], ["secret"]);

		expect(child.granted).toEqual([]);
		expect(child.active()).not.toContain("secret");
		expect(child.active()).toEqual(["read", "edit"]);
	});

	it("a registered, callable grant takes effect", async () => {
		const search: ChildTool = { name: "web_search", exposure: "direct" };
		const child = await launch([...BASE, search], ["web_search"]);

		expect(child.granted).toEqual(["web_search"]);
		expect(child.active()).toEqual(["read", "edit", "web_search"]);
	});

	it("never changes a tool's exposure", async () => {
		const deferredTool: ChildTool = { name: "lookup", exposure: "deferred" };
		const child = await launch([...BASE, deferredTool], ["lookup"]);

		expect(child.granted).toEqual([]);
		expect(child.tools.find((t) => t.name === "lookup")?.exposure).toBe(
			"deferred",
		);
		expect(child.active()).toEqual(["read", "edit"]);
	});

	it("leaves the active set alone when nothing is dropped", async () => {
		const child = await launch(BASE, []);

		expect(child.granted).toEqual([]);
		expect(child.setActive).not.toHaveBeenCalled();
	});
});

describe("the grant check fails open", () => {
	const search: ChildTool = { name: "web_search", exposure: "direct" };

	it("a registry read failure applies no grants and still binds", async () => {
		const child = await launch([...BASE, search], ["web_search"], {
			registryThrows: true,
		});

		expect(child.granted).toEqual([]);
		expect(child.active()).toEqual(["read", "edit"]);
		expect(child.result).toBeDefined();
	});

	it("a failing setActiveToolsByName is retried as the pre-grant set", async () => {
		const child = await launch([...BASE], ["web_search"], {
			setActiveThrows: 1,
		});

		expect(child.granted).toEqual([]);
		expect(child.active()).toEqual(["read", "edit"]);
		expect(child.result).toBeDefined();
	});

	it("a session that cannot drop its grants is disposed, not returned", async () => {
		const outcome = await tryLaunch([...BASE, search], ["web_search"], {
			registryThrows: true,
			setActiveThrows: Number.POSITIVE_INFINITY,
		});

		if (!("error" in outcome)) throw new Error("expected the launch to fail");
		expect(outcome.lifecycle.bound).not.toHaveBeenCalled();
		expect(outcome.lifecycle.disposed).toHaveBeenCalledOnce();
	});
});

describe("checkGrants", () => {
	it("keeps direct and model-only tools, in grant order", () => {
		expect(
			checkGrants(["b", "a", "c", "missing"], [
				{ name: "a", exposure: "direct" },
				{ name: "b", exposure: "model-only" },
				{ name: "c", exposure: "codemode" },
			] as never),
		).toEqual(["b", "a"]);
	});
});
