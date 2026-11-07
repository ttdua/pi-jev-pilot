import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../helpers";
import { startJevFixture, type FixtureRoute, type JevFixture } from "../jev/fixture";
import { startFixture, type Fixture, type RecordedRequest, type ScriptEntry } from "./fixture";
import { startHostSession, type HostSession } from "./harness";

const fixtures: Fixture[] = [];
const jevs: JevFixture[] = [];
const sessions: HostSession[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const s of sessions.splice(0)) await s.close();
  for (const f of fixtures.splice(0)) await f.stop();
  for (const j of jevs.splice(0)) await j.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const KEY = { TYPESAFE_API_KEY: "test-key" };
const TIMEOUT = 120_000;
const ASK = "/ask";
const BODY = "JEV-SKILL-BODY-DEBUG";
// Synthetic filler so compaction finds a cut point (same tuning as effort-hold.test.ts).
const FILLER = "filler ".repeat(30_000);

const SKILLS = {
  debug: `---\nname: debug\ndescription: Debug a failing program step by step.\n---\n${BODY}\nFind the root cause first.\n`,
  plan: `---\nname: plan\ndescription: Plan a multi-step change.\n---\nJEV-SKILL-BODY-PLAN\nWrite the plan.\n`,
};

type Which = { debug?: number; plan?: number; none?: number };

/** A reply with effort `low` and a `which` answer; the gates default to a clear fit. */
function reply(which: Which, gate = 0.9): { json: unknown } {
  const probabilities = { debug: 0, plan: 0, "(none)": 0 };
  probabilities.debug = which.debug ?? 0;
  probabilities.plan = which.plan ?? 0;
  probabilities["(none)"] = which.none ?? 0;
  const entries = Object.entries(probabilities);
  const lead = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
  const effort = { low: 1, medium: 0, high: 0, xhigh: 0, max: 0 };
  return {
    json: {
      model: "jev-test",
      answers: {
        effort: { type: "choice", choice: "low", confidence: 0.8, probabilities: effort },
        risky: { type: "noul", noul: 0.1 },
        corrects: { type: "noul", noul: 0.05 },
        which: { type: "choice", choice: lead[0], confidence: 0.8, probabilities },
        "gate::acts_on_user_system": { type: "noul", noul: gate },
        "gate::would_follow_documented_procedure": { type: "noul", noul: gate },
        "gate::prose_suffices": { type: "noul", noul: 1 - gate },
      },
    },
  };
}
const PICK = reply({ debug: 0.8, none: 0.2 });
const NONE = reply({ debug: 0.1, none: 0.9 });

const isSummarization = (r: RecordedRequest): boolean => {
  const msgs = Array.isArray(r.body.messages) ? (r.body.messages as { role?: string }[]) : [];
  const system = msgs.find((m) => m.role === "system" || m.role === "developer");
  return r.toolNames.length === 0 || /summar/i.test(JSON.stringify(system ?? ""));
};

const SCRIPT: ScriptEntry[] = [
  {
    name: "summarization",
    match: isSummarization,
    reply: { text: "Summary of the conversation." },
    times: 1,
  },
  { name: "main", match: (r) => r.model === "fixture-main", reply: { text: "ok" } },
];

async function setup(
  route: FixtureRoute,
  opts: { inject?: "content" | "suggest" } = {},
): Promise<{
  s: HostSession;
  fixture: Fixture;
  jev: JevFixture;
  routes: Record<string, FixtureRoute>;
}> {
  const fixture = await startFixture(SCRIPT);
  fixtures.push(fixture);
  const routes: Record<string, FixtureRoute> = { [ASK]: route };
  const jev = await startJevFixture(routes);
  jevs.push(jev);
  const s = await startHostSession({
    fixture,
    self: true,
    env: KEY,
    timeoutMs: 60_000,
    jevConfig: {
      url: jev.url(ASK),
      timeoutMs: 5000,
      ...(opts.inject === undefined ? {} : { skillsInject: opts.inject }),
    },
    skills: SKILLS,
    persist: true,
  });
  sessions.push(s);
  return { s, fixture, jev, routes };
}

type Line = Record<string, unknown> & { kind: string };
function mainLines(s: HostSession): Line[] {
  const file = join(s.agentDir, "jev", "ledger.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Line)
    .filter((l) => l.kind === "main");
}

const walk = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".jsonl") ? [join(d, e.name)] : [],
  );

