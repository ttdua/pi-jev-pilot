import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../helpers";
import { startFixture, type Fixture, type RecordedRequest, type ScriptEntry } from "./fixture";
import { startHostSession, type HostSession } from "./harness";

const fixtures: Fixture[] = [];
const sessions: HostSession[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const s of sessions.splice(0)) await s.close();
  for (const f of fixtures.splice(0)) await f.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const MARKER = "JEV-MARKER-5c1e";
// Synthetic filler so the session is large enough for compaction to find a cut point.
// The size is tuned to the host compaction threshold (keep-window); if the compact
// assertion fails with "Nothing to compact", that threshold has likely changed.
const FILLER = "filler ".repeat(30_000);

const hasMarker = (r: RecordedRequest | undefined): boolean =>
  JSON.stringify(r?.body.messages ?? null).includes(MARKER);

function observe(line: string): void {
  appendFileSync(join(import.meta.dir, ".observations.md"), `${line}\n`);
}

function flagFile(): string {
  const dir = tempDir("jev-flag-");
  dirs.push(dir);
  const flag = join(dir, "hidden.flag");
  writeFileSync(flag, "");
  return flag;
}

const textScript = (extra: ScriptEntry[] = []): ScriptEntry[] => [
  ...extra,
  { name: "fixture-main", match: (r) => r.model === "fixture-main", reply: { text: "ok" } },
];

// Summarization request: no tools in the body, or a system prompt mentioning "summar".
const summarizationClauses = (r: RecordedRequest): { noTools: boolean; summarText: boolean } => {
  const msgs = Array.isArray(r.body.messages) ? (r.body.messages as { role?: string }[]) : [];
  const system = msgs.find((m) => m.role === "system" || m.role === "developer");
  return {
    noTools: r.toolNames.length === 0,
    summarText: /summar/i.test(JSON.stringify(system ?? "")),
  };
};
const isSummarization = (r: RecordedRequest): boolean => {
  const c = summarizationClauses(r);
  return c.noTools || c.summarText;
};

async function start(
  fixture: Fixture,
  env: Record<string, string>,
  opts: { persist?: boolean; thinking?: string } = {},
): Promise<HostSession> {
  fixtures.push(fixture);
  const session = await startHostSession({
    fixture,
    probes: ["main"],
    executor: false,
    env,
    timeoutMs: 90_000,
    ...opts,
  });
  sessions.push(session);
  return session;
}

describe("WG-02 Q5/Q6 main session", () => {
  test("Q5 hidden message reaches the provider", async () => {
    // WG-02 Q5: observed 2026-11-05, see docs/evidence/2026-11-05-host-seams.md#q5
    const EXPECTED = { markerInFirstRequest: true } as const;
    const flag = flagFile();
    const fixture = await startFixture(textScript());
    const session = await start(fixture, { JEV_HIDDEN_FLAG: flag });
    await session.prompt("hello");
    const first = fixture.requests[0];
    const has = hasMarker(first);
    observe(`Q5 first request: marker=${has} (Q5 hidden message reaches the provider)`);
    expect(has, "WG-02 Q5 marker in first request").toBe(EXPECTED.markerInFirstRequest);
    const records = session.probeRecords();
    expect(
      records.some((r) => r.probe === "main" && r.event === "hidden:sent"),
      "WG-02 Q5 probe sent hidden",
    ).toBe(true);
    expect(JSON.stringify(records), "WG-02 Q5 marker not in probes").not.toContain(MARKER);
    expect(fixture.unmatched, "WG-02 Q5 unmatched").toEqual([]);
  }, 120_000);

  test("Q5 after compaction", async () => {
    // WG-02 Q5: observed 2026-11-05, see docs/evidence/2026-11-05-host-seams.md#q5
    // markerInHistoryBeforeCompaction: prompt 2's request (flag removed, no compaction yet)
    // still carries the marker, i.e. the hidden message is retained in history.
    // markerAfterCompaction: prompt 3's request (after compact) carries the marker.
    const EXPECTED = {
      markerInHistoryBeforeCompaction: true,
      markerAfterCompaction: false,
    } as const;
    const flag = flagFile();
    const fixture = await startFixture(
      textScript([
        {
          name: "summarization",
          match: isSummarization,
          reply: { text: "Summary of the conversation." },
          times: 1,
        },
      ]),
    );
    const session = await start(fixture, { JEV_HIDDEN_FLAG: flag }, { persist: true });
    await session.prompt(`first turn ${FILLER}`);
    rmSync(flag, { force: true });
    const secondIndex = fixture.requests.length;
    await session.prompt(`second turn ${FILLER}`);
    const inHistory = hasMarker(fixture.requests[secondIndex]);
    const response = await session.send({ type: "compact" });
    const compactMatched = fixture.requests.filter((r) => r.matched === "summarization");
    observe(
      `Q5 compact: success=${response.success} error=${String(response.error)} summarizationRequests=${compactMatched.length} toolCount=${compactMatched[0]?.toolNames.length} noToolsClause=${compactMatched[0] ? summarizationClauses(compactMatched[0]).noTools : "n/a"} summarTextClause=${compactMatched[0] ? summarizationClauses(compactMatched[0]).summarText : "n/a"}`,
    );
    expect(response.success, "WG-02 Q5 compact succeeded").toBe(true);
    expect(compactMatched.length, "WG-02 Q5 summarization matched once").toBe(1);
    const countBefore = fixture.requests.length;
    await session.prompt("third turn");
    const third = fixture.requests[countBefore];
    const after = hasMarker(third);
    observe(
      `Q5 after compaction: markerInHistoryBeforeCompaction=${inHistory} markerAfterCompaction=${after} (Q5 after compaction)`,
    );
    expect(inHistory, "WG-02 Q5 marker in history before compaction").toBe(
      EXPECTED.markerInHistoryBeforeCompaction,
    );
    expect(after, "WG-02 Q5 marker after compaction").toBe(EXPECTED.markerAfterCompaction);
    expect(JSON.stringify(session.probeRecords()), "WG-02 Q5 marker not in probes").not.toContain(
      MARKER,
    );
    expect(fixture.unmatched, "WG-02 Q5 unmatched").toEqual([]);
  }, 180_000);

  test("Q6 setThinkingLevel applies to the same turn", async () => {
    // WG-02 Q6: observed 2026-11-05, see docs/evidence/2026-11-05-host-seams.md#q6
    const EXPECTED = { firstRequestEffort: "high" } as const;
    const fixture = await startFixture(textScript());
    const session = await start(fixture, { JEV_SET_THINKING: "high" }, { thinking: "low" });
    await session.prompt("hello");
    const effort = fixture.requests[0]?.reasoningEffort;
    observe(`Q6 first request effort=${effort} (Q6 setThinkingLevel same turn)`);
    expect(
      session.probeRecords().some((r) => r.probe === "main" && r.event === "thinking:set"),
      "WG-02 Q6 probe set thinking",
    ).toBe(true);
    expect(effort, "WG-02 Q6 first request effort").toBe(EXPECTED.firstRequestEffort);
    expect(fixture.unmatched, "WG-02 Q6 unmatched").toEqual([]);
  }, 120_000);
});
