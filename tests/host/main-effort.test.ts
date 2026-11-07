import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run, tempDir } from "../helpers";
import { startJevFixture, type FixtureRoute, type JevFixture } from "../jev/fixture";
import { toolNames, withoutReview } from "./bodies";
import { startFixture, type Fixture, type ScriptEntry } from "./fixture";
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

type Held = { route: FixtureRoute; release: (route: FixtureRoute) => void };
function held(): Held {
  let release!: (route: FixtureRoute) => void;
  const promise = new Promise<FixtureRoute>((resolve) => {
    release = resolve;
  });
  return { route: { held: promise }, release };
}

async function setup(
  route: FixtureRoute,
  opts: {
    timeoutMs?: number;
    thinking?: string;
    persist?: boolean;
    script?: ScriptEntry[];
    cwd?: string;
  } = {},
): Promise<{
  s: HostSession;
  fixture: Fixture;
  jev: JevFixture;
  routes: Record<string, FixtureRoute>;
}> {
  const fixture = await startFixture(
    opts.script ?? [
      { name: "main", match: (r) => r.model === "fixture-main", reply: { text: "ok" } },
    ],
  );
  fixtures.push(fixture);
  const routes: Record<string, FixtureRoute> = { [ASK]: route };
  const jev = await startJevFixture(routes);
  jevs.push(jev);
  const s = await startHostSession({
    fixture,
    self: true,
    env: KEY,
    timeoutMs: 60_000,
    jevConfig: { url: jev.url(ASK), timeoutMs: opts.timeoutMs ?? 5000 },
    ...(opts.thinking === undefined ? {} : { thinking: opts.thinking }),
    ...(opts.persist === undefined ? {} : { persist: opts.persist }),
    ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
  });
  sessions.push(s);
  return { s, fixture, jev, routes };
}

type UiRequest = RpcEvent & { method?: string; widgetKey?: string; widgetLines?: string[] };
const widgetLines = (s: HostSession): (string[] | undefined)[] =>
  s.events
    .filter((e): e is UiRequest => e.type === "extension_ui_request")
    .filter((e) => e.method === "setWidget" && e.widgetKey === "jev")
    .map((e) => e.widgetLines);

