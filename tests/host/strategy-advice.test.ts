import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../helpers";
import { startJevFixture, type FixtureRoute, type JevFixture } from "../jev/fixture";
import { toolNames, withoutReview } from "./bodies";
import { startFixture, type Fixture } from "./fixture";
import { runOnce, startHostSession, type HostSession } from "./harness";
import type { RpcEvent } from "./rpc";

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
const MARKER = "best carried out as: delegate.";
const MAIN_SCRIPT = [
  {
    name: "main",
    match: (r: { model?: unknown }) => r.model === "fixture-main",
    reply: { text: "ok" },
  },
];

type Strategy = "direct" | "delegate" | "parallel" | "graph";

function choice(pick: string, options: string[], p: number): unknown {
  const probabilities = Object.fromEntries(options.map((o) => [o, o === pick ? p : 0]));
  return { type: "choice", choice: pick, confidence: 0.8, probabilities };
}

function answers(strategy: Strategy, p: number): { json: unknown } {
  return {
    json: {
      model: "jev-test",
      answers: {
        effort: choice("high", ["low", "medium", "high", "xhigh", "max"], 1),
        risky: { type: "noul", noul: 0.1 },
        corrects: { type: "noul", noul: 0.05 },
        tier: choice("balanced", ["fast", "balanced", "deep"], 1),
        strategy: choice(strategy, ["direct", "delegate", "parallel", "graph"], p),
      },
    },
  };
}

async function setup(
  route: FixtureRoute,
): Promise<{ s: HostSession; fixture: Fixture; jev: JevFixture }> {
  const fixture = await startFixture(MAIN_SCRIPT);
  fixtures.push(fixture);
  const jev = await startJevFixture({ [ASK]: route });
  jevs.push(jev);
  const s = await startHostSession({
    fixture,
    self: true,
    env: KEY,
    timeoutMs: 60_000,
    jevConfig: { url: jev.url(ASK), timeoutMs: 5000 },
  });
  sessions.push(s);
  return { s, fixture, jev };
}

type UiRequest = RpcEvent & { method?: string; widgetKey?: string; widgetLines?: string[] };
const widgetLines = (s: HostSession): (string[] | undefined)[] =>
  s.events
    .filter((e): e is UiRequest => e.type === "extension_ui_request")
    .filter((e) => e.method === "setWidget" && e.widgetKey === "jev")
    .map((e) => e.widgetLines);

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

describe("strategy advice through the real CLI", () => {
  test(
    "delegate 0.9 reaches the provider, the status and the ledger",
    async () => {
      const { s, fixture } = await setup(answers("delegate", 0.9));
      await s.prompt("hello");
      expect(JSON.stringify(fixture.requests[0]?.body)).toContain(MARKER);
      expect(widgetLines(s)).toContainEqual(["Jev · standard · high · delegate"]);
      await s.waitFor(() => mainLines(s).length >= 1, "main line");
      expect(mainLines(s)[0]).toMatchObject({ strategy: "delegate", advised: true });
    },
    TIMEOUT,
  );

  test(
    "direct 1.0 attaches nothing",
    async () => {
      const { s, fixture } = await setup(answers("direct", 1));
      await s.prompt("hello");
      expect(JSON.stringify(fixture.requests[0]?.body)).not.toContain("<execution_strategy>");
      await s.waitFor(() => mainLines(s).length >= 1, "main line");
      expect(mainLines(s)[0]).toMatchObject({ strategy: "direct", advised: false });
    },
    TIMEOUT,
  );

  test(
    "jev down 500 changes nothing",
    async () => {
      const agentDir = tempDir("jev-host-agent-");
      const cwd = tempDir("jev-host-cwd-");
      dirs.push(agentDir, cwd);
      const jev = await startJevFixture({ [ASK]: { status: 500 } });
      jevs.push(jev);
      const jevConfig = { url: jev.url(ASK), timeoutMs: 5000 };
      const plain = await startFixture(MAIN_SCRIPT);
      fixtures.push(plain);
      const r1 = await runOnce({
        fixture: plain,
        mode: "print",
        message: "hello",
        self: false,
        agentDir,
        cwd,
        env: KEY,
        jevConfig,
      });
      expect(r1.code).toBe(0);

      const fixture = await startFixture(MAIN_SCRIPT);
      fixtures.push(fixture);
      const s = await startHostSession({
        fixture,
        self: true,
        env: KEY,
        timeoutMs: 60_000,
        agentDir,
        cwd,
        jevConfig,
      });
      sessions.push(s);
      await s.prompt("hello");
      await s.waitFor(() => mainLines(s).length >= 1, "main line");
      expect(jev.requests.length).toBe(1);
      expect("advised" in mainLines(s)[0]!).toBe(false);
      const bodies = (f: Fixture): string[] =>
        f.requests.map((r) => JSON.stringify(withoutReview(r.body)));
      expect(bodies(fixture).length).toBeGreaterThan(0);
      expect(fixture.requests.every((r) => toolNames(r.body).includes("jev_review"))).toBe(true);
      expect(bodies(fixture)).toEqual(bodies(plain));
      expect(bodies(fixture).join("")).not.toContain("<execution_strategy>");
    },
    TIMEOUT,
  );

  test(
    "effort off, strategy on: advice only, level untouched",
    async () => {
      const { s, fixture, jev } = await setup(answers("delegate", 0.9));
      await s.waitFor(() => widgetLines(s).length >= 1, "start widget");
      const start = ((await s.send({ type: "get_state" })).data as { thinkingLevel?: unknown })
        .thinkingLevel;
      await s.prompt("/jev effort off");
      await s.prompt("hello");
      expect(jev.requests.length).toBe(1);
      expect(JSON.stringify(fixture.requests[0]?.body)).toContain(MARKER);
      expect(fixture.requests[0]?.reasoningEffort).toBe(start as string);
      await s.waitFor(() => mainLines(s).length >= 1, "main line");
      const line = mainLines(s)[0]!;
      expect("requested" in line).toBe(false);
      expect(line).toMatchObject({ strategy: "delegate", advised: true });
    },
    TIMEOUT,
  );
});
