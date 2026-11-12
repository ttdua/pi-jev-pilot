// Host evidence for spec `subagent-run-facts`, "Run facts make no outside calls": with only the
// executor installed and PI_OFFLINE=1, a run still records its tool facts, and the provider
// fixture sees only the run's own requests.
import { afterEach, expect, test } from "bun:test";
import { startFixture, type Fixture, type RecordedRequest, type ScriptEntry } from "./fixture";
import { startHostSession, type HostSession } from "./harness";

const fixtures: Fixture[] = [];
const sessions: HostSession[] = [];

afterEach(async () => {
  for (const s of sessions.splice(0)) await s.close();
  for (const f of fixtures.splice(0)) await f.stop();
});

const TIMEOUT = 90_000;
const AGENT = "facts-worker";
const AGENTS = {
  [AGENT]: "---\ndescription: Facts worker\ndisallowed_tools: bash\n---\nYou are a facts worker.\n",
};

type Msg = { role?: string; content?: unknown };
const messages = (r: RecordedRequest): Msg[] =>
  Array.isArray(r.body.messages) ? (r.body.messages as Msg[]) : [];
const lastIsUser = (r: RecordedRequest, text: string): boolean => {
  const last = messages(r).at(-1);
  return last?.role === "user" && JSON.stringify(last).includes(text);
};

const MAIN_REQUEST = "main-launch";
const CHILD_REQUEST = "child";
const script: ScriptEntry[] = [
  {
    name: MAIN_REQUEST,
    match: (r) => r.model === "fixture-main" && lastIsUser(r, "START-MAIN"),
    reply: {
      toolCalls: [
        {
          name: "subagent",
          arguments: {
            prompt: "CHILD-TASK answer plainly",
            description: "facts",
            subagent_type: AGENT,
            model: "fixture/fixture-balanced",
            thinking: "low",
          },
        },
      ],
    },
    times: 1,
  },
  { name: CHILD_REQUEST, match: (r) => lastIsUser(r, "CHILD-TASK"), reply: { text: "child done" } },
  { name: "main-after", match: (r) => r.model === "fixture-main", reply: { text: "done" } },
];

test(
  "Loopback launch: facts are recorded and only the run's own requests reach the provider",
  async () => {
    const fixture = await startFixture(script);
    fixtures.push(fixture);
    const s = await startHostSession({
      fixture,
      install: "executor-only",
      probes: ["policy"],
      agents: AGENTS,
      env: { TYPESAFE_API_KEY: "test-key", PI_OFFLINE: "1" },
      timeoutMs: 60_000,
    });
    sessions.push(s);
    await s.prompt("START-MAIN");
    const facts = () =>
      s.probeRecords().filter((r) => r.probe === "policy" && r.event === "record:facts");
    await s.waitFor(() => facts().length === 1, "record:facts");
    const data = facts()[0]?.data;
    expect(data?.["toolCount"]).toBeGreaterThan(0);
    // blockedToolCount is the parent's tools plus the child's own, minus the child's active tools.
    // The probe does not expose the total, so assert the floor it implies: `bash` (disallowed_tools)
    // and the recursion guard tools `subagent`, `get_subagent_result`, `steer_subagent` (the parent
    // has them, the child lacks them), i.e. at least 4.
    expect(data?.["blockedToolCount"]).toBeGreaterThanOrEqual(4);
    // Nothing but the main session's and the child's scripted requests reached the provider.
    expect(fixture.unmatched).toEqual([]);
    expect(fixture.requests.length).toBeGreaterThan(0);
  },
  TIMEOUT,
);