type SessionEntry = {
  id?: string;
  type?: string;
  customType?: string;
  display?: boolean;
  firstKeptEntryId?: string;
  details?: { name?: string; fingerprint?: string; form?: string };
};

/** Every entry of the persisted session file, in file order. */
function sessionEntries(s: HostSession): SessionEntry[] {
  const dir = join(s.agentDir, "sessions");
  if (!existsSync(dir)) return [];
  return walk(dir).flatMap((f) =>
    readFileSync(f, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as SessionEntry),
  );
}
const isSkill = (e: SessionEntry): boolean =>
  e.type === "custom_message" && e.customType === "jev-skill";
const skillEntries = (s: HostSession): SessionEntry[] => sessionEntries(s).filter(isSkill);

const mainRequests = (f: Fixture): RecordedRequest[] =>
  f.requests.filter((r) => r.model === "fixture-main" && !isSummarization(r));
const messagesOf = (r: RecordedRequest): string => JSON.stringify(r.body.messages);
const bodyCount = (r: RecordedRequest): number => messagesOf(r).split(BODY).length - 1;
const questionKeys = (jev: JevFixture, i: number): string[] =>
  Object.keys((JSON.parse(jev.requests[i]!.body) as { questions: object }).questions);

/** One prompt, then wait until its `main` line is in the ledger and the session file is flushed. */
async function turn(s: HostSession, text: string, lines: number): Promise<void> {
  await s.prompt(text);
  await s.waitFor(() => mainLines(s).length >= lines, `main line ${lines}`);
  await Bun.sleep(300);
}

async function compact(s: HostSession): Promise<{ firstKept: number; entries: SessionEntry[] }> {
  const response = await s.send({ type: "compact" });
  expect(response.success, String(response.error)).toBe(true);
  await Bun.sleep(300);
  const entries = sessionEntries(s);
  const compaction = entries.find((e) => e.type === "compaction");
  expect(compaction?.firstKeptEntryId).toBeDefined();
  return {
    firstKept: entries.findIndex((e) => e.id === compaction?.firstKeptEntryId),
    entries,
  };
}

