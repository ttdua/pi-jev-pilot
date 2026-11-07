import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startJevFixture, type FixtureRoute, type JevFixture } from "../jev/fixture";
import { tempDir } from "../helpers";
import { startFixture, type Fixture } from "./fixture";
import { runOnce, startHostSession, type HostSession } from "./harness";
import {
  command,
  notifies,
  seedCorrections,
  seedLedger,
  uiRequests,
  writeConfigFile,
  type SeedOptions,
} from "./rpc-helpers";

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
const ASK = "/ask";
const HANG: FixtureRoute = { hang: true };

const okAnswer: FixtureRoute = {
  json: {
    model: "jev-test",
    answers: {
      effort: {
        type: "choice",
        choice: "low",
        confidence: 0.8,
        probabilities: { low: 1, medium: 0, high: 0, xhigh: 0, max: 0 },
      },
      risky: { type: "noul", noul: 0.1 },
      corrects: { type: "noul", noul: 0.05 },
    },
  },
};

type Line = Record<string, unknown> & { kind: string };
function mainLines(agentDir: string): Line[] {
  const file = join(agentDir, "jev", "ledger.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Line)
    .filter((l) => l.kind === "main");
}

const tuningPath = (agentDir: string): string => join(agentDir, "jev", "tuning.json");
const readJson = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
const tuned = (agentDir: string): Record<string, unknown> => readJson(tuningPath(agentDir));
const tuneNotifies = (s: HostSession): { type?: string; message: string }[] =>
  notifies(s)
    .filter((n) => n.message?.includes("Jev tune"))
    .map((n) => ({ type: n.notifyType, message: n.message ?? "" }));

type Env = { agentDir: string; cwd: string; fixture: Fixture; jev: JevFixture };

type EnvOptions = {
  route: FixtureRoute;
  /** Written as `classifier.timeoutMs`; absent keeps the default. */
  timeoutMs?: number;
  tuning?: Record<string, unknown>;
  state?: Record<string, unknown>;
  seed?: { n: number } & SeedOptions;
};

/** Order matters: Jev, config, ledger, then the session, so the harness adds no `timeoutMs`. */
async function makeEnv(o: EnvOptions): Promise<Env> {
  const agentDir = tempDir("tn-agent-");
  const cwd = tempDir("tn-cwd-");
  ownedDirs.push(agentDir, cwd);
  const fixture = await startFixture([
    {
      name: "main",
      match: (r) => r.model === "fixture-main",
      reply: { text: "ok" },
    },
  ]);
  fixtures.push(fixture);
  const jev = await startJevFixture({ [ASK]: o.route });
  jevs.push(jev);
  const classifier = {
    url: jev.url(ASK),
    ...(o.timeoutMs === undefined ? {} : { timeoutMs: o.timeoutMs }),
  };
  writeConfigFile(agentDir, { classifier });
  mkdirSync(join(agentDir, "jev"), { recursive: true });
  if (o.tuning !== undefined) writeFileSync(tuningPath(agentDir), JSON.stringify(o.tuning));
  if (o.state !== undefined) {
    writeFileSync(join(agentDir, "jev", "state.json"), JSON.stringify(o.state));
  }
  if (o.seed !== undefined) seedLedger(agentDir, o.seed.n, o.seed);
  return { agentDir, cwd, fixture, jev };
}

async function open(env: Env): Promise<HostSession> {
  const s = await startHostSession({
    fixture: env.fixture,
    self: true,
    env: KEY,
    timeoutMs: 60_000,
    persist: true,
    agentDir: env.agentDir,
    cwd: env.cwd,
  });
  sessions.push(s);
  return s;
}

async function closeSession(s: HostSession): Promise<void> {
  await s.close();
  sessions.splice(sessions.indexOf(s), 1);
}

const settledCount = (s: HostSession): number =>
  s.events.filter((e) => e.type === "agent_settled").length;

/** One prompt, then wait for its ledger line and the settle event; the sleep covers the rest. */
async function turn(s: HostSession, lines: number): Promise<void> {
  await s.prompt("hello");
  await s.waitFor(() => mainLines(s.agentDir).length >= lines, `main line ${lines}`);
  await s.waitFor(() => settledCount(s) >= 1, "agent_settled");
  await Bun.sleep(300);
}

const FIRING = { n: 39, misses: 9 } as const;
const setupFiring = (): Promise<Env> => makeEnv({ route: HANG, seed: FIRING });

describe("tuning through the real CLI", () => {
  test(
    "Rule fires at settle, RPC notify, Line shown",
    async () => {
      const env = await setupFiring();
      const s = await open(env);
      await s.prompt("hello");
      await s.waitFor(() => existsSync(tuningPath(env.agentDir)), "tuning.json");
      await s.waitFor(() => tuneNotifies(s).length >= 1, "tuning notify");
      await Bun.sleep(300);
      const doc = tuned(env.agentDir);
      expect(doc["timeoutMs"]).toEqual({ value: 1700, base: 1500 });
      expect(doc["pending"]).toBeDefined();
      expect(doc["seenAt"]).toBeDefined();
      expect(JSON.stringify(doc["history"])).toContain('"cause":"rule"');
      expect(tuneNotifies(s)).toEqual([
        {
          type: "info",
          message: "Jev tune: timeoutMs 1500→1700 · /jev tune undo",
        },
      ]);
      const msgs = await s.send({ type: "get_messages" });
      expect(JSON.stringify(msgs.data?.messages ?? [])).not.toContain("Jev tune");
    },
    TIMEOUT,
  );

  test(
    "Tuning makes no Jev call",
    async () => {
      const env = await setupFiring();
      const s = await open(env);
      await s.prompt("hello");
      await s.waitFor(() => mainLines(env.agentDir).length >= 40, "turn line");
      await s.waitFor(() => settledCount(s) >= 1, "agent_settled");
      const asked = env.jev.requests.length;
      await s.waitFor(() => existsSync(tuningPath(env.agentDir)), "tuning.json");
      await Bun.sleep(300);
      expect(env.jev.requests.length).toBe(asked);
    },
    TIMEOUT,
  );

  test(
    "Other files untouched",
    async () => {
      const state = JSON.stringify({ version: 1 });
      const env = await makeEnv({
        route: HANG,
        seed: FIRING,
        state: { version: 1 },
      });
      const files = ["config.json", "state.json"].map((f) => join(env.agentDir, "jev", f));
      const before = files.map((f) => readFileSync(f, "utf8"));
      expect(before[1]).toBe(state);
      const s = await open(env);
      await s.prompt("hello");
      await s.waitFor(() => existsSync(tuningPath(env.agentDir)), "tuning.json");
      await Bun.sleep(300);
      expect(files.map((f) => readFileSync(f, "utf8"))).toEqual(before);
    },
    TIMEOUT,
  );

  test(
    "Tuned value used by the next request",
    async () => {
      const env = await makeEnv({
        route: HANG,
        tuning: { version: 1, timeoutMs: { value: 2500, base: 1500 } },
      });
      const s = await open(env);
      await turn(s, 1);
      const line = mainLines(env.agentDir)[0]!;
      expect(line["miss"]).toBe("timeout");
      expect(line["ms"] as number).toBeGreaterThanOrEqual(2450);
      expect(line["ms"] as number).toBeLessThan(2700);
    },
    TIMEOUT,
  );

  test(
    "Shown once",
    async () => {
      const entry = {
        at: 1000,
        parameter: "timeoutMs",
        from: 1500,
        to: 1700,
        cause: "rule",
      };
      const env = await makeEnv({
        route: okAnswer,
        tuning: {
          version: 1,
          timeoutMs: { value: 1700, base: 1500 },
          history: [entry],
        },
      });
      const first = await open(env);
      await first.waitFor(() => tuneNotifies(first).length >= 1, "session-start line");
      expect(tuneNotifies(first)).toEqual([
        {
          type: "info",
          message: "Jev tune since your last session: timeoutMs 1500→1700 (1 change) · /jev tune",
        },
      ]);
      await closeSession(first);
      const second = await open(env);
      await second.waitFor(
        () => uiRequests(second).some((e) => e.method === "setWidget" && e.widgetKey === "jev"),
        "second session status widget",
      );
      await Bun.sleep(500);
      expect(tuneNotifies(second)).toEqual([]);
    },
    TIMEOUT,
  );

  test(
    "Off survives a restart, Off stops tuning",
    async () => {
      const env = await setupFiring();
      const first = await open(env);
      await command(first, "/jev tune off");
      await first.waitFor(() => tuneNotifies(first).length >= 1, "off notify");
      await closeSession(first);
      const second = await open(env);
      await command(second, "/jev tune");
      await second.waitFor(() => notifies(second).length >= 1, "report notify");
      expect(notifies(second).at(-1)?.message?.startsWith("tuning: off")).toBe(true);
      await turn(second, 40);
      const doc = existsSync(tuningPath(env.agentDir)) ? tuned(env.agentDir) : {};
      expect(doc["timeoutMs"]).toBeUndefined();
    },
    TIMEOUT,
  );

  test(
    "Print mode tunes silently",
    async () => {
      const env = await setupFiring();
      const r = await runOnce({
        fixture: env.fixture,
        mode: "print",
        message: "hello",
        self: true,
        agentDir: env.agentDir,
        cwd: env.cwd,
        env: KEY,
      });
      expect(r.code).toBe(0);
      const deadline = Date.now() + 5000;
      while (!existsSync(tuningPath(env.agentDir)) && Date.now() < deadline) await Bun.sleep(50);
      const doc = tuned(env.agentDir);
      expect(doc["timeoutMs"]).toEqual({ value: 1700, base: 1500 });
      expect(doc["seenAt"]).toBeUndefined();
      expect(r.stdout).not.toContain("Jev tune");
    },
    TIMEOUT,
  );

  test(
    "Signals never tune",
    async () => {
      const env = await makeEnv({
        route: okAnswer,
        seed: { n: 60, answered: { effective: "low", toolCalls: 30 } },
      });
      seedCorrections(
        env.agentDir,
        Array.from({ length: 60 }, (_, i) => `seed-${i}`),
      );
      const s = await open(env);
      await turn(s, 61);
      expect(existsSync(tuningPath(env.agentDir))).toBe(false);
    },
    TIMEOUT,
  );

  test(
    "Superseded at first settle after restart",
    async () => {
      const env = await makeEnv({
        route: okAnswer,
        timeoutMs: 2000,
        tuning: { version: 1, timeoutMs: { value: 1700, base: 1500 } },
      });
      const s = await open(env);
      await s.prompt("hello");
      await s.waitFor(() => tuneNotifies(s).length >= 1, "superseded notify");
      expect(tuneNotifies(s)[0]?.message).toBe(
        "Jev tune: timeoutMs 1700→2000, your config value replaces the tuned one",
      );
    },
    TIMEOUT,
  );
});
