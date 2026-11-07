import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { startJevFixture, type FixtureRoute, type JevFixture } from "../jev/fixture";
import { startFixture, type Fixture, type RecordedRequest } from "./fixture";
import { tempDir } from "../helpers";
import { startHostSession, type HostSession } from "./harness";

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
// Synthetic filler so compaction finds a cut point (same tuning as q5-q6-main.test.ts).
const FILLER = "filler ".repeat(30_000);

type Choice = "low" | "medium" | "high" | "xhigh" | "max";

function answers(choice: Choice, risky = 0.1, corrects = 0.05): { json: unknown } {
  const probabilities = { low: 0, medium: 0, high: 0, xhigh: 0, max: 0 };
  probabilities[choice] = 1;
  return {
    json: {
      model: "jev-test",
      answers: {
        effort: { type: "choice", choice, confidence: 0.8, probabilities },
        risky: { type: "noul", noul: risky },
        corrects: { type: "noul", noul: corrects },
      },
    },
  };
}

const isSummarization = (r: RecordedRequest): boolean => {
  const msgs = Array.isArray(r.body.messages) ? (r.body.messages as { role?: string }[]) : [];
  const system = msgs.find((m) => m.role === "system" || m.role === "developer");
  return r.toolNames.length === 0 || /summar/i.test(JSON.stringify(system ?? ""));
};