describe("skill delivery through the real CLI", () => {
  test(
    "content once across three picks",
    async () => {
      const { s, fixture } = await setup(PICK);
      await turn(s, "one", 1);
      await turn(s, "two", 2);
      await turn(s, "three", 3);
      const entries = skillEntries(s);
      expect(entries.map((e) => e.details?.form)).toEqual(["content", "reference", "reference"]);
      expect(entries.every((e) => e.display === false)).toBe(true);
      const main = mainRequests(fixture);
      expect(main.length).toBe(3);
      expect(main.map(bodyCount)).toEqual([1, 1, 1]);
      expect(mainLines(s).map((l) => l["skill"])).toEqual(["debug", "debug", "debug"]);
    },
    TIMEOUT,
  );

  test(
    "operator loads a skill then a pick",
    async () => {
      const { s, fixture, jev } = await setup(PICK);
      await turn(s, "/skill:debug go", 1);
      expect(questionKeys(jev, 0)).not.toContain("which");
      expect(skillEntries(s)).toEqual([]);
      expect(bodyCount(mainRequests(fixture)[0]!)).toBe(1);
      const before = mainRequests(fixture).length;
      await turn(s, "again", 2);
      const entries = skillEntries(s);
      expect(entries.map((e) => e.details?.form)).toEqual(["reference"]);
      const second = mainRequests(fixture).slice(before);
      expect(second.length).toBeGreaterThan(0);
      expect(second.map(bodyCount)).toEqual(second.map(() => 1));
    },
    TIMEOUT,
  );

  test(
    "after a compaction, dropped",
    async () => {
      const { s, routes } = await setup(PICK);
      await turn(s, "one", 1);
      routes[ASK] = NONE;
      await turn(s, `two ${FILLER}`, 2);
      await turn(s, `three ${FILLER}`, 3);
      const { firstKept, entries } = await compact(s);
      const first = entries.findIndex(isSkill);
      expect(first).toBeGreaterThanOrEqual(0);
      expect(first).toBeLessThan(firstKept);
      routes[ASK] = PICK;
      await turn(s, "four", 4);
      expect(skillEntries(s).map((e) => e.details?.form)).toEqual(["content", "content"]);
    },
    TIMEOUT,
  );

  test(
    "after a compaction, kept",
    async () => {
      const { s, routes } = await setup(NONE);
      await turn(s, `one ${FILLER}`, 1);
      await turn(s, `two ${FILLER}`, 2);
      routes[ASK] = PICK;
      await turn(s, "three", 3);
      const { firstKept, entries } = await compact(s);
      const first = entries.findIndex(isSkill);
      expect(first).toBeGreaterThanOrEqual(0);
      expect(first).toBeGreaterThanOrEqual(firstKept);
      await turn(s, "four", 4);
      expect(skillEntries(s).map((e) => e.details?.form)).toEqual(["content", "reference"]);
    },
    TIMEOUT,
  );

  test(
    "none leads: no entry and no relevance block",
    async () => {
      const { s, fixture } = await setup(NONE);
      await turn(s, "one", 1);
      expect(skillEntries(s)).toEqual([]);
      expect(messagesOf(mainRequests(fixture)[0]!)).not.toContain("<skill_relevance>");
    },
    TIMEOUT,
  );

  test(
    "gate too low: no entry and no relevance block",
    async () => {
      const { s, fixture } = await setup(reply({ debug: 0.4, plan: 0.3, none: 0.3 }, 0.1));
      await turn(s, "one", 1);
      expect(skillEntries(s)).toEqual([]);
      expect(messagesOf(mainRequests(fixture)[0]!)).not.toContain("<skill_relevance>");
      expect(mainLines(s)[0]).not.toHaveProperty("skill");
    },
    TIMEOUT,
  );

  test(
    "suggest form carries the path and no body",
    async () => {
      const { s, fixture } = await setup(PICK, { inject: "suggest" });
      await turn(s, "one", 1);
      expect(skillEntries(s).map((e) => e.details?.form)).toEqual(["suggest"]);
      const request = mainRequests(fixture)[0]!;
      expect(bodyCount(request)).toBe(0);
      expect(messagesOf(request)).toContain(join("skills", "debug", "SKILL.md"));
    },
    TIMEOUT,
  );

  test(
    "jev down: same provider messages as with skills off",
    async () => {
      const agentDir = tempDir("jev-skill-agent-");
      const cwd = tempDir("jev-skill-cwd-");
      dirs.push(agentDir, cwd);
      const jev = await startJevFixture({ [ASK]: { status: 500 } });
      jevs.push(jev);
      const run = async (off: boolean): Promise<{ bodies: string[]; entries: number }> => {
        const fixture = await startFixture(SCRIPT);
        fixtures.push(fixture);
        const s = await startHostSession({
          fixture,
          self: true,
          env: KEY,
          timeoutMs: 60_000,
          agentDir,
          cwd,
          jevConfig: { url: jev.url(ASK), timeoutMs: 5000 },
          skills: SKILLS,
          persist: true,
        });
        if (off) await s.prompt("/jev skills off");
        await turn(s, "hello", 1);
        const entries = skillEntries(s).length;
        await s.close();
        return { bodies: mainRequests(fixture).map(messagesOf), entries };
      };
      const on = await run(false);
      const off = await run(true);
      expect(on.entries).toBe(0);
      expect(off.entries).toBe(0);
      expect(on.bodies.length).toBeGreaterThan(0);
      expect(on.bodies).toEqual(off.bodies);
    },
    TIMEOUT,
  );

  test(
    "skills only: effort off keeps the level",
    async () => {
      const { s, jev } = await setup(PICK);
      await s.prompt("/jev effort off");
      const level = async (): Promise<unknown> =>
        ((await s.send({ type: "get_state" })).data as { thinkingLevel?: unknown }).thinkingLevel;
      const before = await level();
      await turn(s, "one", 1);
      expect(skillEntries(s).map((e) => e.details?.form)).toEqual(["content"]);
      expect(questionKeys(jev, 0)).not.toContain("effort");
      expect(questionKeys(jev, 0)).toContain("which");
      expect(await level()).toBe(before);
    },
    TIMEOUT,
  );

  test(
    "marker absent from the ledger and the entries",
    async () => {
      const { s } = await setup(PICK);
      await turn(s, "JEV-MARKER-PROMPT please", 1);
      expect(skillEntries(s).length).toBe(1);
      expect(JSON.stringify(mainLines(s))).not.toContain("JEV-MARKER-");
      for (const e of skillEntries(s))
        expect(JSON.stringify(e.details)).not.toContain("JEV-MARKER-");
    },
    TIMEOUT,
  );
});
