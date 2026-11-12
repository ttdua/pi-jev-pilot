/**
 * Agent registry query and `disallowed_tools`, driven through the real
 * `loadCustomAgents` → `AgentTypeRegistry` path over temporary project and
 * global agent directories. Allowlist scenarios run the real
 * `createSubagentSession` with only the SDK session factory stubbed.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTypeRegistry, BUILTIN_TOOL_NAMES } from "#src/config/agent-types";
import { loadCustomAgents } from "#src/config/custom-agents";
import { DEFAULT_AGENTS } from "#src/config/default-agents";
import {
	type CreateSessionOptions,
	createSubagentSession,
} from "#src/lifecycle/create-subagent-session";
import {
	AgentTypeCatalog,
	blockedToolCount,
	finalToolNames,
} from "#src/seams/registry";
import {
	BUILTIN_EXTENSION_TOOL_NAMES,
	builtinExtensionsFor,
} from "#src/session/builtin-extensions";
import type { AgentTypeSnapshot } from "#src/service/service";
import { SubagentsServiceAdapter } from "#src/service/service-adapter";
import { captureWarn } from "#test/helpers/capture-warn";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";
import {
	createFactorySession,
	createSubagentSessionDeps,
	createSubagentSessionIO,
} from "#test/helpers/subagent-session-io";

let root: string;
let projectDir: string;
let originalAgentDir: string | undefined;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "registry-seam-"));
	projectDir = join(root, "project");
	mkdirSync(projectDir, { recursive: true });
	originalAgentDir = process.env.PI_CODING_AGENT_DIR;
	// Keep the operator's own global agents out of the scenarios.
	process.env.PI_CODING_AGENT_DIR = join(root, "global");
});

afterEach(() => {
	if (originalAgentDir == null) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
	rmSync(root, { recursive: true, force: true });
});

function writeProjectAgent(name: string, content: string): void {
	const dir = join(projectDir, ".pi", "agents");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `${name}.md`), content);
}

function makeRegistry(): AgentTypeRegistry {
	return new AgentTypeRegistry(() => loadCustomAgents(projectDir));
}

function makeCatalog(): AgentTypeCatalog {
	return new AgentTypeCatalog(makeRegistry());
}

function names(list: readonly AgentTypeSnapshot[]): string[] {
	return list.map((snapshot) => snapshot.name);
}

describe("agent registry query", () => {
	it("project file overrides a built-in", () => {
		const catalog = makeCatalog();
		writeProjectAgent(
			"Explore",
			"---\ndescription: Project explorer\n---\nExplore the project.",
		);

		const snapshot = catalog.get("Explore");

		expect(snapshot?.source).toBe("project");
		expect(snapshot?.description).toBe("Project explorer");
	});

	it("resolves a name case-insensitively", () => {
		writeProjectAgent("Worker", "---\ndescription: Worker\n---\nWork.");

		expect(makeCatalog().get("worker")?.name).toBe("Worker");
	});

	it("falls back to general-purpose for an unknown name", () => {
		const snapshot = makeCatalog().get("does-not-exist");

		expect(snapshot?.name).toBe("general-purpose");
		expect(snapshot?.source).toBe("builtin");
	});

	it("returns nothing for a disabled agent and omits it from the list", () => {
		writeProjectAgent(
			"worker",
			"---\ndescription: Worker\nenabled: false\n---\nWork.",
		);
		const catalog = makeCatalog();

		expect(catalog.get("worker")).toBeUndefined();
		expect(names(catalog.list())).not.toContain("worker");
	});

	it("picks up an agent file added after the catalog was built", () => {
		const catalog = makeCatalog();
		expect(names(catalog.list())).not.toContain("late");

		writeProjectAgent("late", "---\ndescription: Late\n---\nLate.");

		expect(names(catalog.list())).toContain("late");
	});

	it("lists every enabled built-in and file-defined agent", () => {
		writeProjectAgent("worker", "---\ndescription: Worker\n---\nWork.");

		expect(names(makeCatalog().list()).sort()).toEqual(
			["Explore", "Plan", "general-purpose", "worker"].sort(),
		);
	});
});

describe("agent snapshot fields", () => {
	it("describes the built-in Explore", () => {
		const snapshot = makeCatalog().get("Explore")!;

		expect(snapshot.source).toBe("builtin");
		expect(snapshot.tools).toEqual(["read", "bash", "grep", "find", "ls"]);
		expect(snapshot.disallowedTools).toEqual([]);
		expect(snapshot).not.toHaveProperty("locked");
		expect(snapshot.instructions).toBe(
			DEFAULT_AGENTS.get("Explore")!.systemPrompt,
		);
		expect(snapshot.instructions.length).toBeGreaterThan(0);
	});

	it("is deeply frozen and detached from the executor", () => {
		writeProjectAgent(
			"locked",
			"---\ntools: read\nlocked: [model]\n---\nBody.",
		);
		const catalog = makeCatalog();
		const snapshot = catalog.get("Explore")!;
		const lockedSnapshot = catalog.get("locked")!;

		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot.tools)).toBe(true);
		expect(Object.isFrozen(snapshot.defaultTools)).toBe(true);
		expect(Object.isFrozen(snapshot.disallowedTools)).toBe(true);
		expect(Object.isFrozen(lockedSnapshot.locked)).toBe(true);
		expect(() => (snapshot.tools as string[]).push("edit")).toThrow(TypeError);
		expect(catalog.get("Explore")!.tools).toEqual([
			"read",
			"bash",
			"grep",
			"find",
			"ls",
		]);
		expect(DEFAULT_AGENTS.get("Explore")!.toolNames).toEqual([
			"read",
			"bash",
			"grep",
			"find",
			"ls",
		]);
	});

	it("keeps absent tools distinct from the defaults", () => {
		writeProjectAgent("plain", "---\ndescription: Plain\n---\nBody.");

		const snapshot = makeCatalog().get("plain")!;

		expect(snapshot.tools).toBeNull();
		expect(snapshot.defaultTools).toEqual([
			"read",
			"bash",
			"edit",
			"write",
			"grep",
			"find",
			"ls",
		]);
		expect(snapshot.defaultTools).toEqual(BUILTIN_TOOL_NAMES);
	});

	it("carries declared fields and omits undeclared ones", () => {
		writeProjectAgent(
			"full",
			[
				"---",
				"description: Full",
				"tools: read",
				"model: fixture/fast",
				"thinking: high",
				"max_turns: 7",
				"run_in_background: true",
				"inherit_context: false",
				"locked: true",
				"---",
				"Full body.",
			].join("\n"),
		);
		const catalog = makeCatalog();

		expect(catalog.get("full")).toEqual({
			name: "full",
			source: "project",
			description: "Full",
			instructions: "Full body.",
			tools: ["read"],
			defaultTools: BUILTIN_TOOL_NAMES,
			disallowedTools: [],
			model: "fixture/fast",
			thinking: "high",
			locked: true,
			maxTurns: 7,
			runInBackground: true,
			inheritContext: false,
		});
		expect(Object.keys(catalog.get("general-purpose")!).sort()).toEqual(
			[
				"name",
				"source",
				"description",
				"instructions",
				"tools",
				"defaultTools",
				"disallowedTools",
			].sort(),
		);
	});

	it("reports a global agent's source", () => {
		const globalAgents = join(root, "global", "agents");
		mkdirSync(globalAgents, { recursive: true });
		writeFileSync(
			join(globalAgents, "roamer.md"),
			"---\ndescription: Roamer\n---\nRoam.",
		);

		expect(makeCatalog().get("roamer")?.source).toBe("global");
	});
});

describe("disallowed_tools frontmatter", () => {
	it("parses a comma-separated string", () => {
		writeProjectAgent(
			"deny",
			'---\ndisallowed_tools: "bash, edit"\n---\nBody.',
		);

		expect(makeCatalog().get("deny")?.disallowedTools).toEqual([
			"bash",
			"edit",
		]);
	});

	it("parses a YAML list", () => {
		writeProjectAgent(
			"deny",
			"---\ndisallowed_tools: [bash, edit]\n---\nBody.",
		);

		expect(makeCatalog().get("deny")?.disallowedTools).toEqual([
			"bash",
			"edit",
		]);
	});

	it("records whether tools were declared", () => {
		writeProjectAgent("declared", "---\ntools: read\n---\nBody.");
		writeProjectAgent("none", "---\ntools: none\n---\nBody.");
		writeProjectAgent("absent", "---\ndescription: Absent\n---\nBody.");

		const agents = loadCustomAgents(projectDir);

		expect(agents.get("declared")?.toolsDeclared).toBe(true);
		expect(agents.get("none")?.toolsDeclared).toBe(true);
		expect(agents.get("absent")?.toolsDeclared).toBe(false);
		expect(agents.get("absent")?.disallowedTools).toEqual([]);
	});

	it("writes a debug note naming the agent and a tool both declared and denied", () => {
		writeProjectAgent(
			"editor",
			"---\ntools: read, edit\ndisallowed_tools: [edit]\n---\nBody.",
		);
		vi.stubEnv("PI_SUBAGENTS_DEBUG", "1");
		try {
			const warnings = captureWarn(() => loadCustomAgents(projectDir));

			expect(
				warnings.some(
					(line) => line.includes("editor") && line.includes("edit"),
				),
			).toBe(true);
		} finally {
			vi.unstubAllEnvs();
		}
	});
});

describe("finalToolNames", () => {
	it("adds grants after the base tools without duplicates", () => {
		expect(
			finalToolNames(["read", "grep"], ["grep", "web_search"], []),
		).toEqual(["read", "grep", "web_search"]);
	});

	it("denied wins over a grant", () => {
		expect(finalToolNames(["read"], ["web_search"], ["web_search"])).toEqual([
			"read",
		]);
	});

	it("disallowed match is exact", () => {
		expect(finalToolNames(["read", "bash"], ["Bash"], ["Bash"])).toEqual([
			"read",
			"bash",
		]);
	});

	it("returns a new array and leaves its inputs alone", () => {
		const base = Object.freeze(["read", "bash"]);
		const result = finalToolNames(base, [], ["bash"]);

		expect(result).toEqual(["read"]);
		expect(base).toEqual(["read", "bash"]);
	});
});

describe("child allowlist", () => {
	async function childTools(type: string): Promise<string[]> {
		const io = createSubagentSessionIO();
		io.createSession.mockResolvedValue({ session: createFactorySession() });
		await createSubagentSession(
			{ agentId: "a1", snapshot: STUB_SNAPSHOT, type },
			createSubagentSessionDeps({ io, registry: makeRegistry() }),
		);
		return io.createSession.mock.calls[0][0].tools as string[];
	}

	/** Launch with both child protocol callbacks; returns the allowlist and the custom tool names. */
	async function childProtocolTools(
		type: string,
	): Promise<{ tools: string[]; custom: string[] }> {
		const io = createSubagentSessionIO();
		io.createSession.mockResolvedValue({ session: createFactorySession() });
		await createSubagentSession(
			{
				agentId: "a1",
				snapshot: STUB_SNAPSHOT,
				type,
				askParent: vi.fn(),
				notifyParent: vi.fn(),
			},
			createSubagentSessionDeps({ io, registry: makeRegistry() }),
		);
		const opts = io.createSession.mock.calls[0][0] as CreateSessionOptions;
		return {
			tools: opts.tools,
			custom: (opts.customTools ?? []).map((tool) => tool.name),
		};
	}

	it.each(["ask_parent", "notify_parent"])(
		"removes a denied child protocol tool %s from tools and customTools",
		async (denied) => {
			writeProjectAgent(
				"quiet",
				`---\ntools: read\ndisallowed_tools: ${denied}\n---\nBody.`,
			);

			const { tools, custom } = await childProtocolTools("quiet");

			expect(tools).not.toContain(denied);
			expect(custom).not.toContain(denied);
			expect(tools).toContain("read");
		},
	);

	it("keeps child protocol tools that are not denied", async () => {
		writeProjectAgent("chatty", "---\ntools: read\n---\nBody.");

		const { tools, custom } = await childProtocolTools("chatty");

		expect(tools).toEqual(["read", "ask_parent", "notify_parent"]);
		expect(custom).toEqual(["ask_parent", "notify_parent"]);
	});

	it("removes a denied default tool", async () => {
		writeProjectAgent("nobash", "---\ndisallowed_tools: bash\n---\nBody.");

		expect(await childTools("nobash")).toEqual([
			"read",
			"edit",
			"write",
			"grep",
			"find",
			"ls",
		]);
	});

	it("denied wins over declared", async () => {
		writeProjectAgent(
			"editor",
			"---\ntools: read, edit\ndisallowed_tools: [edit]\n---\nBody.",
		);

		expect(await childTools("editor")).toEqual(["read"]);
	});
});

