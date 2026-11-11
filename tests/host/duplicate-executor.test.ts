import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, tempDir } from "../helpers";
import { startFixture, type Fixture, type ScriptEntry } from "./fixture";
import { startHostSession, type HostSession } from "./harness";
import { command, notifies } from "./rpc-helpers";

const JEV_ONLY = join(REPO_ROOT, "tests", "fixtures", "jev-only");
const TIMEOUT = 120_000;
const DISPOSE_WAIT_MS = 200_000;
const fixtures: Fixture[] = [];
const sessions: HostSession[] = [];

afterEach(async () => {
  for (const s of sessions.splice(0)) await s.close();
  for (const f of fixtures.splice(0)) await f.stop();
});

/** The pristine upstream tree commit recorded in VENDORED.md. */
function upstreamCommit(): string {
  const text = readFileSync(join(REPO_ROOT, "packages", "pi-subagents", "VENDORED.md"), "utf8");
  const found = /Upstream tree commit:\s*`([0-9a-f]{40})`/.exec(text);
  if (!found?.[1]) throw new Error("VENDORED.md has no Upstream tree commit");
  return found[1];
}

/** Builds the original `@gotgenes/pi-subagents` package offline from the squash commit's tree. */
function originalExecutor(): string {
  const dir = tempDir("jev-original-executor-");
  const archive = Bun.spawnSync(["git", "archive", upstreamCommit()], { cwd: REPO_ROOT });
  if (archive.exitCode !== 0) throw new Error(`git archive failed: ${archive.stderr.toString()}`);
  const tar = Bun.spawnSync(["tar", "-x", "-C", dir], { stdin: archive.stdout });
  if (tar.exitCode !== 0) throw new Error(`tar failed: ${tar.stderr.toString()}`);
  const file = join(dir, "package.json");
  const pkg = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  writeFileSync(file, JSON.stringify({ ...pkg, name: "@gotgenes/pi-subagents" }));
  return dir;
}

/**
 * A stand-in executor placed under `packages/pi-subagents/`: its `subagent` tool wins from inside
 * the vendored directory, but the service it publishes has no `implementation`, as an original
 * `@gotgenes/pi-subagents` loaded last would leave it. Only the published-service path decides.
 */
function standInInsideVendoredPath(): string {
  const dir = join(tempDir("jev-stand-in-"), "packages", "pi-subagents");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "stand-in-executor",
      private: true,
      type: "module",
      keywords: ["pi-package"],
      pi: { extensions: ["./index.ts"] },
    }),
  );
  writeFileSync(
    join(dir, "index.ts"),
    `export default function (pi) {
  globalThis[Symbol.for("@gotgenes/pi-subagents:service")] = { listAgents: () => [] };
  pi.registerTool({
    name: "subagent",
    label: "subagent",
    description: "stand-in",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: [{ type: "text", text: "no" }], details: {} }),
  });
}
`,
  );
  return dir;
}

const MAIN_ONLY: ScriptEntry[] = [
  { name: "main", match: (r) => r.model === "fixture-main", reply: { text: "ok" } },
];

async function start(installs: string[], script: ScriptEntry[] = MAIN_ONLY): Promise<HostSession> {
  const fixture = await startFixture(script);
  fixtures.push(fixture);
  const agentDir = tempDir("jev-dup-agent-");
  mkdirSync(join(agentDir, "jev"), { recursive: true });
  const session = await startHostSession({
    fixture,
    installs,
    agentDir,
    env: { TYPESAFE_API_KEY: "test-key" },
    timeoutMs: 90_000,
  });
  sessions.push(session);
  return session;
}

async function status(s: HostSession): Promise<string> {
  const before = notifies(s).length;
  await command(s, "/jev");
  await s.waitFor(() => notifies(s).length > before, "status notify");
  return notifies(s)[before]?.message ?? "";
}

// pi refuses to start when two extensions register the same tool name, so the vendored executor
// and the original cannot share a session; the original runs beside jev-pilot alone instead.
describe("duplicate executor through the real CLI", () => {
  const original = originalExecutor();

  test(
    "Original loaded last: a published non-vendored service is a duplicate",
    async () => {
      const text = await status(await start([JEV_ONLY, original]));
      expect(text).toContain("duplicate executor");
      expect(text).toContain("uninstall @gotgenes/pi-subagents");
    },
    TIMEOUT,
  );

  test(
    "Original loaded first: the other tool path is a duplicate",
    async () => {
      const text = await status(await start([original, JEV_ONLY]));
      expect(text).toContain("duplicate executor");
      expect(text).toContain("uninstall @gotgenes/pi-subagents");
    },
    TIMEOUT,
  );

  test(
    "a published non-vendored service is reported when the winning tool is inside the vendored path",
    async () => {
      const text = await status(await start([JEV_ONLY, standInInsideVendoredPath()]));
      expect(text).toContain("duplicate executor");
      expect(text).toContain("worker routing and tool assessment are off");
    },
    TIMEOUT,
  );

  test(
    "Present after children: two workers created and disposed leave the executor state unchanged",
    async () => {
      const calls = ["first", "second"].map((description) => ({
        name: "subagent",
        arguments: {
          prompt: `CHILD-TASK ${description}`,
          description,
          subagent_type: "general-purpose",
        },
      }));
      const isChild = (r: { body: unknown }): boolean =>
        JSON.stringify(r.body).includes("CHILD-TASK");
      const hasToolResult = (r: { body: unknown }): boolean =>
        JSON.stringify(r.body).includes('"role":"tool"');
      const fixture = await startFixture([
        { name: "child", match: isChild, reply: { text: "child done" } },
        {
          name: "main-call",
          match: (r) => r.model === "fixture-main" && !hasToolResult(r),
          reply: { toolCalls: calls },
          times: 1,
        },
        { name: "main-after", match: (r) => r.model === "fixture-main", reply: { text: "done" } },
      ]);
      fixtures.push(fixture);
      // The shortest retention window the executor accepts is one minute, and its sweep runs once
      // a minute: a collected (foreground) child is disposed within about two minutes, in the
      // same main session.
      // Project layer (`<cwd>/.pi/subagents.json`): the harness installs probes only into an agent
      // directory it creates itself, so the settings go in the working directory.
      const cwd = tempDir("jev-dup-cwd-");
      mkdirSync(join(cwd, ".pi"), { recursive: true });
      writeFileSync(
        join(cwd, ".pi", "subagents.json"),
        JSON.stringify({
          consumedSessionRetentionMinutes: 1,
          unconsumedSessionRetentionMinutes: 1,
        }),
      );
      const session = await startHostSession({
        fixture,
        cwd,
        probes: ["child"],
        env: { TYPESAFE_API_KEY: "test-key" },
        timeoutMs: DISPOSE_WAIT_MS,
      });
      sessions.push(session);
      await session.prompt("START-MAIN");
      // The child probe records `subagents:child:disposed` (event name and session id only).
      const disposed = (): number =>
        new Set(
          session
            .probeRecords()
            .filter((r) => r.event === "child:disposed")
            .map((r) => r.sessionId),
        ).size;
      await session.waitFor(() => disposed() >= 2, "two children disposed");
      const text = await status(session);
      expect(text).not.toContain("duplicate executor");
      expect(text).toContain("executor: present");
    },
    DISPOSE_WAIT_MS + 30_000,
  );
});
