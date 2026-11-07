import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startJevFixture, type FixtureRoute, type JevFixture } from "../jev/fixture";
import { readLedger } from "../../src/store/ledger.ts";
import { tempDir } from "../helpers";
import { startFixture, type Fixture, type RecordedRequest, type ScriptEntry } from "./fixture";
import { startHostSession, type HostSession } from "./harness";
import { command, notifies, uiRequests } from "./rpc-helpers";

const fixtures: Fixture[] = [];
const jevs: JevFixture[] = [];
const sessions: HostSession[] = [];
const ownedDirs: string[] = [];

afterEach(async () => {
  for (const s of sessions.splice(0)) await s.close();
  for (const f of fixtures.splice(0)) await f.stop();
  for (const j of jevs.splice(0)) await j.stop();
  for (const d of ownedDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const KEY = { TYPESAFE_API_KEY: "test-key" };
const TIMEOUT = 120_000;

async function mainFixture(): Promise<Fixture> {
  const fixture = await startFixture([
    { name: "main", match: (r) => r.model === "fixture-main", reply: { text: "ok" } },
  ]);
  fixtures.push(fixture);
  return fixture;
}

type Shared = { agentDir: string; cwd: string };

function sharedDirs(): Shared {
  const agentDir = tempDir("jev-sm-agent-");
  const cwd = tempDir("jev-sm-cwd-");
  ownedDirs.push(agentDir, cwd);
  return { agentDir, cwd };
}

async function open(fixture: Fixture, dirs: Shared, args: string[] = []): Promise<HostSession> {
  const s = await startHostSession({
    fixture,
    self: true,
    env: KEY,
    timeoutMs: 60_000,
    persist: true,
    agentDir: dirs.agentDir,
    cwd: dirs.cwd,
    args,
  });
  sessions.push(s);
  return s;
}

/** Writes a saved mode into the agent directory's state.json. */
function saveMode(agentDir: string, mode: string): void {
  mkdirSync(join(agentDir, "jev"), { recursive: true });
  writeFileSync(join(agentDir, "jev", "state.json"), JSON.stringify({ version: 1, mode }));
}

/** Runs a `/jev` command and returns the text of the notification it produced. */
async function report(s: HostSession, text: string): Promise<string> {
  const before = notifies(s).length;
  await command(s, text);
  await s.waitFor(() => notifies(s).length > before, `notify for ${text}`);
  return notifies(s)[before]?.message ?? "";
}

/** Text of the last status widget the extension published. */
function lastWidget(s: HostSession): string {
  const lines = uiRequests(s)
    .filter((e) => e.method === "setWidget" && e.widgetKey === "jev")
    .map((e) => e.widgetLines)
    .filter((l): l is string[] => Array.isArray(l));
  return (lines.at(-1) ?? []).join("\n");
}

describe("session mode through the real CLI", () => {
  test(
    "Survives resume",
    async () => {
      const dirs = sharedDirs();
      saveMode(dirs.agentDir, "standard");
      const fixture = await mainFixture();
      const a = await open(fixture, dirs);
      expect(await report(a, "/jev mode premium session")).toContain("premium");
      await a.waitFor(() => lastWidget(a).includes("Jev · premium (session)"), "session widget");
      // Pi writes the session file only once it holds a conversation message.
      await a.prompt("persist me");
      await Bun.sleep(300);
      await a.close();
      const b = await open(fixture, dirs, ["--continue"]);
      expect(await report(b, "/jev")).toContain("mode: premium (session; saved standard)");
    },
    TIMEOUT,
  );

  test(
    "Fork carries the session mode",
    async () => {
      const dirs = sharedDirs();
      const fixture = await mainFixture();
      const s = await open(fixture, dirs);
      await report(s, "/jev mode budget session");
      await s.prompt("fork me");
      const forks = await s.send({ type: "get_fork_messages" });
      const messages = (forks.data?.["messages"] ?? []) as { entryId: string; text: string }[];
      const target = messages.find((m) => m.text.includes("fork me"));
      expect(target, JSON.stringify(messages)).toBeDefined();
      const forked = await s.send({ type: "fork", entryId: target!.entryId });
      expect(forked.success, String(forked.error)).toBe(true);
      expect(await report(s, "/jev")).toContain("mode: budget (session;");
    },
    TIMEOUT,
  );

  test(
    "New session starts without one",
    async () => {
      const dirs = sharedDirs();
      const fixture = await mainFixture();
      const s = await open(fixture, dirs);
      await report(s, "/jev mode premium session");
      const created = await s.send({ type: "new_session" });
      expect(created.success, String(created.error)).toBe(true);
      const text = await report(s, "/jev");
      expect(text).toContain("mode: standard");
      expect(text).not.toContain("(session");
    },
    TIMEOUT,
  );

  test(
    "Other sessions keep the saved mode",
    async () => {
      const dirs = sharedDirs();
      const fixture = await mainFixture();
      const a = await open(fixture, dirs);
      const other = tempDir("jev-sm-cwd-b-");
      ownedDirs.push(other);
      const b = await open(fixture, { agentDir: dirs.agentDir, cwd: other });
      await report(a, "/jev mode premium session");
      const text = await report(b, "/jev");
      expect(text).toContain("mode: standard");
      expect(text).not.toContain("(session");
    },
    TIMEOUT,
  );
});

// --- Worker launch ---------------------------------------------------------------------

const AGENT = "probe-worker";
const AGENT_TEXT = "---\ndescription: Probe worker\ntools: read, grep\n---\nYou are a probe.\n";

type Msg = { role?: string; content?: unknown };
const messages = (r: RecordedRequest): Msg[] =>
  Array.isArray(r.body.messages) ? (r.body.messages as Msg[]) : [];
const lastIsUser = (r: RecordedRequest, text: string): boolean => {
  const last = messages(r).at(-1);
  return last?.role === "user" && JSON.stringify(last).includes(text);
};
const isChild = (r: RecordedRequest): boolean => lastIsUser(r, "CHILD-TASK");
const hasTool = (r: RecordedRequest): boolean => messages(r).some((m) => m.role === "tool");

function launchScript(): ScriptEntry[] {
  const call = {
    name: "subagent",
    arguments: {
      prompt: "CHILD-TASK do the work",
      description: "probe",
      subagent_type: AGENT,
      model: "fixture/fixture-balanced",
      thinking: "low",
    },
  };
  return [
    { name: "child", match: isChild, reply: { text: "child done" } },
    {
      name: "main-call",
      match: (r) =>
        r.model === "fixture-main" &&
        !isChild(r) &&
        !hasTool(r) &&
        JSON.stringify(r.body.messages).includes("START-MAIN"),
      reply: { toolCalls: [call] },
      times: 1,
    },
    { name: "main-after", match: (r) => r.model === "fixture-main", reply: { text: "done" } },
  ];
}

function tierAnswer(): FixtureRoute {
  const probabilities = { fast: 0.1, balanced: 0.9 };
  const effort = { low: 0.1, medium: 0.9, high: 0, xhigh: 0, max: 0 };
  return {
    json: {
      answers: {
        effort: { type: "choice", choice: "medium", probabilities: effort, confidence: 0.9 },
        risky: { type: "noul", noul: 0.2 },
        tier: { type: "choice", choice: "balanced", probabilities, confidence: 0.9 },
      },
    },
  };
}

describe("session mode on worker launches", () => {
  test(
    "Next launch uses the session mode",
    async () => {
      const fixture = await startFixture(launchScript());
      fixtures.push(fixture);
      const jev = await startJevFixture({ "/classify": tierAnswer() });
      jevs.push(jev);
      const session = await startHostSession({
        fixture,
        self: true,
        executor: true,
        agents: { [AGENT]: AGENT_TEXT },
        env: KEY,
        timeoutMs: 60_000,
      });
      sessions.push(session);
      const dir = join(session.agentDir, "jev");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "config.json"),
        JSON.stringify({
          classifier: { url: jev.url("/classify"), timeoutMs: 1500 },
          tiers: { fast: "fixture/fixture-fast", balanced: "fixture/fixture-balanced" },
        }),
      );
      writeFileSync(join(dir, "state.json"), JSON.stringify({ version: 1, mode: "premium" }));
      expect(await report(session, "/jev mode budget session")).toContain("budget");
      await session.prompt("START-MAIN");
      const lines = (): Record<string, unknown>[] => {
        const r = readLedger(dir);
        const all = r.kind === "ok" ? (r.entries as unknown as Record<string, unknown>[]) : [];
        return all.filter((e) => e["kind"] === "worker");
      };
      await session.waitFor(() => lines().length >= 1, "worker ledger line");
      expect(lines()[0]).toMatchObject({ mode: "budget" });
    },
    TIMEOUT,
  );
});