describe("service registry methods", () => {
	it("delegates listAgentTypes and getAgentType to the catalog", () => {
		writeProjectAgent("worker", "---\ndescription: Worker\n---\nWork.");
		const service = new SubagentsServiceAdapter(
			{} as never,
			vi.fn(),
			{} as never,
			makeCatalog(),
		);

		expect(service.getAgentType("WORKER")?.name).toBe("worker");
		expect(names(service.listAgentTypes())).toContain("worker");
		expect(Object.isFrozen(service.listAgentTypes())).toBe(true);
	});
});

describe("blocked tool count", () => {
	const isKnown = (name: string) =>
		["read", "bash", "edit", "grep", "ask_parent"].includes(name) ||
		BUILTIN_EXTENSION_TOOL_NAMES.has(name);
	function count(p: {
		candidates?: string[];
		disallowed?: string[];
		policyRemoved?: string[];
		grantedTools?: string[];
	}): number {
		return blockedToolCount({
			candidates: [],
			disallowed: [],
			policyRemoved: [],
			grantedTools: [],
			...p,
			isKnown,
		});
	}

	it("counts a disallowed candidate", () => {
		expect(
			count({
				candidates: ["read", "bash", "edit"],
				disallowed: ["bash", "write"],
			}),
		).toBe(1);
	});

	it("counts a disallowed protocol tool", () => {
		expect(
			count({
				candidates: ["read", "ask_parent"],
				disallowed: ["ask_parent"],
			}),
		).toBe(1);
	});

	it("skips a protocol tool not installed", () => {
		expect(
			count({ candidates: ["read", "ask_parent"], disallowed: ["notify_parent"] }),
		).toBe(0);
	});

	it("counts a disallowed built-in extension tool", () => {
		expect(
			count({ candidates: ["read", "codemode"], disallowed: ["codemode"] }),
		).toBe(1);
	});

	it("skips an unknown name", () => {
		expect(
			count({ candidates: ["read", "ghost"], disallowed: ["ghost"] }),
		).toBe(0);
	});

	it("counts a policy removal", () => {
		expect(count({ candidates: ["read"], policyRemoved: ["edit"] })).toBe(1);
	});

	it("removal granted back is not blocked", () => {
		expect(
			count({ policyRemoved: ["bash"], grantedTools: ["bash"] }),
		).toBe(0);
	});

	it("counts a tool both sources remove once", () => {
		expect(
			count({
				candidates: ["read", "bash"],
				disallowed: ["bash"],
				policyRemoved: ["bash"],
			}),
		).toBe(1);
	});

	it("never counts the recursion denylist", () => {
		expect(
			count({
				candidates: ["read", "subagent"],
				disallowed: ["subagent"],
				policyRemoved: ["steer_subagent"],
			}),
		).toBe(0);
	});

	it("skips an unregistered MCP name", () => {
		expect(
			count({
				candidates: ["read", "mcp__missing__ghost"],
				disallowed: ["mcp__missing__ghost"],
			}),
		).toBe(0);
	});
});

describe("BUILTIN_EXTENSION_TOOL_NAMES", () => {
	it("holds the fixed tool names the built-in extensions supply", () => {
		for (const name of ["codemode", "tool_search", "read_mcp_resource"])
			expect(BUILTIN_EXTENSION_TOOL_NAMES.has(name)).toBe(true);
		for (const name of ["mcp__srv__x", "ghost"])
			expect(BUILTIN_EXTENSION_TOOL_NAMES.has(name)).toBe(false);
	});

	it("leaves the extension selection unchanged", () => {
		expect(builtinExtensionsFor(["codemode"]).map((e) => e.name)).toEqual([
			"codemode",
		]);
	});
});
