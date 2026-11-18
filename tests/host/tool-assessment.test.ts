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
const isToolKey = (k: string): boolean => k.startsWith("tool::") || k.startsWith("grant::");
const toolRequests = (j: JevFixture): JevFixture["requests"] =>
  j.requests.filter((r) => Object.keys(bodyOf(r).questions ?? {}).some(isToolKey));
/** Every scored candidate: `tool::` (block) and `grant::` keys. */
const toolKeys = (r: JevFixture["requests"][number]): string[] =>
  Object.keys(bodyOf(r).questions ?? {}).filter(isToolKey);
const blockKeys = (r: JevFixture["requests"][number]): string[] =>
  toolKeys(r).filter((k) => k.startsWith("tool::"));

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
      expect(blockKeys(requests[0]!)).toHaveLength(7);
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
    "Explore declares its tools: no block question",
    async () => {
      const { jev } = await runOne({ type: "Explore" });
      for (const r of toolRequests(jev)) expect(blockKeys(r)).toEqual([]);
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
    "the policy call names the launch's agent",
    async () => {
      // The launch policy receives the agent snapshot; no record lookup is needed.
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

// ---- Fork workers ----

const READER = "probe-reader";
const PROBE_TOOL = "probe_tool";
const FORK_AGENTS = {
  ...AGENTS,
  [READER]:
    "---\ndescription: Read-only probe\ntools: read, grep\n---\nYou are a read-only probe.\n",
};
const REFUSED = (tool: string): string => `Tool "${tool}" is not available to this subagent.`;

/** Flags `edit` and grants `probe_tool`; every other candidate scores low. */
function forkRoute(): FixtureRoute {
  return {
    each: (body) => {
      const answers: Record<string, object> = {
        effort: choice("medium", ["low", "medium", "high", "xhigh", "max"]),
        risky: { type: "noul", noul: 0.2 },
        tier: choice("balanced", ["fast", "balanced"]),
      };
      for (const key of Object.keys((JSON.parse(body) as ToolBody).questions ?? {})) {
        if (key.startsWith("tool::") || key.startsWith("grant::")) {
          const hit = key === "tool::edit" || key === `grant::${PROBE_TOOL}`;
          answers[key] = { type: "noul", noul: hit ? 0.9 : 0.1 };
        }
      }
      return { json: { answers } };
    },
  };
}

const isFork = (r: RecordedRequest): boolean =>
  JSON.stringify(r.body.messages).includes("<subagent_instructions>");
const lastTool = (r: RecordedRequest): string =>
  String(
    messages(r)
      .filter((m) => m.role === "tool")
      .at(-1)?.content ?? "",
  );

/** The fork calls each of `calls` in turn, one per request, then answers in text. */
function forkChild(calls: Call[]): ScriptEntry[] {
  const steps = calls.map((call, i): ScriptEntry => ({
    name: `fork-call-${i}`,
    match: (r) =>
      isFork(r) && messages(r).filter((m) => m.role === "tool").length === i + countPending(r),
    reply: { toolCalls: [call] },
    times: 1,
  }));
  return [...steps, { name: "fork-done", match: isFork, reply: { text: "fork done" } }];
}
/** Tool results already in a fork's first request: the parent's real ones plus synthetic ones. */
const countPending = (r: RecordedRequest): number => {
  const first = r.body.messages as Msg[];
  const marker = first.findIndex((m) => JSON.stringify(m).includes("<subagent_instructions>"));
  return first.slice(0, marker).filter((m) => m.role === "tool").length;
};

async function forkSession(opts: {
  enforce: boolean;
  type: string;
  calls: Call[];
  extra?: ScriptEntry[];
}) {
  const jev = await newJev(forkRoute());
  const entries: ScriptEntry[] = [
    ...(opts.extra ?? []),
    ...forkChild(opts.calls),
    { name: "child", match: isChild, reply: { text: "child done" } },
    {
      name: "main-call",
      match: isMainFirst,
      reply: { toolCalls: [launch(opts.type, "fork probe", { context: "fork" })] },
      times: 1,
    },
    { name: "main-after", match: (r) => r.model === "fixture-main", reply: { text: "done" } },
  ];
  const fixture = await startFixture(entries);
  fixtures.push(fixture);
  const session = await startHostSession({
    fixture,
    self: true,
    probes: ["policy"],
    agents: FORK_AGENTS,
    env: { TYPESAFE_API_KEY: "test-key" },
    timeoutMs: 60_000,
  });
  sessions.push(session);
  writeJev(session.agentDir, jev, { enforce: opts.enforce });
  return { jev, fixture, session };
}

const forkRequests = (f: Fixture): RecordedRequest[] => f.requests.filter(isFork);
const executed = (s: HostSession): number =>
  s.probeRecords().filter((r) => r.probe === "policy" && r.event === "tool:executed").length;

describe("tool assessment in a fork", () => {
  test(
    "Observe in a fork",
    async () => {
      const edit = {
        name: "edit",
        arguments: { path: "x.txt", edits: [{ oldText: "a", newText: "b" }] },
      };
      const probe = { name: PROBE_TOOL, arguments: {} };
      const { jev, fixture, session } = await forkSession({
        enforce: false,
        type: READER,
        calls: [edit, probe],
      });
      await session.prompt("START-MAIN");
      await session.waitFor(() => workerLines(session).length >= 1, "worker line");
      expect(toolRequests(jev)).toHaveLength(1);
      const requests = forkRequests(fixture);
      expect(requests[0]?.toolNames).toContain("edit");
      expect(requests[0]?.toolNames).toContain(PROBE_TOOL);
      expect(lastTool(requests[1] as RecordedRequest)).toContain(REFUSED("edit"));
      expect(lastTool(requests[2] as RecordedRequest)).toContain(REFUSED(PROBE_TOOL));
      expect(executed(session)).toBe(0);
    },
    TIMEOUT,
  );

  test(
    "Enforce in a fork",
    async () => {
      const edit = {
        name: "edit",
        arguments: { path: "x.txt", edits: [{ oldText: "a", newText: "b" }] },
      };
      const { jev, fixture, session } = await forkSession({
        enforce: true,
        type: OPEN,
        calls: [edit],
      });
      await session.prompt("START-MAIN");
      await session.waitFor(() => workerLines(session).length >= 1, "worker line");
      expect(toolRequests(jev)).toHaveLength(1);
      const requests = forkRequests(fixture);
      for (const r of requests) expect(r.toolNames).toContain("edit");
      expect(lastTool(requests[1] as RecordedRequest)).toContain(REFUSED("edit"));
      expect(workerLines(session)[0]).toMatchObject({ toolsFlagged: 1 });
    },
    TIMEOUT,
  );

  test(
    "Resumed fork keeps refusals",
    async () => {
      const edit = {
        name: "edit",
        arguments: { path: "x.txt", edits: [{ oldText: "a", newText: "b" }] },
      };
      const resume: ScriptEntry = {
        name: "main-resume",
        match: (r) => r.model === "fixture-main" && !isFork(r) && hasTool(r),
        reply: (r) => {
          const id = /Agent ID: (\S+)/.exec(lastTool(r))?.[1] ?? "missing";
          return {
            toolCalls: [
              {
                name: "subagent",
                arguments: {
                  prompt: "RESUME-TASK again",
                  description: "resume",
                  subagent_type: OPEN,
                  resume: id,
                },
              },
            ],
          };
        },
        times: 1,
      };
      const resumedEdit: ScriptEntry = {
        name: "resumed-edit",
        match: (r) => isFork(r) && JSON.stringify(messages(r).at(-1)).includes("RESUME-TASK"),
        reply: { toolCalls: [edit] },
        times: 1,
      };
      const { jev, fixture, session } = await forkSession({
        enforce: true,
        type: OPEN,
        calls: [],
        extra: [
          resumedEdit,
          {
            name: "resumed-done",
            match: (r) =>
              isFork(r) &&
              lastTool(r).includes(REFUSED("edit")) &&
              JSON.stringify(r.body.messages).includes("RESUME-TASK"),
            reply: { text: "resumed done" },
          },
          resume,
        ],
      });
      await session.prompt("START-MAIN");
      await session.waitFor(
        () => fixture.requests.some((r) => r.matched === "resumed-done"),
        "resumed fork finished",
      );
      expect(toolRequests(jev)).toHaveLength(1);
      const resumed = fixture.requests.filter(
        (r) => isFork(r) && JSON.stringify(r.body.messages).includes("RESUME-TASK"),
      );
      expect(resumed.length).toBeGreaterThanOrEqual(2);
      for (const r of resumed) expect(r.toolNames).toContain("edit");
      expect(lastTool(resumed.at(-1) as RecordedRequest)).toContain(REFUSED("edit"));
    },
    TIMEOUT,
  );
});
