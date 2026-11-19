/**
 * Launch resources through the production factory, the real `DefaultResourceLoader`
 * and a real `createAgentSession` turn against a loopback provider. The first
 * request the child sent is what the model sees.
 */
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionFactory,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	CreateSessionOptions,
	CreateSubagentSessionParams,
} from "#src/lifecycle/create-subagent-session";
import { createSubagentSession } from "#src/lifecycle/create-subagent-session";
import {
	defaultLaunchResourcesIO,
	type LaunchResources,
	parseLaunchResources,
} from "#src/seams/launch-resources";
import type { SpawnOptions } from "#src/service/service";
import type { AgentConfig } from "#src/types";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";
import {
	createAgentLookup,
	createChildLifecycleMock,
	createSubagentSessionDeps,
	createSubagentSessionIO,
} from "#test/helpers/subagent-session-io";

async function startLoopback() {
	const bodies: unknown[] = [];
	const server = createServer((req, res) => {
		let raw = "";
		req.on("data", (chunk) => (raw += chunk));
		req.on("end", () => {
			bodies.push(JSON.parse(raw));
			res.writeHead(200, { "content-type": "text/event-stream" });
			const chunk = (delta: object, finish: string | null) =>
				`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
			res.write(chunk({ role: "assistant", content: "ok" }, null));
			res.write(chunk({}, "stop"));
			res.end("data: [DONE]\n\n");
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}/v1`,
		bodies,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

function skillFile(
	dir: string,
	name: string,
	description = `does ${name}`,
): string {
	mkdirSync(dir, { recursive: true });
	const file = join(dir, "SKILL.md");
	writeFileSync(
		file,
		`---\nname: ${name}\ndescription: ${description}\n---\nBody of ${name}\n`,
	);
	return file;
}

function text(content: unknown): string {
	return typeof content === "string"
		? content
		: (content as { text: string }[]).map((p) => p.text).join("");
}

interface Launch {
	resources?: SpawnOptions;
	agent?: Partial<AgentConfig>;
	setting?: string[];
	/** Runs the turn; false stops after creation. */
	prompt?: boolean;
	extension?: ExtensionFactory;
	bind?: boolean;
	/** Resources parsed earlier, as a queued launch holds them. */
	frozen?: LaunchResources;
}

describe("launch resources (real SDK loader)", () => {
	let root: string;
	let projectDir: string;
	let agentDir: string;
	let loopback: Awaited<ReturnType<typeof startLoopback>>;
	let warn: ReturnType<typeof vi.spyOn>;
	const dir = (name: string) => {
		const d = join(root, name);
		mkdirSync(d, { recursive: true });
		return d;
	};

	beforeEach(async () => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "launch-res-prompt-")));
		projectDir = join(root, "project");
		agentDir = join(root, "agent");
		mkdirSync(join(projectDir, ".pi"), { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(join(projectDir, "AGENTS.md"), "AGENTS-PROJECT-MARKER\n");
		writeFileSync(join(agentDir, "AGENTS.md"), "AGENTS-GLOBAL-MARKER\n");
		skillFile(join(agentDir, "skills", "a"), "a");
		skillFile(join(projectDir, ".pi", "skills", "b"), "b");
		loopback = await startLoopback();
		warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.stubEnv("PI_SUBAGENTS_DEBUG", "1");
		// Pi also reads ~/.agents/skills; keep the operator's out of the catalog.
		vi.stubEnv("HOME", dir("home"));
	});
	afterEach(async () => {
		vi.unstubAllEnvs();
		warn.mockRestore();
		await loopback.close();
		rmSync(root, { recursive: true, force: true });
	});

	async function launch(l: Launch = {}) {
		const resources =
			l.frozen ??
			parseLaunchResources(
				l.resources ?? {},
				defaultLaunchResourcesIO(agentDir),
			);
		const runtime = await ModelRuntime.create({
			authPath: join(agentDir, "auth.json"),
			modelsPath: join(agentDir, "models.json"),
		});
		runtime.registerProvider("loop", {
			baseUrl: loopback.url,
			api: "openai-completions",
			apiKey: "test-key",
			models: [
				{
					id: "m",
					name: "m",
					reasoning: false,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 8000,
					maxTokens: 1000,
				},
			],
		});
		const model = runtime.getModel("loop", "m");
		const io = createSubagentSessionIO();
		io.getAgentDir.mockReturnValue(agentDir);
		const cwd = resources?.cwd ?? projectDir;
		io.createSettingsManager.mockImplementation((c: string) =>
			SettingsManager.create(c, agentDir),
		);
		io.createLoaderSettingsManager.mockImplementation(
			(parent: unknown, extra: readonly string[]) => ({
				settingsManager: parent,
				excludedExtensionPackages: [
					...new Set([...(l.setting ?? []), ...extra]),
				],
			}),
		);
		io.createSessionManager.mockImplementation((c: string) =>
			SessionManager.inMemory(c),
		);
		io.createResourceLoader.mockImplementation(
			(opts) =>
				new DefaultResourceLoader({
					...opts,
					extensionFactories: [
						...(opts.extensionFactories ?? []),
						...(l.extension ? [l.extension] : []),
					],
				}),
		);
		let session: AgentSession | undefined;
		io.createSession.mockImplementation(async (opts: CreateSessionOptions) => {
			const created = await createAgentSession({
				cwd: opts.cwd,
				agentDir: opts.agentDir,
				sessionManager: opts.sessionManager as SessionManager,
				settingsManager: opts.settingsManager,
				resourceLoader: opts.resourceLoader as DefaultResourceLoader,
				modelRuntime: runtime,
				model,
				tools: ["read"],
			});
			session = created.session;
			return { session: created.session };
		});
		const lifecycle = createChildLifecycleMock();
		const registry = createAgentLookup({
			name: "fresh-agent",
			systemPrompt: "BODY-MARKER",
			toolNames: ["read"],
			...l.agent,
		});
		const params: CreateSubagentSessionParams = {
			agentId: "a1",
			snapshot: {
				...STUB_SNAPSHOT,
				cwd: projectDir,
				systemPrompt: "PARENT-MARKER",
			},
			type: "fresh-agent",
			cwd: resources?.cwd,
			resources,
		};
		void cwd;
		let error: unknown;
		try {
			await createSubagentSession(
				params,
				createSubagentSessionDeps({ io, exec: vi.fn(), registry, lifecycle }),
			);
		} catch (err) {
			error = err;
		}
		if (error)
			return {
				error: error as Error,
				io,
				lifecycle,
				session,
				system: "",
				created: lifecycle.sessionCreated.mock.calls[0]?.[0],
			};
		if (l.bind !== false) await session!.bindExtensions({});
		let system = "";
		if (l.prompt !== false) {
			await session!.prompt("TASK");
			const req = loopback.bodies[0] as {
				messages: { role: string; content: unknown }[];
			};
			system = text(req.messages.find((m) => m.role === "system")?.content);
		}
		return {
			error: undefined,
			io,
			lifecycle,
			session: session!,
			system,
			created: lifecycle.sessionCreated.mock.calls[0]![0],
		};
	}

	const listed = (system: string) =>
		[...system.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1]);

	it("only the given skill", async () => {
		const x = skillFile(dir("x"), "x");
		const { system } = await launch({
			resources: { skills: { inherit: false, paths: [x] } },
		});
		expect(listed(system)).toEqual(["x"]);
	});

	it("no skills at all", async () => {
		const { system } = await launch({
			resources: { skills: { inherit: false } },
		});
		expect(system).not.toContain("<available_skills>");
	});

	it("catalog plus extra skill", async () => {
		const x = skillFile(dir("x"), "x");
		const { system } = await launch({
			resources: { skills: { inherit: true, paths: [x] } },
		});
		expect(listed(system)).toEqual(["b", "a", "x"]);
	});

	it("duplicate path kept once", async () => {
		const x = skillFile(dir("x"), "x");
		const { system } = await launch({
			resources: { skills: { inherit: false, paths: [x, x] } },
		});
		expect(listed(system).filter((n) => n === "x")).toHaveLength(1);
	});

	it("allowlist matches a symlinked path", async () => {
		const real = dir("real");
		skillFile(join(real, "s"), "s");
		const link = join(root, "link");
		symlinkSync(real, link);
		const { system, created } = await launch({
			resources: {
				skills: { inherit: false, paths: [join(link, "s", "SKILL.md")] },
			},
		});
		expect(listed(system)).toEqual(["s"]);
		expect(created.skillPaths).toHaveLength(1);
	});

	const discovering =
		(file: string): ExtensionFactory =>
		(pi) => {
			pi.on("resources_discover", () => ({ skillPaths: [file] }));
		};

	it("discovered skill kept out when not inheriting, present when inheriting", async () => {
		const extra = skillFile(dir("extra"), "extra");
		const out = await launch({
			resources: { skills: { inherit: false } },
			extension: discovering(extra),
		});
		expect(listed(out.system)).not.toContain("extra");
		loopback.bodies.length = 0;
		const inn = await launch({
			resources: { skills: { inherit: true } },
			extension: discovering(extra),
		});
		expect(listed(inn.system)).toContain("extra");
	});

	it("catalog follows the child's directory", async () => {
		const other = dir("other");
		skillFile(join(other, ".pi", "skills", "c"), "c");
		const { system } = await launch({ resources: { cwd: other } });
		expect(listed(system)).toContain("c");
		expect(listed(system)).not.toContain("b");
	});

	it("explicit skill collides with the catalog", async () => {
		const dup = skillFile(dir("dup"), "a");
		const { error, io } = await launch({
			resources: { skills: { inherit: true, paths: [dup] } },
		});
		expect(error?.message).toMatch(/^Skill name collision: a \(/);
		expect(error?.message).toContain(dup);
		expect(error?.message).toContain(join(agentDir, "skills", "a", "SKILL.md"));
		expect(io.createSession).not.toHaveBeenCalled();
	});

	it("late discovery never displaces an explicit skill", async () => {
		const explicit = skillFile(dir("plan1"), "plan", "EXPLICIT-DESC");
		const late = skillFile(dir("plan2"), "plan", "LATE-DESC");
		const { system } = await launch({
			resources: { skills: { inherit: true, paths: [explicit] } },
			extension: discovering(late),
		});
		expect(system).toContain("EXPLICIT-DESC");
		expect(system).not.toContain("LATE-DESC");
		const debug = warn.mock.calls.flat().join("\n");
		expect(debug).toContain(explicit);
		expect(debug).toContain(late);
	});

	it("listed directory changes shape while queued", async () => {
		const d = dir("shape");
		skillFile(join(d, "a"), "sa");
		const frozen = parseLaunchResources(
			{ skills: { inherit: false, paths: [d] } },
			defaultLaunchResourcesIO(agentDir),
		);
		// A root-level SKILL.md appears after validation; the frozen resolved files still decide.
		skillFile(d, "root-skill");
		expect(frozen?.skills?.skillFiles).toEqual([join(d, "a", "SKILL.md")]);
		const { system } = await launch({ frozen });
		expect(listed(system)).toEqual(["sa"]);
	});

	it("pinned agent from the tool", async () => {
		const { system, created } = await launch({
			agent: { inheritSkills: false },
		});
		expect(system).not.toContain("<available_skills>");
		expect(created.inheritSkills).toBe(false);
	});

	it("pin overrides caller inherit", async () => {
		const p = skillFile(dir("p"), "p");
		const { system, created } = await launch({
			agent: { inheritSkills: false },
			resources: { skills: { inherit: true, paths: [p] } },
		});
		expect(listed(system)).toEqual(["p"]);
		expect(created.inheritSkills).toBe(false);
	});

	it("omitted fields keep today's child", async () => {
		const { system, created } = await launch();
		expect(listed(system)).toEqual(["b", "a"]);
		expect(system).toContain("AGENTS-PROJECT-MARKER");
		for (const k of [
			"inheritSkills",
			"skillPaths",
			"excludedExtensionPackages",
			"contextFiles",
		]) {
			expect(created).not.toHaveProperty(k);
		}
	});

	it("no AGENTS.md", async () => {
		const { system } = await launch({ resources: { contextFiles: false } });
		expect(system).not.toContain("AGENTS-PROJECT-MARKER");
		expect(system).not.toContain("AGENTS-GLOBAL-MARKER");
		expect(system.trimEnd().endsWith("BODY-MARKER\n</agent>")).toBe(true);
	});

	it("project instructions present", async () => {
		const { system } = await launch({ resources: { cwd: projectDir } });
		expect(system).toContain("AGENTS-PROJECT-MARKER");
	});

	it("session-created carries effective values", async () => {
		const x = skillFile(dir("x"), "x");
		const { created } = await launch({
			setting: ["npm:noisy"],
			resources: {
				skills: { inherit: false, paths: [x] },
				excludeExtensionPackages: ["pkg"],
				cwd: projectDir,
				contextFiles: false,
			},
			prompt: false,
		});
		expect(created).toMatchObject({
			cwd: projectDir,
			inheritSkills: false,
			skillPaths: [x],
			excludedExtensionPackages: ["npm:noisy", "pkg"],
			contextFiles: false,
			context: "fresh",
		});
	});

	it("only cwd given", async () => {
		const { created } = await launch({
			setting: ["npm:noisy"],
			resources: { cwd: projectDir },
			prompt: false,
		});
		expect(created.inheritSkills).toBe(true);
		expect(created.skillPaths).toEqual([
			join(projectDir, ".pi", "skills", "b", "SKILL.md"),
			join(agentDir, "skills", "a", "SKILL.md"),
		]);
		expect(created.excludedExtensionPackages).toEqual(["npm:noisy"]);
		expect(created.contextFiles).toBe(true);
	});

	it("plain launch", async () => {
		const { created } = await launch({ prompt: false });
		expect(created.cwd).toBe(projectDir);
		for (const k of [
			"inheritSkills",
			"skillPaths",
			"excludedExtensionPackages",
			"contextFiles",
		]) {
			expect(created).not.toHaveProperty(k);
		}
	});

	it("explicit skills are final", async () => {
		const x = skillFile(dir("x"), "x");
		const extra = skillFile(dir("extra"), "extra");
		const { created, session } = await launch({
			resources: { skills: { inherit: false, paths: [x] } },
			extension: discovering(extra),
			prompt: false,
		});
		const after = session!.resourceLoader
			.getSkills()
			.skills.map((s) => s.filePath);
		expect(created.skillPaths).toEqual(after);
		expect(after).toEqual([x]);
	});

	it("inherited skills before bind", async () => {
		const extra = skillFile(dir("extra"), "extra");
		const { created, session } = await launch({
			resources: { skills: { inherit: true } },
			extension: discovering(extra),
			prompt: false,
		});
		expect(created.skillPaths).not.toContain(extra);
		expect(
			session!.resourceLoader.getSkills().skills.map((s) => s.filePath),
		).toContain(extra);
	});
});
