import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startJevFixture, type FixtureRoute, type JevFixture } from "../jev/fixture";
import { startFixture, type Fixture } from "./fixture";
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

/** `data` of every `jev-log` custom entry in the persisted session file(s). */
function logEntries(s: HostSession): Record<string, unknown>[] {
  const dir = join(s.agentDir, "sessions");
  if (!existsSync(dir)) return [];
  const out: Record<string, unknown>[] = [];
  for (const f of walk(dir)) {
    for (const l of readFileSync(f, "utf8").split("\n")) {
      if (l.trim() === "") continue;
      const e = JSON.parse(l) as { type?: string; customType?: string; data?: unknown };
      if (e.type === "custom" && e.customType === "jev-log") {
        out.push(e.data as Record<string, unknown>);
      }
    }
  }
  return out;
}

async function turn(s: HostSession, text: string, lines: number): Promise<void> {
  await s.prompt(text);
  await s.waitFor(() => mainLines(s).length >= lines, `main line ${lines}`);
  await Bun.sleep(300);
}

async function setup(opts: { verbose: boolean; jev: FixtureRoute }): Promise<{
  s: HostSession;
  fixture: Fixture;
}> {
  const agentDir = tempDir("vb-agent-");
  const cwd = tempDir("vb-cwd-");
  ownedDirs.push(agentDir, cwd);
  if (opts.verbose) {
    mkdirSync(join(agentDir, "jev"), { recursive: true });
    writeFileSync(
      join(agentDir, "jev", "state.json"),
      JSON.stringify({ version: 1, switches: { verbose: true } }),
    );
  }
  const fixture = await startFixture([
    { name: "main", match: (r) => r.model === "fixture-main", reply: { text: "ok" } },
  ]);
  fixtures.push(fixture);
  const jev = await startJevFixture({ [ASK]: opts.jev });
  jevs.push(jev);
  const s = await startHostSession({
    fixture,
    self: true,
    env: KEY,
    timeoutMs: 60_000,
    jevConfig: { url: jev.url(ASK), timeoutMs: 5000 },
    thinking: "low",
    persist: true,
    agentDir,
    cwd,
  });
  sessions.push(s);
  return { s, fixture };
}

describe("verbose log through the real CLI", () => {
  test(
    "hidden from the next request",
    async () => {
      const { s, fixture } = await setup({ verbose: true, jev: okAnswer });
      await turn(s, "one", 1);
      await turn(s, "two", 2);
      const first = mainLines(s)[0]!;
      const entries = logEntries(s);
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries.some((d) => Bun.deepEquals(d, first))).toBe(true);
      const turnId = first["turnId"];
      expect(typeof turnId).toBe("string");
      expect((turnId as string).length).toBeGreaterThan(0);
      const mains = fixture.requests.filter((r) => r.model === "fixture-main");
      expect(mains.length).toBeGreaterThanOrEqual(2);
      const body = JSON.stringify(mains[1]!.body);
      expect(body).not.toContain("jev-log");
      expect(body).not.toContain(turnId as string);
    },
    TIMEOUT,
  );

  test(
    "verbose off by default",
    async () => {
      const { s } = await setup({ verbose: false, jev: okAnswer });
      await turn(s, "one", 1);
      await turn(s, "two", 2);
      const dir = join(s.agentDir, "sessions");
      expect(existsSync(dir)).toBe(true);
      const files = walk(dir);
      expect(files.length).toBeGreaterThanOrEqual(1);
      expect(files.some((f) => readFileSync(f, "utf8").includes('"jev-turn"'))).toBe(true);
      expect(logEntries(s)).toEqual([]);
    },
    TIMEOUT,
  );

  test(
    "Jev down is logged",
    async () => {
      const { s } = await setup({ verbose: true, jev: { status: 500 } });
      await turn(s, "one", 1);
      expect(logEntries(s).some((d) => d["miss"] === "error")).toBe(true);
    },
    TIMEOUT,
  );
});
