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
const isChildAfterTool = (r: RecordedRequest): boolean =>
  messages(r).some((m) => m.role === "tool") &&
  JSON.stringify(r.body.messages).includes("CHILD-TASK");
const isMainFirst = (r: RecordedRequest): boolean =>
  r.model === "fixture-main" &&
  !isChild(r) &&
  !messages(r).some((m) => m.role === "tool") &&
  JSON.stringify(r.body.messages).includes("START-MAIN");

function script(callRead: boolean): ScriptEntry[] {
  const child: ScriptEntry[] = callRead
    ? [
        { name: "child-after-tool", match: isChildAfterTool, reply: { text: "child done" } },
        {
          name: "child-read",
          match: isChild,
          reply: { toolCalls: [{ name: "read", arguments: { path: "README.md" } }] },
          times: 1,
        },
      ]
    : [{ name: "child", match: isChild, reply: { text: "child done" } }];
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

async function run(callRead: boolean, removeTool: string | undefined) {
  const fixture = await startFixture(script(callRead));
  fixtures.push(fixture);
  const session = await startHostSession({
    fixture,
    probes: ["child"],
    install: "executor-only",
    agents: {
      "probe-worker":
        "---\ndescription: Probe worker\ntools: read, grep\n---\nYou are a probe worker.\n",
    },
    env: removeTool ? { JEV_REMOVE_TOOL: removeTool } : {},
    timeoutMs: 60_000,
  });
  sessions.push(session);
  await session.prompt("START-MAIN");
  await session.waitFor(
    () => fixture.requests.some(callRead ? isChildAfterTool : isChild),
    "child request",
  );
  return { fixture, session };
}

function observe(line: string): void {
  appendFileSync(join(import.meta.dir, ".observations.md"), `${line}\n`);
}

describe("WG-02 Q3/Q4 child tools and detection", () => {
  test("Q3 removed tool absent from child request", async () => {
    // WG-02 Q3: observed 2026-11-05, see docs/evidence/2026-11-05-host-seams.md#q3
    const EXPECTED = { removedRecorded: true, childHasRead: false, childHasGrep: true } as const;
    const { fixture, session } = await run(false, "read");
    const child = fixture.requests.find(isChild);
    const removed = session.probeRecords().some((r) => r.event === "tools:removed");
    observe(
      `Q3 absent: removed=${removed} read=${child?.toolNames.includes("read")} grep=${child?.toolNames.includes("grep")} tools=${child?.toolNames.join(",")}`,
    );
    expect(removed, "WG-02 Q3 tools:removed recorded").toBe(EXPECTED.removedRecorded);
    expect(child?.toolNames.includes("read"), "WG-02 Q3 child has read").toBe(
      EXPECTED.childHasRead,
    );
    expect(child?.toolNames.includes("grep"), "WG-02 Q3 child has grep").toBe(
      EXPECTED.childHasGrep,
    );
    expect(fixture.unmatched, "WG-02 Q3 unmatched").toEqual([]);
  }, 120_000);

  test("Q3 call to removed tool", async () => {
    // WG-02 Q3: observed 2026-11-05, see docs/evidence/2026-11-05-host-seams.md#q3
    const EXPECTED = { secondChildRequest: true, toolResultIsError: true } as const;
    const { fixture } = await run(true, "read");
    const second = fixture.requests.find(isChildAfterTool);
    const toolMsg = second
      ? messages(second)
          .filter((m) => m.role === "tool")
          .at(-1)
      : undefined;
    const text = JSON.stringify(toolMsg?.content ?? "");
    const isError = /not found/i.test(text);
    observe(`Q3 call: second=${second !== undefined} error=${isError} len=${text.length}`);
    expect(second !== undefined, "WG-02 Q3 second child request").toBe(EXPECTED.secondChildRequest);
    expect(isError, "WG-02 Q3 tool result is error").toBe(EXPECTED.toolResultIsError);
    expect(fixture.unmatched, "WG-02 Q3 unmatched").toEqual([]);
  }, 120_000);

  test("Q4 session-created precedes child handlers with matching id", async () => {
    // WG-02 Q4: observed 2026-11-05, see docs/evidence/2026-11-05-host-seams.md#q4
    const EXPECTED = { sameId: true, createdFirst: true } as const;
    const { fixture, session } = await run(false, undefined);
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
