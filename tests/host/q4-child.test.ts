import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { startFixture, type Fixture, type RecordedRequest, type ScriptEntry } from "./fixture";
import { startHostSession, type HostSession } from "./harness";

const fixtures: Fixture[] = [];
const sessions: HostSession[] = [];

afterEach(async () => {
  for (const s of sessions.splice(0)) await s.close();
  for (const f of fixtures.splice(0)) await f.stop();
});

type Msg = { role?: string; content?: unknown };

function messages(r: RecordedRequest): Msg[] {
  const m = r.body.messages;
  return Array.isArray(m) ? (m as Msg[]) : [];
}
const isChild = (r: RecordedRequest): boolean => {
  const last = messages(r).at(-1);
  return last?.role === "user" && JSON.stringify(last).includes("CHILD-TASK");
};
const isMainFirst = (r: RecordedRequest): boolean =>
  r.model === "fixture-main" &&
  !isChild(r) &&
  !messages(r).some((m) => m.role === "tool") &&
  JSON.stringify(r.body.messages).includes("START-MAIN");

function script(): ScriptEntry[] {
  const child: ScriptEntry[] = [{ name: "child", match: isChild, reply: { text: "child done" } }];
  return [
    ...child,
    {
      name: "main-call",
      match: isMainFirst,
      reply: {
        toolCalls: [
          {
            name: "subagent",
            arguments: {
              prompt: "CHILD-TASK do the work",
              description: "probe",
              subagent_type: "probe-worker",
            },
          },
        ],
      },
      times: 1,
    },
    { name: "main-after", match: (r) => r.model === "fixture-main", reply: { text: "done" } },
  ];
}

async function run() {
  const fixture = await startFixture(script());
  fixtures.push(fixture);
  const session = await startHostSession({
    fixture,
    probes: ["child"],
    agents: {
      "probe-worker":
        "---\ndescription: Probe worker\ntools: read, grep\n---\nYou are a probe worker.\n",
    },
    timeoutMs: 60_000,
  });
  sessions.push(session);
  await session.prompt("START-MAIN");
  await session.waitFor(() => fixture.requests.some(isChild), "child request");
  return { fixture, session };
}

function observe(line: string): void {
  appendFileSync(join(import.meta.dir, ".observations.md"), `${line}\n`);
}

describe("WG-02 Q4 child detection", () => {
  test("Q4 session-created precedes child handlers with matching id", async () => {
    // WG-02 Q4: observed 2026-11-05, see docs/evidence/2026-11-05-host-seams.md#q4
    const EXPECTED = { sameId: true, createdFirst: true } as const;
    const { fixture, session } = await run();
    const records = session.probeRecords();
    const created = records.find((r) => r.event === "child:session-created");
    const start = records.find(
      (r) => r.event === "session_start" && r.sessionId === created?.sessionId,
    );
    observe(
      `Q4: created=${created?.seq} start=${start?.seq} sameId=${start !== undefined} total_starts=${records.filter((r) => r.event === "session_start").length}`,
    );
    expect(created, "WG-02 Q4 created record").toBeDefined();
    expect(start !== undefined, "WG-02 Q4 child session_start with same id").toBe(EXPECTED.sameId);
    expect((created?.seq ?? Infinity) < (start?.seq ?? -1), "WG-02 Q4 created first").toBe(
      EXPECTED.createdFirst,
    );
    expect(fixture.unmatched, "WG-02 Q4 unmatched").toEqual([]);
  }, 120_000);
});
