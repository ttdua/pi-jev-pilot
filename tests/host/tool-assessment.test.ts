import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startJevFixture, type FixtureRoute, type JevFixture } from "../jev/fixture";
import { readLedger } from "../../src/store/ledger.ts";
import { startFixture, type Fixture, type RecordedRequest, type ScriptEntry } from "./fixture";
import { startHostSession, type HostSession } from "./harness";

const fixtures: Fixture[] = [];
const jevs: JevFixture[] = [];
const sessions: HostSession[] = [];

afterEach(async () => {
  for (const s of sessions.splice(0)) await s.close();
  for (const f of fixtures.splice(0)) await f.stop();
  for (const j of jevs.splice(0)) await j.stop();
});

const TIMEOUT = 90_000;
const MARKER = "JEV-MARKER-9c1d";
const OPEN = "probe-open";
const OPEN2 = "probe-open-2";
const AGENTS = {
  [OPEN]: "---\ndescription: Open probe\n---\nYou are an open probe worker.\n",
  [OPEN2]: "---\ndescription: Second open probe\n---\nYou are the second open probe worker.\n",
};
// Names a default worker may offer; every one gets an answer, `edit` is the flagged one.
const TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"];

type Msg = { role?: string; content?: unknown };
const messages = (r: RecordedRequest): Msg[] =>
  Array.isArray(r.body.messages) ? (r.body.messages as Msg[]) : [];
const isChild = (r: RecordedRequest): boolean => {
  const last = messages(r).at(-1);
  return last?.role === "user" && JSON.stringify(last).includes("CHILD-TASK");
};
const hasTool = (r: RecordedRequest): boolean => messages(r).some((m) => m.role === "tool");
const isChildAfterTool = (r: RecordedRequest): boolean =>
  hasTool(r) && JSON.stringify(r.body.messages).includes("CHILD-TASK");
const isMainFirst = (r: RecordedRequest): boolean =>
  r.model === "fixture-main" &&
  !isChild(r) &&
  !hasTool(r) &&
  JSON.stringify(r.body.messages).includes("START-MAIN");

type Call = { name: string; arguments: Record<string, unknown> };
const launch = (type: string, description: string, extra: object = {}): Call => ({
  name: "subagent",
  arguments: {
    prompt: `CHILD-TASK do the work ${MARKER}`,
    description,
    subagent_type: type,
    model: "fixture/fixture-balanced",
    thinking: "low",
    ...extra,
  },
});

function script(calls: Call[], childEdit = false): ScriptEntry[] {
  const child: ScriptEntry[] = childEdit
    ? [
        { name: "child-after", match: isChildAfterTool, reply: { text: "child done" } },
        {
          name: "child-edit",
          match: isChild,
          reply: {
            toolCalls: [
              {
                name: "edit",
                arguments: { path: "nothing.txt", edits: [{ oldText: "a", newText: "b" }] },
              },
            ],
          },
          times: 1,
        },
      ]
    : [];
  return [
    ...child,
    { name: "child", match: isChild, reply: { text: "child done" } },
    { name: "main-call", match: isMainFirst, reply: { toolCalls: calls }, times: 1 },
    { name: "main-after", match: (r) => r.model === "fixture-main", reply: { text: "done" } },
  ];
}

function choice(pick: string, options: string[]): object {
  const probabilities: Record<string, number> = {};
  for (const o of options) probabilities[o] = o === pick ? 0.9 : 0.1 / (options.length - 1);
  return { type: "choice", choice: pick, probabilities, confidence: 0.9 };
}

function route(): FixtureRoute {
  const answers: Record<string, object> = {
    effort: choice("medium", ["low", "medium", "high", "xhigh", "max"]),
    risky: { type: "noul", noul: 0.2 },
    tier: choice("balanced", ["fast", "balanced"]),
  };
  for (const n of TOOL_NAMES)
    answers[`tool::${n}`] = { type: "noul", noul: n === "edit" ? 0.9 : 0.1 };
  return { json: { answers } };
}

async function newJev(r: FixtureRoute = route()): Promise<JevFixture> {
  const j = await startJevFixture({ "/classify": r });
  jevs.push(j);
  return j;
}

function writeJev(
  agentDir: string,
  jev: JevFixture,
  extra: { enforce?: boolean; state?: Record<string, unknown> } = {},
): void {
  const dir = join(agentDir, "jev");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify({
      classifier: { url: jev.url("/classify"), timeoutMs: 1500 },
      tiers: { fast: "fixture/fixture-fast", balanced: "fixture/fixture-balanced" },
      ...(extra.enforce ? { tools: { mode: "enforce" } } : {}),
    }),
  );
  if (extra.state) writeFileSync(join(dir, "state.json"), JSON.stringify(extra.state));
}

async function setup(entries: ScriptEntry[], probes: string[] = []) {
  const fixture = await startFixture(entries);
  fixtures.push(fixture);
  const session = await startHostSession({
    fixture,
    self: true,
    executor: true,
    probes,
    agents: AGENTS,
    env: { TYPESAFE_API_KEY: "test-key" },
    timeoutMs: 60_000,
  });
  sessions.push(session);
  return { fixture, session };
}

type ToolBody = {
  state?: { agent?: { name?: string } };
  questions?: Record<string, unknown>;
};
const bodyOf = (j: JevFixture["requests"][number]): ToolBody => JSON.parse(j.body) as ToolBody;
const toolRequests = (j: JevFixture): JevFixture["requests"] =>
  j.requests.filter((r) =>
    Object.keys(bodyOf(r).questions ?? {}).some((k) => k.startsWith("tool::")),
  );
const toolKeys = (r: JevFixture["requests"][number]): string[] =>
  Object.keys(bodyOf(r).questions ?? {}).filter((k) => k.startsWith("tool::"));