type Line = Record<string, unknown> & { kind: string };
function ledger(s: HostSession): Line[] {
  const file = join(s.agentDir, "jev", "ledger.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Line);
}
const mainLines = (s: HostSession): Line[] => ledger(s).filter((l) => l.kind === "main");

async function thinkingLevel(s: HostSession): Promise<unknown> {
  const r = await s.send({ type: "get_state" });
  return (r.data as { thinkingLevel?: unknown }).thinkingLevel;
}

const settled = (s: HostSession): number =>
  s.events.filter((e) => e.type === "agent_settled").length;

async function jevAsked(s: HostSession, jev: JevFixture): Promise<void> {
  await s.waitFor(() => jev.requests.length >= 1, "jev request");
}

describe("main effort through the real CLI", () => {
  test(
    "level on first request",
    async () => {
      // `match` runs synchronously when the provider request arrives, so the snapshot of the
      // RPC event stream taken there is ordered in practice: it holds what the host had emitted
      // (and the harness had read) before the request; the two pipes are not strictly synchronized.
      let atRequest: (string[] | undefined)[] | undefined;
      let session: HostSession | undefined;
      const { s, fixture } = await setup(answers("xhigh", 0.1, 0.05), {
        script: [
          {
            name: "main",
            match: (r) => {
              if (r.model !== "fixture-main") return false;
              if (atRequest === undefined && session !== undefined) {
                atRequest = widgetLines(session).slice();
              }
              return true;
            },
            reply: { text: "ok" },
          },
        ],
      });
      session = s;
      await s.waitFor(() => widgetLines(s).length >= 1, "start widget");
      expect(widgetLines(s)[0]).toEqual(["Jev · standard"]);
      await s.prompt("hello");
      expect(atRequest).toContainEqual(["Jev · standard · xhigh"]);
      expect(fixture.requests[0]?.reasoningEffort).toBe("xhigh");
      expect(fixture.requests[0]?.model).toBe("fixture-main");
      expect(widgetLines(s)).toContainEqual(["Jev · standard · xhigh"]);
      expect(fixture.unmatched).toEqual([]);
    },
    TIMEOUT,
  );

  test(
    "risk floor raises low to high",
    async () => {
      const { s, fixture } = await setup(answers("low", 0.8, 0.05));
      await s.prompt("hello");
      expect(fixture.requests[0]?.reasoningEffort).toBe("high");
      await s.waitFor(() => mainLines(s).length >= 1, "main line");
      expect(mainLines(s)[0]).toMatchObject({ requested: "high", effective: "high" });
    },
    TIMEOUT,
  );

  test(
    "max kept",
    async () => {
      const { s, fixture } = await setup(answers("low", 0.1, 0.05), { thinking: "max" });
      await s.waitFor(() => widgetLines(s).length >= 1, "start widget");
      expect(widgetLines(s)[0]).toEqual(["Jev · standard"]);
      await s.prompt("hello");
      expect(fixture.requests[0]?.reasoningEffort).toBe("max");
      await s.waitFor(() => mainLines(s).length >= 1, "main line");
      expect(mainLines(s)[0]).toMatchObject({ requested: "low", effective: "max" });
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
      const plain = await startFixture([
        { name: "main", match: (r) => r.model === "fixture-main", reply: { text: "ok" } },
      ]);
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

      const fixture = await startFixture([
        { name: "main", match: (r) => r.model === "fixture-main", reply: { text: "ok" } },
      ]);
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
      expect(widgetLines(s).at(-1)).toEqual(["Jev · standard · no answer"]);
      const lines = mainLines(s);
      expect(lines.length).toBe(1);
      expect(lines[0]).toMatchObject({ answered: false, miss: "error" });
      expect(jev.requests.length).toBe(1);
      // The package adds only the jev_review tool (WG-15); compare everything else.
      // Raw equality is valid: the provider body carries no id or timestamp field today.
      const bodies = (f: Fixture): string[] =>
        f.requests.map((r) => JSON.stringify(withoutReview(r.body)));
      expect(bodies(fixture).length).toBeGreaterThan(0);
      expect(fixture.requests.every((r) => toolNames(r.body).includes("jev_review"))).toBe(true);
      expect(plain.requests.every((r) => !toolNames(r.body).includes("jev_review"))).toBe(true);
      expect(bodies(fixture)).toEqual(bodies(plain));
      expect(fixture.requests[0]?.reasoningEffort).toBe(plain.requests[0]?.reasoningEffort);
    },
    TIMEOUT,
  );

  test(
    "jev timeout does not hold the first request",
    async () => {
      const h = held();
      const { s, fixture } = await setup(h.route, { timeoutMs: 300 });
      await s.waitFor(() => widgetLines(s).length >= 1, "start widget");
      const t0 = Date.now();
      const resp = s.send({ type: "prompt", message: "hello" });
      await s.waitFor(() => fixture.requests.length >= 1, "first provider request");
      expect(Date.now() - t0).toBeLessThan(1500);
      h.release({ status: 500 });
      expect((await resp).success).toBe(true);
      await s.waitFor(() => settled(s) >= 1, "agent_settled");
      await s.waitFor(() => mainLines(s).length >= 1, "main line");
      expect(mainLines(s)[0]).toMatchObject({ answered: false, miss: "timeout" });
    },
    TIMEOUT,
  );

  test(
    "esc starts nothing",
    async () => {
      const h = held();
      const { s, fixture, jev } = await setup(h.route, { timeoutMs: 5000 });
      await s.waitFor(() => widgetLines(s).length >= 1, "start widget");
      const start = await thinkingLevel(s);
      const resp = s.send({ type: "prompt", message: "hello" });
      await jevAsked(s, jev);
      const before = settled(s);
      // RPC abort waits for idle, which needs the handler to return: do not await it yet.
      const abort = s.send({ type: "abort" });
      h.release(answers("xhigh"));
      const ar = await abort;
      expect(ar.success).toBe(true);
      await resp.catch(() => {});
      await s.waitFor(() => settled(s) > before, "agent_settled");
      await Bun.sleep(500);
      expect(fixture.requests.length).toBe(0);
      expect(await thinkingLevel(s)).toBe(start);
      expect(mainLines(s)).toEqual([]);
    },
    TIMEOUT,
  );

  test(
    "discard when the operator changes the level",
    async () => {
      const h = held();
      // Start at `high` (not the default) so the operator change to `medium` is a real change.
      const { s, fixture, jev } = await setup(h.route, { timeoutMs: 5000, thinking: "high" });
      await s.waitFor(() => widgetLines(s).length >= 1, "start widget");
      const resp = s.send({ type: "prompt", message: "hello" });
      await jevAsked(s, jev);
      const set = await s.send({ type: "set_thinking_level", level: "medium" });
      expect(set.success).toBe(true);
      h.release(answers("xhigh"));
      expect((await resp).success).toBe(true);
      await s.waitFor(() => fixture.requests.length >= 1, "first provider request");
      expect(fixture.requests[0]?.reasoningEffort).toBe("medium");
      await s.waitFor(() => mainLines(s).length >= 1, "main line");
      const line = mainLines(s)[0]!;
      expect(line.requested).toBe("xhigh");
      expect("effective" in line).toBe(false);
    },
    TIMEOUT,
  );

  test(
    "correction line points at the previous turn",
    async () => {
      const { s, routes } = await setup(answers("high", 0.1, 0.05));
      await s.prompt("first");
      await s.waitFor(() => mainLines(s).length >= 1, "first main line");
      routes[ASK] = answers("high", 0.1, 0.9);
      await s.prompt("second");
      await s.waitFor(() => mainLines(s).length >= 2, "second main line");
      const first = mainLines(s)[0]!;
      const corrections = ledger(s).filter((l) => l.kind === "correction");
      expect(corrections.length).toBe(1);
      expect(corrections[0]?.turnId).toBe(first.turnId);
      expect(mainLines(s)[1]?.turnId).not.toBe(first.turnId);
    },
    TIMEOUT,
  );

  test(
    "privacy: the prompt is in no ledger file and no custom entry",
    async () => {
      const { s } = await setup(answers("high", 0.1, 0.05), { persist: true });
      await s.prompt("JEV-MARKER-PROMPT please");
      await s.waitFor(() => mainLines(s).length >= 1, "main line");
      await Bun.sleep(300);
      const jevDir = join(s.agentDir, "jev");
      for (const f of readdirSync(jevDir)) {
        const p = join(jevDir, f);
        if (f.endsWith(".json") || f.endsWith(".jsonl")) {
          expect(readFileSync(p, "utf8")).not.toContain("JEV-MARKER-");
        }
      }
      const walk = (d: string): string[] =>
        readdirSync(d, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory()
            ? walk(join(d, e.name))
            : e.name.endsWith(".jsonl")
              ? [join(d, e.name)]
              : [],
        );
      const sessionDir = join(s.agentDir, "sessions");
      expect(existsSync(sessionDir)).toBe(true);
      const files = walk(sessionDir);
      expect(files.length).toBeGreaterThan(0);
      let customCount = 0;
      for (const f of files) {
        for (const l of readFileSync(f, "utf8").split("\n")) {
          if (l.trim() === "") continue;
          const e = JSON.parse(l) as { type?: string };
          if (e.type === "custom") {
            customCount++;
            expect(l).not.toContain("JEV-MARKER-");
          }
        }
      }
      expect(customCount).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  test(
    "follow-up during the wait gives one jev request and one main line",
    async () => {
      const h = held();
      const { s, fixture, jev } = await setup(h.route, {
        timeoutMs: 5000,
        script: [{ name: "a", match: () => true, reply: { text: "ok" } }],
      });
      await s.waitFor(() => widgetLines(s).length >= 1, "start widget");
      const first = s.send({ type: "prompt", message: "first" });
      await jevAsked(s, jev);
      const second = s.send({
        type: "prompt",
        message: "second",
        streamingBehavior: "followUp",
      });
      h.release(answers("high"));
      expect((await first).success).toBe(true);
      expect((await second).success).toBe(true);
      await s.waitFor(() => fixture.requests.length >= 2, "both provider requests");
      await s.waitFor(() => settled(s) >= 1, "agent_settled");
      await s.waitFor(() => mainLines(s).length >= 1, "main line");
      await Bun.sleep(500);
      expect(jev.requests.length).toBe(1);
      expect(mainLines(s).length).toBe(1);
    },
    TIMEOUT,
  );
});

describe("default request state", () => {
  test(
    "default request stays minimal",
    async () => {
      const cwd = tempDir("jev-rich-git-");
      dirs.push(cwd);
      const git = (...args: string[]) =>
        run(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd });
      git("init", "-q");
      writeFileSync(join(cwd, "a.ts"), "one\n");
      git("add", ".");
      git("commit", "-q", "-m", "init");
      writeFileSync(join(cwd, "a.ts"), "one\ntwo\n");
      const { s, jev } = await setup(answers("high"), { cwd });
      await s.prompt("first");
      await s.waitFor(() => mainLines(s).length >= 1, "first main line");
      await s.prompt("second");
      await s.waitFor(() => jev.requests.length >= 2, "second jev request");
      type Sent = { conversation: Record<string, unknown>; workspace: object };
      const states = jev.requests.map((r) => (JSON.parse(r.body) as { state: Sent }).state);
      const [first, second] = states as [Sent, Sent];
      // Field set: the second answered turn carries the two shipped groups.
      expect(Object.keys(second).sort()).toEqual([
        "capabilities",
        "conversation",
        "request",
        "workspace",
      ]);
      expect(second.conversation["last_decision"]).toMatchObject({ effort: "high" });
      expect(Object.keys(second.conversation).sort()).toEqual([
        "last_decision",
        "recent",
        "recent_tools",
        "turn_index",
      ]);
      expect(Object.keys(second.workspace)).toEqual(["platforms"]);
      // First turn has capabilities but no last decision.
      expect(first).toHaveProperty("capabilities");
      expect(first.conversation).not.toHaveProperty("last_decision");
      // Unshipped groups are never sent.
      for (const state of states) {
        const text = JSON.stringify(state);
        for (const key of ["context_used_percent", "git", "languages"]) {
          expect(text).not.toContain(`"${key}"`);
        }
      }
    },
    TIMEOUT,
  );
});
