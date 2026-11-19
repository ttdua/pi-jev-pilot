// Host evidence for service launch escalation (spec `host-seam-evidence`, "Service launch
// escalation"): where a child's `notify_parent` and `ask_parent` land with and without
// `SubagentsService.wait()`, through a real Pi RPC session and the recording fixture.
import { afterEach, describe, expect, test } from "bun:test";
import { startFixture, type Fixture, type RecordedRequest, type ScriptEntry } from "./fixture";
import { startHostSession, type HostSession } from "./harness";
import { command } from "./rpc-helpers";

const fixtures: Fixture[] = [];
const sessions: HostSession[] = [];

afterEach(async () => {
  for (const s of sessions.splice(0)) await s.close();
  for (const f of fixtures.splice(0)) await f.stop();
});

const TIMEOUT = 90_000;
const WORKER = "esc-worker";
const AGENTS = {
  [WORKER]: "---\ndescription: Escalation worker\n---\nYou are an escalation worker.\n",
};

type Msg = { role?: string };
const messages = (r: RecordedRequest): Msg[] =>
  Array.isArray(r.body.messages) ? (r.body.messages as Msg[]) : [];
const toolCount = (r: RecordedRequest): number => messages(r).filter((m) => m.role === "tool").length;
const isChild = (r: RecordedRequest): boolean => JSON.stringify(messages(r)).includes("CHILD-TASK");
const hasAnswer = (r: RecordedRequest): boolean => JSON.stringify(messages(r)).includes("ANSWER-TEXT");

const reply = (name: string, match: (r: RecordedRequest) => boolean, text: string): ScriptEntry => ({
  name,
  match,
  reply: { text },
});

const SCRIPT: ScriptEntry[] = [
  reply("child-final", (r) => isChild(r) && hasAnswer(r), "final"),
  {
    name: "child-notify",
    match: (r) => isChild(r) && toolCount(r) === 0,
    reply: { toolCalls: [{ name: "notify_parent", arguments: { message: "progress" } }] },
  },
  {
    name: "child-ask",
    match: (r) => isChild(r) && toolCount(r) === 1,
    reply: { toolCalls: [{ name: "ask_parent", arguments: { question: "which one?" } }] },
  },
  reply("child-asked", (r) => isChild(r) && toolCount(r) === 2, "asked"),
  reply("main-after", (r) => r.model === "fixture-main", "done"),
];

const probe = (s: HostSession, event: string) =>
  s.probeRecords().filter((r) => r.probe === "escalation" && r.event === event);
const events = (s: HostSession, ch: string) => probe(s, "event").filter((r) => r.data?.["ch"] === ch);
const mainMessages = (s: HostSession, customType: string) =>
  probe(s, "main:message").filter((r) => r.data?.["customType"] === customType);

async function start(): Promise<HostSession> {
  const fixture = await startFixture(SCRIPT);
  fixtures.push(fixture);
  const s = await startHostSession({
    fixture,
    install: "executor-only",
    probes: ["escalation"],
    agents: AGENTS,
    env: { TYPESAFE_API_KEY: "test-key" },
    timeoutMs: 60_000,
  });
  sessions.push(s);
  return s;
}

/** Spawns the escalating child and waits until its run has ended and been observed. */
async function run(mode: "fg" | "bg", waiting: "wait" | "nowait") {
  const s = await start();
  await command(s, `/esc-spawn ${WORKER} ${mode} ${waiting}`);
  await s.waitFor(() => events(s, "subagents:completed").length === 1, "completed event");
  await s.waitFor(() => probe(s, "snapshot").length === 1, "snapshot");
  if (waiting === "wait") await s.waitFor(() => probe(s, "wait:resolved").length === 1, "wait");
  // Let any nudge reach the main session before counting.
  await Bun.sleep(1500);
  return s;
}

const ESCALATED = { status: "completed", hasQuestion: true, hasRefusal: false };

function expectChildEvents(s: HostSession): void {
  expect(events(s, "subagents:update")).toHaveLength(1);
  expect(events(s, "subagents:asked")).toHaveLength(1);
  expect(events(s, "subagents:update")[0]?.data?.["meta"]).toBe(true);
  expect(events(s, "subagents:asked")[0]?.data?.["meta"]).toBe(true);
}

describe("service launch escalation", () => {
  test.each([
    ["background", "bg"],
    ["foreground", "fg"],
  ] as const)(
    "unwaited launch escalates to the main session: %s",
    async (_kind, mode) => {
      const s = await run(mode, "nowait");
      expectChildEvents(s);
      expect(mainMessages(s, "subagent-update")).toHaveLength(1);
      expect(mainMessages(s, "subagent-notification")).toHaveLength(1);
      expect(probe(s, "snapshot")[0]?.data).toMatchObject(ESCALATED);
    },
    TIMEOUT,
  );

  test.each([
    ["background", "bg"],
    ["foreground", "fg"],
  ] as const)(
    "waited launch escalates to the caller only: %s",
    async (_kind, mode) => {
      const s = await run(mode, "wait");
      expectChildEvents(s);
      expect(mainMessages(s, "subagent-update")).toHaveLength(0);
      expect(mainMessages(s, "subagent-notification")).toHaveLength(0);
      expect(probe(s, "wait:resolved")[0]?.data).toMatchObject(ESCALATED);
      expect(probe(s, "wait:rejected")).toHaveLength(0);
    },
    TIMEOUT,
  );

  test(
    "caller answers",
    async () => {
      const s = await run("bg", "wait");
      const id = String(probe(s, "spawn")[0]?.data?.["id"]);
      await command(s, `/esc-resume ${id}`);
      await s.waitFor(() => probe(s, "wait2:resolved").length === 1, "wait2");
      expect(probe(s, "wait2:resolved")[0]?.data).toMatchObject({
        status: "completed",
        resultIsFinal: true,
      });
      const fixture = fixtures[0] as Fixture;
      expect(fixture.requests.some((r) => isChild(r) && hasAnswer(r))).toBe(true);
      await Bun.sleep(1500);
      expect(mainMessages(s, "subagent-notification")).toHaveLength(0);
    },
    TIMEOUT,
  );
});