const ledger = (s: HostSession): Record<string, unknown>[] => {
  const r = readLedger(join(s.agentDir, "jev"));
  return r.kind === "ok" ? (r.entries as unknown as Record<string, unknown>[]) : [];
};
const workerLines = (s: HostSession): Record<string, unknown>[] =>
  ledger(s).filter((e) => e["kind"] === "worker");

async function runOne(opts: {
  jev?: FixtureRoute;
  enforce?: boolean;
  state?: Record<string, unknown>;
  childEdit?: boolean;
  type?: string;
}) {
  const jev = await newJev(opts.jev);
  const { fixture, session } = await setup(
    script([launch(opts.type ?? OPEN, "probe")], opts.childEdit === true),
  );
  writeJev(session.agentDir, jev, { enforce: opts.enforce, state: opts.state });
  await session.prompt("START-MAIN");
  await session.waitFor(() => workerLines(session).length >= 1, "worker line");
  const child = fixture.requests.find(isChild);
  return { jev, fixture, session, child };
}

describe("tool assessment through the real CLI", () => {
  test(
    "observe keeps tools and records counts",
    async () => {
      const { jev, fixture, session, child } = await runOne({});
      expect(child?.toolNames).toContain("edit");
      expect(child?.toolNames).toContain("ask_parent");
      const requests = toolRequests(jev);
      expect(requests.length).toBe(1);
      const keys = toolKeys(requests[0]!);
      expect(keys).toContain("tool::edit");
      expect(keys).not.toContain("tool::ask_parent");
      expect(keys).not.toContain("tool::notify_parent");
      expect(workerLines(session)[0]).toMatchObject({
        toolsScored: keys.length,
        toolsFlagged: 1,
      });
      expect(workerLines(session)[0]?.["toolsScored"]).toBe(7);
      expect(fixture.unmatched).toEqual([]);
    },
    TIMEOUT,
  );

  test(
    "enforce removes a flagged tool",
    async () => {
      const { fixture, child } = await runOne({ enforce: true, childEdit: true });
      expect(child?.toolNames).not.toContain("edit");
      expect(child?.toolNames).toContain("read");
      const second = fixture.requests.find(isChildAfterTool);
      expect(second).toBeDefined();
      expect(second?.toolNames).not.toContain("edit");
      const tool = messages(second!)
        .filter((m) => m.role === "tool")
        .at(-1);
      expect(JSON.stringify(tool?.content ?? "")).toMatch(/not found/i);
      expect(fixture.unmatched).toEqual([]);
    },
    TIMEOUT,
  );

  test(
    "Jev refused in enforce keeps every tool",
    async () => {
      // Reference: the same launch with the tools switch off (no assessment at all).
      const off = await runOne({ state: { version: 1, switches: { tools: false } } });
      expect(toolRequests(off.jev).length).toBe(0);
      const refused = await runOne({ jev: { status: 500 }, enforce: true });
      expect(toolRequests(refused.jev).length).toBe(1);
      expect(refused.child?.toolNames.length).toBeGreaterThan(0);
      expect([...(refused.child?.toolNames ?? [])].sort()).toEqual(
        [...(off.child?.toolNames ?? [])].sort(),
      );
    },
    TIMEOUT,
  );

  test(
    "Explore sends no tool request",
    async () => {
      const { jev } = await runOne({ type: "Explore" });
      expect(toolRequests(jev).length).toBe(0);
    },
    TIMEOUT,
  );

  test(
    "no prompt marker in the ledger",
    async () => {
      const { session, jev } = await runOne({ enforce: true });
      const dir = join(session.agentDir, "jev");
      const files = readdirSync(dir);
      expect(files).toContain("ledger.jsonl");
      expect(workerLines(session).length).toBeGreaterThanOrEqual(1);
      // Positive control: the marker did reach Jev in the tool request, so its absence below is meaningful.
      expect(toolRequests(jev).some((r) => r.body.includes(MARKER))).toBe(true);
      for (const f of files) {
        expect(readFileSync(join(dir, f), "utf8")).not.toContain(MARKER);
      }
    },
    TIMEOUT,
  );

  test(
    "record found at first before_agent_start",
    async () => {
      // A tool request reaching Jev proves listAgents() held the record by outputFile at that moment.
      const { jev } = await runOne({});
      expect(toolRequests(jev).length).toBe(1);
      expect(bodyOf(toolRequests(jev)[0]!).state?.agent?.name).toBe(OPEN);
    },
    TIMEOUT,
  );

  test(
    "concurrent workers name their own agent",
    async () => {
      const jev = await newJev();
      const { fixture, session } = await setup(
        script([
          launch(OPEN, "first probe", { run_in_background: true }),
          launch(OPEN2, "second probe", { run_in_background: true }),
        ]),
      );
      writeJev(session.agentDir, jev);
      await session.prompt("START-MAIN");
      await session.waitFor(() => workerLines(session).length >= 2, "two worker lines");
      const requests = toolRequests(jev);
      expect(requests.length).toBe(2);
      expect(requests.map((r) => bodyOf(r).state?.agent?.name).sort()).toEqual([OPEN, OPEN2]);
      expect(fixture.unmatched).toEqual([]);
      for (const line of workerLines(session)) {
        const own = requests.find((r) => bodyOf(r).state?.agent?.name === line["agent"]);
        expect(own).toBeDefined();
        expect(line).toMatchObject({ toolsFlagged: 1 });
        expect(line["toolsScored"]).toBe(toolKeys(own!).length);
      }
      expect(fixture.requests.filter(isChild).length).toBe(2);
    },
    TIMEOUT,
  );
});
