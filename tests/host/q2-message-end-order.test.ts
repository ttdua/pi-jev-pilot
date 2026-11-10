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

function messages(r: RecordedRequest): { role?: string }[] {
  const m = r.body.messages;
  return Array.isArray(m) ? (m as { role?: string }[]) : [];
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

const call = (description: string) => ({
  name: "subagent",
  arguments: {
    prompt: `CHILD-TASK ${description}`,
    description,
    subagent_type: "probe-worker",
    model: "fixture/fixture-fast",
  },
});

const script: ScriptEntry[] = [
  { name: "child", match: isChild, reply: { text: "child done" }, times: 10 },
  {
    name: "main-call",
    match: isMainFirst,
    reply: { toolCalls: [call("probe one"), call("probe two")] },
    times: 1,
  },
  { name: "main-after", match: (r) => r.model === "fixture-main", reply: { text: "done" } },
];

describe("WG-02 Q2 message_end ordering", () => {
  test("Q2: message_end completes before sibling tool_call preflight", async () => {
    // WG-02 Q2: observed 2026-11-05, see docs/evidence/2026-11-05-host-seams.md#q2
    const EXPECTED = {
      order: ["message_end:start", "message_end:end", "tool_call:start", "tool_call:start"],
    } as const;
    const fixture = await startFixture(script);
    fixtures.push(fixture);
    const session = await startHostSession({
      fixture,
      probes: ["ordering"],
      install: "executor-only",
      agents: {
        "probe-worker":
          "---\ndescription: Probe worker\ntools: read, grep\n---\nYou are a probe worker.\n",
      },
      timeoutMs: 60_000,
    });
    sessions.push(session);
    await session.prompt("START-MAIN");
    const main = (): ReturnType<HostSession["probeRecords"]> => {
      const all = session.probeRecords().filter((r) => r.probe === "ordering");
      const first = all.find((r) => r.event === "message_end:start");
      return all.filter((r) => r.sessionId === first?.sessionId);
    };
    await session.waitFor(
      () =>
        main().filter((r) => r.event === "tool_call:start").length >= 2 &&
        main().some((r) => r.event === "message_end:end"),
      "two tool_call:start records and message_end:end",
    );
    const records = main().sort((a, b) => a.seq - b.seq);
    const order = records.map((r) => r.event);
    appendFileSync(
      join(import.meta.dir, ".observations.md"),
      `Q2: order=${order.join(",")} seq=${records.map((r) => r.seq).join(",")} (Q2 message_end order)\n`,
    );
    expect(order, "WG-02 Q2 order").toEqual([...EXPECTED.order]);
    expect(fixture.unmatched, "WG-02 Q2 unmatched").toEqual([]);
  }, 120_000);
});
