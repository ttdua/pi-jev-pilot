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

const MARKER = "JEV-MARKER-7f3a";
const MAIN_PROMPT = `START-MAIN ${MARKER}`;
const CHILD_PROMPT = "CHILD-TASK do the work";

function messages(r: RecordedRequest): { role?: string }[] {
  const m = r.body.messages;
  return Array.isArray(m) ? (m as { role?: string }[]) : [];
}
function lastMessage(r: RecordedRequest): { role?: string } | undefined {
  return messages(r).at(-1);
}
const isChild = (r: RecordedRequest): boolean => {
  const last = lastMessage(r);
  return last?.role === "user" && JSON.stringify(last).includes("CHILD-TASK");
};
const isMainFirst = (r: RecordedRequest): boolean =>
  r.model === "fixture-main" &&
  !isChild(r) &&
  !messages(r).some((m) => m.role === "tool") &&
  JSON.stringify(r.body.messages).includes("START-MAIN");

function script(args: Record<string, unknown>): ScriptEntry[] {
  return [
    { name: "child", match: isChild, reply: { text: "child done" } },
    {
      name: "main-call",
      match: isMainFirst,
      reply: {
        toolCalls: [
          {
            name: "subagent",
            arguments: {
              prompt: CHILD_PROMPT,
              description: "probe",
              model: "fixture/fixture-balanced",
              thinking: "low",
              ...args,
            },
          },
        ],
      },
      times: 1,
    },
    { name: "main-after", match: (r) => r.model === "fixture-main", reply: { text: "done" } },
  ];
}

async function run(
  args: Record<string, unknown>,
  prompt: string,
  agentName = "probe-worker",
  agentText = "---\ndescription: Probe worker\ntools: read, grep\n---\nYou are a probe worker.\n",
): Promise<{ fixture: Fixture; session: HostSession; child: RecordedRequest | undefined }> {
  const fixture = await startFixture(script({ subagent_type: agentName, ...args }));
  fixtures.push(fixture);
  const session = await startHostSession({
    fixture,
    probes: ["rewrite"],
    executor: true,
    agents: { [agentName]: agentText },
    env: { JEV_REWRITE_MODEL: "fixture/fixture-fast", JEV_REWRITE_THINKING: "high" },
    timeoutMs: 60_000,
  });
  sessions.push(session);
  await session.prompt(prompt);
  await session.waitFor(() => fixture.requests.some(isChild), "child request");
  return { fixture, session, child: fixture.requests.find(isChild) };
}

function observe(line: string): void {
  appendFileSync(join(import.meta.dir, ".observations.md"), `${line}\n`);
}

describe("WG-02 Q1/Q7 worker mutation", () => {
  test("Q1 foreground: child request uses the rewritten model and thinking", async () => {
    // WG-02 Q1: observed 2026-11-05, see docs/evidence/2026-11-05-host-seams.md#q1
    const EXPECTED = { childModel: "fixture-fast", childEffort: "high" } as const;
    const { fixture, session, child } = await run({}, "START-MAIN");
    observe(`Q1 fg: model=${child?.model} effort=${child?.reasoningEffort} (Q1 foreground)`);
    expect(
      session.probeRecords().some((r) => r.probe === "rewrite" && r.event === "tool_call"),
      "WG-02 Q1 rewrite probe saw tool_call",
    ).toBe(true);
    expect(child?.model, "WG-02 Q1 fg model").toBe(EXPECTED.childModel);
    expect(child?.reasoningEffort, "WG-02 Q1 fg effort").toBe(EXPECTED.childEffort);
    expect(fixture.unmatched, "WG-02 Q1 unmatched").toEqual([]);
  }, 120_000);

  test("Q1 background: same with run_in_background true", async () => {
    // WG-02 Q1: observed 2026-11-05, see docs/evidence/2026-11-05-host-seams.md#q1
    const EXPECTED = { childModel: "fixture-fast", childEffort: "high" } as const;
    const { fixture, child } = await run({ run_in_background: true }, "START-MAIN");
    observe(`Q1 bg: model=${child?.model} effort=${child?.reasoningEffort} (Q1 background)`);
    expect(child?.model, "WG-02 Q1 bg model").toBe(EXPECTED.childModel);
    expect(child?.reasoningEffort, "WG-02 Q1 bg effort").toBe(EXPECTED.childEffort);
    expect(fixture.unmatched, "WG-02 Q1 unmatched").toEqual([]);
  }, 120_000);

  test("Q1 locked: agent file locking model", async () => {
    // WG-02 Q1: observed 2026-11-05, see docs/evidence/2026-11-05-host-seams.md#q1
    // `locked: model` wins over the rewrite for the model; thinking is not locked and is still rewritten.
    const EXPECTED = { childModel: "fixture-main", childEffort: "high" } as const;
    const { fixture, child } = await run(
      {},
      "START-MAIN",
      "probe-worker-locked",
      "---\ndescription: Locked probe worker\ntools: read, grep\nmodel: fixture/fixture-main\nlocked: model\n---\nYou are a locked probe worker.\n",
    );
    observe(`Q1 locked: model=${child?.model} effort=${child?.reasoningEffort} (Q1 locked)`);
    expect(child?.model, "WG-02 Q1 locked model").toBe(EXPECTED.childModel);
    expect(child?.reasoningEffort, "WG-02 Q1 locked effort").toBe(EXPECTED.childEffort);
    expect(fixture.unmatched, "WG-02 Q1 unmatched").toEqual([]);
  }, 120_000);

  test("Q7 inherit_context with rewritten model", async () => {
    // WG-02 Q7: observed 2026-11-05, see docs/evidence/2026-11-05-host-seams.md#q7
    const EXPECTED = { childModel: "fixture-fast", markerInChild: true } as const;
    const { fixture, session, child } = await run({ inherit_context: true }, MAIN_PROMPT);
    const has = JSON.stringify(child?.body.messages).includes(MARKER);
    observe(`Q7: model=${child?.model} marker=${has} (Q7 inherit_context)`);
    expect(child?.model, "WG-02 Q7 model").toBe(EXPECTED.childModel);
    expect(has, "WG-02 Q7 marker in child").toBe(EXPECTED.markerInChild);
    expect(JSON.stringify(session.probeRecords()), "WG-02 Q7 marker not in probes").not.toContain(
      MARKER,
    );
    expect(fixture.unmatched, "WG-02 Q7 unmatched").toEqual([]);
  }, 120_000);
});
