import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, tempDir } from "../helpers";
const JEV_ONLY = join(REPO_ROOT, "tests", "fixtures", "jev-only");
import { startFixture, type Fixture } from "./fixture";
import { startHostSession, type HostSession } from "./harness";
import { command, notifies } from "./rpc-helpers";

const TIMEOUT = 120_000;
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

async function start(installs: string[]): Promise<HostSession> {
  const fixture = await startFixture([
    { name: "main", match: (r) => r.model === "fixture-main", reply: { text: "ok" } },
  ]);
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
    "original loaded last is reported",
    async () => {
      const text = await status(await start([JEV_ONLY, original]));
      expect(text).toContain("duplicate executor");
      expect(text).toContain("uninstall @gotgenes/pi-subagents");
    },
    TIMEOUT,
  );

  test(
    "original loaded first is reported",
    async () => {
      const text = await status(await start([original, JEV_ONLY]));
      expect(text).toContain("duplicate executor");
      expect(text).toContain("uninstall @gotgenes/pi-subagents");
    },
    TIMEOUT,
  );

  test(
    "the checkout alone is present",
    async () => {
      const text = await status(await start([REPO_ROOT]));
      expect(text).toContain("executor: present");
    },
    TIMEOUT,
  );
});
