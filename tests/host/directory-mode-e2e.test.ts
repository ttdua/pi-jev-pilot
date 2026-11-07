import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  const agentDir = tempDir("jev-dm-agent-");
  const cwd = tempDir("jev-dm-cwd-");
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

/** Waits for the status widget to show `want`, then returns its text. */
async function widgetShows(s: HostSession, want: string): Promise<string> {
  await s.waitFor(() => lastWidget(s).includes(want), `widget ${want}`);
  return lastWidget(s);
}

/** Text of the last status widget the extension published. */
function lastWidget(s: HostSession): string {
  const lines = uiRequests(s)
    .filter((e) => e.method === "setWidget" && e.widgetKey === "jev")
    .map((e) => e.widgetLines)
    .filter((l): l is string[] => Array.isArray(l));
  return (lines.at(-1) ?? []).join("\n");
}

const LOCAL_FILE = ".pi/jev-mode.json";
const localFile = (cwd: string): string => join(cwd, LOCAL_FILE);
const readLocal = (cwd: string): string => readFileSync(localFile(cwd), "utf8");

/** A second working directory that shares the agent directory of `dirs`. */
function otherCwd(dirs: Shared): Shared {
  const cwd = tempDir("jev-dm-cwd-b-");
  ownedDirs.push(cwd);
  return { agentDir: dirs.agentDir, cwd };
}

describe("directory mode through the real CLI", () => {
  test(
    "New session uses it",
    async () => {
      const dirs = sharedDirs();
      saveMode(dirs.agentDir, "standard");
      const fixture = await mainFixture();
      const a = await open(fixture, dirs);
      expect(await report(a, "/jev mode premium")).toContain("premium");
      await a.close();
      const b = await open(fixture, dirs);
      expect(await report(b, "/jev")).toContain("mode: premium (this directory; global standard)");
      await widgetShows(b, "Jev · premium (local)");
    },
    TIMEOUT,
  );

  test(
    "Set before the first message",
    async () => {
      const dirs = sharedDirs();
      const fixture = await mainFixture();
      const a = await open(fixture, dirs);
      await report(a, "/jev mode budget");
      await a.close();
      expect(JSON.parse(readLocal(dirs.cwd))).toEqual({ version: 1, mode: "budget" });
      const b = await open(fixture, dirs);
      expect(await report(b, "/jev")).toContain("mode: budget (this directory;");
    },
    TIMEOUT,
  );

  test(
    "Other directory keeps the global mode",
    async () => {
      const dirs = sharedDirs();
      saveMode(dirs.agentDir, "standard");
      const fixture = await mainFixture();
      const a = await open(fixture, dirs);
      await report(a, "/jev mode premium");
      expect(await report(a, "/jev")).toContain("mode: premium (this directory;");
      const b = await open(fixture, otherCwd(dirs));
      const text = await report(b, "/jev");
      expect(text).toContain("mode: standard");
      expect(text).not.toContain("(this directory");
      expect(await widgetShows(b, "Jev · standard")).not.toContain("(local)");
    },
    TIMEOUT,
  );

  test(
    "Second process sees a change",
    async () => {
      const dirs = sharedDirs();
      saveMode(dirs.agentDir, "standard");
      const fixture = await mainFixture();
      const a = await open(fixture, dirs);
      const b = await open(fixture, dirs);
      expect(await report(b, "/jev")).toContain("mode: standard");
      await report(a, "/jev mode budget");
      expect(await report(b, "/jev")).toContain("mode: budget (this directory; global standard)");
    },
    TIMEOUT,
  );

  test(
    "No other project file touched",
    async () => {
      const dirs = sharedDirs();
      const gitignore = join(dirs.cwd, ".gitignore");
      writeFileSync(gitignore, "node_modules\n");
      const fixture = await mainFixture();
      const a = await open(fixture, dirs);
      await report(a, "/jev mode premium");
      expect(readLocal(dirs.cwd)).toContain("premium");
      expect(readFileSync(gitignore, "utf8")).toBe("node_modules\n");
      await report(a, "/jev mode clear");
      expect(existsSync(localFile(dirs.cwd))).toBe(false);
      expect(readFileSync(gitignore, "utf8")).toBe("node_modules\n");
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

describe("directory mode on worker launches", () => {
  test(
    "Next launch uses the directory mode",
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
      expect(await report(session, "/jev mode budget")).toContain("budget");
      expect(await report(session, "/jev")).toContain("mode: budget (this directory;");
      await session.prompt("START-MAIN");
      const lines = (): Record<string, unknown>[] => {
        const r = readLedger(dir);
        const all = r.kind === "ok" ? (r.entries as unknown as Record<string, unknown>[]) : [];
        return all.filter((e) => e["kind"] === "worker");
      };
      await session.waitFor(() => lines().length >= 1, "worker ledger line");
      // Budget cut points send the 0.9-balanced answer to the fast tier; premium would pick balanced.
      expect(lines()[0]).toMatchObject({ mode: "budget", tier: "fast", answered: true });
      expect(lines()[0]).not.toHaveProperty("miss");
      expect(fixture.requests.find(isChild)?.model).toBe("fixture-fast");
    },
    TIMEOUT,
  );
});