async function setup(opts: { holdProviders: string[]; thinking: string }): Promise<{
  s: HostSession;
  fixture: Fixture;
  jev: JevFixture;
  routes: Record<string, FixtureRoute>;
}> {
  const fixture = await startFixture([
    {
      name: "summarization",
      match: isSummarization,
      reply: { text: "Summary of the conversation." },
      times: 1,
    },
    { name: "main", match: (r) => r.model === "fixture-main", reply: { text: "ok" } },
  ]);
  fixtures.push(fixture);
  const routes: Record<string, FixtureRoute> = { [ASK]: answers("low") };
  const jev = await startJevFixture(routes);
  jevs.push(jev);
  const s = await startHostSession({
    fixture,
    self: true,
    env: KEY,
    timeoutMs: 60_000,
    jevConfig: { url: jev.url(ASK), timeoutMs: 5000, holdProviders: opts.holdProviders },
    thinking: opts.thinking,
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

/** Count of `thinking_level_change` entries in the persisted session file(s). */
function levelChanges(s: HostSession): number {
  const dir = join(s.agentDir, "sessions");
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const f of walk(dir)) {
    for (const l of readFileSync(f, "utf8").split("\n")) {
      if (l.trim() === "") continue;
      if ((JSON.parse(l) as { type?: string }).type === "thinking_level_change") n++;
    }
  }
  return n;
}

/** `decided` anchors of every `jev-turn` custom entry in the persisted session file(s). */
function turnAnchors(s: HostSession): Record<string, unknown>[] {
  const dir = join(s.agentDir, "sessions");
  if (!existsSync(dir)) return [];
  const out: Record<string, unknown>[] = [];
  for (const f of walk(dir)) {
    for (const l of readFileSync(f, "utf8").split("\n")) {
      if (l.trim() === "") continue;
      const e = JSON.parse(l) as {
        type?: string;
        customType?: string;
        data?: { decided?: unknown };
      };
      if (
        e.type === "custom" &&
        e.customType === "jev-turn" &&
        typeof e.data?.decided === "object"
      ) {
        out.push(e.data.decided as Record<string, unknown>);
      }
    }
  }
  return out;
}

const questionKeys = (jev: JevFixture, i: number): string[] =>
  Object.keys((JSON.parse(jev.requests[i]!.body) as { questions: object }).questions);

/** One prompt, then wait until its `main` line is in the ledger and the session file is flushed. */
async function turn(s: HostSession, text: string, lines: number): Promise<void> {
  await s.prompt(text);
  await s.waitFor(() => mainLines(s).length >= lines, `main line ${lines}`);
  await Bun.sleep(300);
}

describe("effort hold through the real CLI", () => {
  test(
    "no thinking change after the anchor",
    async () => {
      const { s, fixture, jev, routes } = await setup({
        holdProviders: ["fixture"],
        thinking: "low",
      });
      routes[ASK] = answers("high");
      await turn(s, "one", 1);
      const afterFirst = levelChanges(s);
      routes[ASK] = answers("low");
      await turn(s, "two", 2);
      await turn(s, "three", 3);
      await turn(s, "four", 4);
      expect(fixture.requests.map((r) => r.reasoningEffort)).toEqual([
        "high",
        "high",
        "high",
        "high",
      ]);
      expect(jev.requests.length).toBe(4);
      for (const i of [1, 2, 3]) expect(questionKeys(jev, i)).toEqual(["corrects"]);
      expect(mainLines(s).map((l) => l["held"])).toEqual([undefined, true, true, true]);
      expect(levelChanges(s)).toBe(afterFirst);
    },
    TIMEOUT,
  );

  test(
    "exactly one decision after a compaction",
    async () => {
      const { s, fixture, jev, routes } = await setup({
        holdProviders: ["fixture"],
        thinking: "low",
      });
      routes[ASK] = answers("low");
      await turn(s, `one ${FILLER}`, 1);
      await turn(s, `two ${FILLER}`, 2);
      expect(questionKeys(jev, 1)).toEqual(["corrects"]);
      const response = await s.send({ type: "compact" });
      expect(response.success, String(response.error)).toBe(true);
      await Bun.sleep(300);
      const jevBefore = jev.requests.length;
      const reqBefore = fixture.requests.length;
      const changesBefore = levelChanges(s);
      routes[ASK] = answers("high");
      await turn(s, "three", 3);
      await turn(s, "four", 4);
      await turn(s, "five", 5);
      expect(jev.requests.length - jevBefore).toBe(3);
      expect(questionKeys(jev, jevBefore)).toContain("effort");
      expect(questionKeys(jev, jevBefore + 1)).toEqual(["corrects"]);
      expect(questionKeys(jev, jevBefore + 2)).toEqual(["corrects"]);
      expect(fixture.requests.slice(reqBefore).map((r) => r.reasoningEffort)).toEqual([
        "high",
        "high",
        "high",
      ]);
      expect(levelChanges(s) - changesBefore).toBe(1);
    },
    TIMEOUT,
  );

  test(
    "unlisted provider decides every prompt",
    async () => {
      const { s, jev } = await setup({ holdProviders: [], thinking: "low" });
      await turn(s, "one", 1);
      await turn(s, "two", 2);
      expect(jev.requests.length).toBe(2);
      expect(questionKeys(jev, 0)).toContain("effort");
      expect(questionKeys(jev, 1)).toContain("effort");
    },
    TIMEOUT,
  );

  test(
    "entry not in the provider request",
    async () => {
      const { s, fixture } = await setup({ holdProviders: ["fixture"], thinking: "low" });
      await turn(s, "one", 1);
      await turn(s, "two", 2);
      expect(
        turnAnchors(s).some((d) => d.provider === "fixture" && d.model === "fixture-main"),
      ).toBe(true);
      expect(mainLines(s)[1]?.held).toBe(true);
      const body = JSON.stringify(fixture.requests[1]!.body);
      expect(body).not.toContain("jev-turn");
      expect(body).not.toContain("decided");
    },
    TIMEOUT,
  );

  test(
    "held prompt with Jev down",
    async () => {
      const { s, fixture, jev, routes } = await setup({
        holdProviders: ["fixture"],
        thinking: "low",
      });
      routes[ASK] = answers("high");
      await turn(s, "one", 1);
      const afterFirst = levelChanges(s);
      routes[ASK] = { status: 500 };
      await turn(s, "two", 2);
      expect(jev.requests.length).toBe(2);
      expect(fixture.requests.map((r) => r.reasoningEffort)).toEqual(["high", "high"]);
      expect(mainLines(s)[1]).toMatchObject({ held: true, answered: false, miss: "error" });
      expect(levelChanges(s)).toBe(afterFirst);
    },
    TIMEOUT,
  );

  test(
    "resume keeps the hold",
    async () => {
      const agentDir = tempDir("jev-hold-agent-");
      const cwd = tempDir("jev-hold-cwd-");
      ownedDirs.push(agentDir, cwd);
      const fixture = await startFixture([
        { name: "main", match: (r) => r.model === "fixture-main", reply: { text: "ok" } },
      ]);
      fixtures.push(fixture);
      const routes: Record<string, FixtureRoute> = { [ASK]: answers("high") };
      const jev = await startJevFixture(routes);
      jevs.push(jev);
      const common = {
        fixture,
        self: true,
        env: KEY,
        timeoutMs: 60_000,
        jevConfig: { url: jev.url(ASK), timeoutMs: 5000, holdProviders: ["fixture"] },
        thinking: "low",
        persist: true,
        agentDir,
        cwd,
      };
      const a = await startHostSession(common);
      await turn(a, "one", 1);
      await a.close();
      // No --thinking here: an explicit flag would override the level restored from the session.
      const b = await startHostSession({ ...common, thinking: undefined, args: ["--continue"] });
      sessions.push(b);
      routes[ASK] = answers("low");
      await turn(b, "two", 2);
      expect(jev.requests.length).toBe(2);
      expect(questionKeys(jev, 1)).toEqual(["corrects"]);
      expect(fixture.requests.map((r) => r.reasoningEffort)).toEqual(["high", "high"]);
      expect(mainLines(b)[1]).toMatchObject({ held: true });
    },
    TIMEOUT,
  );
});
