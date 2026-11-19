/**
 * Per-launch extension exclusion through the real composition root: the real
 * `src/index.ts` wiring, the real `DefaultResourceLoader` and `createAgentSession`
 * against a loopback provider, and a local package fixture. An excluded
 * package's module is never imported, so its top-level marker stays empty.
 */
import {
	appendFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import subagentsExtension from "#src/index";
import {
	getSubagentsService,
	unpublishSubagentsService,
} from "#src/service/service";

async function startLoopback() {
	const bodies: { messages: { role: string; content: unknown }[] }[] = [];
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
		close: () => new Promise<void>((r) => server.close(() => r())),
	};
}

const text = (content: unknown) =>
	typeof content === "string"
		? content
		: (content as { text: string }[]).map((p) => p.text).join("");

describe("per-launch extension exclusion (real composition root)", () => {
	let root: string;
	let projectDir: string;
	let agentDir: string;
	let marker: string;
	let loopback: Awaited<ReturnType<typeof startLoopback>>;
	let packs: { flow: string; sibling: string };
	const events: { channel: string; data: any }[] = [];
	const saved = {
		agentDir: process.env.PI_CODING_AGENT_DIR,
		cwd: process.cwd(),
	};

	function makePack(name: string, boot: string): string {
		const dir = join(root, name);
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({ name, pi: { extensions: ["./ext.ts"] } }),
		);
		writeFileSync(
			join(dir, "ext.ts"),
			`import { appendFileSync } from "node:fs";
appendFileSync(process.env.${name === "flow-pack" ? "FLOW_MARKER" : "SIB_MARKER"}!, "imported");
export default function (pi: any) {
	pi.on("before_agent_start", (e: any) => ({ systemPrompt: e.systemPrompt + "\\n${boot}" }));
}
`,
		);
		return dir;
	}

	beforeEach(async () => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "launch-res-ext-")));
		projectDir = join(root, "project");
		agentDir = join(root, "agent");
		mkdirSync(join(projectDir, ".pi"), { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		marker = join(root, "flow.marker");
		writeFileSync(marker, "");
		writeFileSync(join(root, "sib.marker"), "");
		vi.stubEnv("FLOW_MARKER", marker);
		vi.stubEnv("SIB_MARKER", join(root, "sib.marker"));
		vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
		vi.stubEnv("PI_SUBAGENTS_DEBUG", "1");
		packs = {
			flow: makePack("flow-pack", "BOOT-MARKER"),
			sibling: makePack("sib-pack", "SIB-MARKER"),
		};
		writeFileSync(
			join(projectDir, ".pi", "settings.json"),
			JSON.stringify({ packages: [packs.flow, packs.sibling] }),
		);
		loopback = await startLoopback();
		mkdirSync(join(root, "sessions"), { recursive: true });
		events.length = 0;
		vi.spyOn(console, "warn").mockImplementation(() => {});
	});
	afterEach(async () => {
		unpublishSubagentsService();
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
		await loopback.close();
		rmSync(root, { recursive: true, force: true });
	});

	async function mainSession(settingsExtra?: object) {
		if (settingsExtra) {
			writeFileSync(
				join(agentDir, "subagents.json"),
				JSON.stringify(settingsExtra),
			);
		}
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
		const registry = new ModelRegistry(runtime);
		const handlers = new Map<string, Array<(...args: any[]) => unknown>>();
		const pi = {
			registerMessageRenderer: vi.fn(),
			registerTool: vi.fn(),
			registerCommand: vi.fn(),
			on: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
				handlers.set(event, [...(handlers.get(event) ?? []), handler]);
			}),
			events: {
				emit: vi.fn((channel: string, data: unknown) =>
					events.push({ channel, data }),
				),
				on: vi.fn(() => vi.fn()),
			},
			appendEntry: vi.fn(),
			sendMessage: vi.fn(),
			exec: vi.fn(async () => ({ stdout: "", stderr: "", code: 1 })),
			getAllTools: vi.fn(() => []),
			getActiveTools: vi.fn(() => []),
		} as any;
		subagentsExtension(pi);
		const ctx = {
			hasUI: false,
			ui: {
				setStatus: vi.fn(),
				setWidget: vi.fn(),
				onTerminalInput: vi.fn(() => () => {}),
				getEditorText: () => "",
			},
			cwd: projectDir,
			model: runtime.getModel("loop", "m"),
			modelRegistry: registry,
			isProjectTrusted: () => true,
			sessionManager: {
				getSessionId: () => "main-1",
				getSessionFile: () => join(root, "sessions", "main-1.jsonl"),
				getBranch: () => [],
			},
			getSystemPrompt: () => "prompt",
		};
		for (const h of handlers.get("session_start") ?? []) await h({}, ctx);
		return getSubagentsService()!;
	}

	async function launch(
		service: Awaited<ReturnType<typeof mainSession>>,
		exclude?: string[],
	) {
		const before = loopback.bodies.length;
		const id = service.spawn("general", "go", {
			foreground: true,
			cwd: projectDir,
			...(exclude && { excludeExtensionPackages: exclude }),
		});
		await vi.waitFor(
			() =>
				expect(["completed", "error"]).toContain(service.getRecord(id)?.status),
			{ timeout: 15000 },
		);
		expect(service.getRecord(id)?.error).toBeUndefined();
		await vi.waitFor(
			() => expect(loopback.bodies.length).toBeGreaterThan(before),
			{ timeout: 15000 },
		);
		const body = loopback.bodies[before]!;
		return {
			system: text(body.messages.find((m) => m.role === "system")?.content),
			id,
		};
	}

	it("bootstrap kept out of one child", async () => {
		const service = await mainSession();
		const excluded = await launch(service, [packs.flow]);
		expect(excluded.system).not.toContain("BOOT-MARKER");
		expect(excluded.system).toContain("SIB-MARKER");
		expect(readFileSync(marker, "utf8")).toBe("");

		const sibling = await launch(service);
		expect(sibling.system).toContain("BOOT-MARKER");
		expect(readFileSync(marker, "utf8")).toContain("imported");
	});

	it("unknown package noted", async () => {
		const service = await mainSession();
		const warn = vi.mocked(console.warn);
		const { system } = await launch(service, ["npm:not-installed"]);
		expect(system).toContain("BOOT-MARKER");
		expect(warn.mock.calls.flat().join("\n")).toContain("npm:not-installed");
	});

	it("setting exclusion reported even when not installed", async () => {
		const service = await mainSession({
			excludedExtensionPackages: ["npm:noisy"],
		});
		await launch(service, [packs.flow]);
		const created = events.find(
			(e) => e.channel === "subagents:child:session-created",
		);
		expect(created?.data.excludedExtensionPackages).toEqual([
			"npm:noisy",
			packs.flow,
		]);
	});
});
