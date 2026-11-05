import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { startFixture, type Fixture, type ScriptEntry } from "./fixture";
import { startHostSession, type HostSession } from "./harness";

const fixtures: Fixture[] = [];
const sessions: HostSession[] = [];

afterEach(async () => {
  for (const s of sessions.splice(0)) await s.close();
  for (const f of fixtures.splice(0)) await f.stop();
});

async function fixtureWith(script: ScriptEntry[]): Promise<Fixture> {
  const f = await startFixture(script);
  fixtures.push(f);
  return f;
}

async function sessionWith(
  fixture: Fixture,
  opts: Omit<Parameters<typeof startHostSession>[0], "fixture"> = {},
): Promise<HostSession> {
  const s = await startHostSession({ fixture, ...opts });
  sessions.push(s);
  return s;
}

function piRpcPids(): Set<string> {
  const out = Bun.spawnSync(["pgrep", "-f", "mode rpc"]).stdout.toString();
  return new Set(out.split("\n").filter(Boolean));
}

describe("host session harness", () => {
  test("prompt settles against the fixture", async () => {
    const fixture = await fixtureWith([
      { name: "main", match: (r) => r.model === "fixture-main", reply: { text: "ok" } },
    ]);
    const s = await sessionWith(fixture, { thinking: "medium" });
    await s.prompt("hi");
    expect(fixture.requests.length).toBe(1);
    expect(fixture.requests[0]?.model).toBe("fixture-main");
    expect(fixture.requests[0]?.reasoningEffort).toBe("medium");
    expect(fixture.unmatched).toEqual([]);
  }, 60_000);

  test("agent dir is fresh and removed", async () => {
    const fixture = await fixtureWith([]);
    const s = await sessionWith(fixture);
    expect(existsSync(s.agentDir)).toBe(true);
    expect(s.agentDir).not.toBe(join(homedir(), ".pi", "agent"));
    await s.close();
    expect(existsSync(s.agentDir)).toBe(false);
    expect(existsSync(s.cwd)).toBe(false);
  }, 60_000);

  test("installs executor offline", async () => {
    const fixture = await fixtureWith([
      { name: "main", match: (r) => r.model === "fixture-main", reply: { text: "ok" } },
    ]);
    const s = await sessionWith(fixture, { executor: true });
    expect(s.installPath).toBe("node_modules");
    await s.prompt("hi");
    expect(fixture.requests[0]?.toolNames).toContain("subagent");
  }, 60_000);

  test("probe records are readable", async () => {
    const fixture = await fixtureWith([]);
    const s = await sessionWith(fixture, { probes: ["noop"] });
    await s.waitFor(
      () => s.probeRecords().some((r) => r.probe === "noop" && r.event === "session_start"),
      "noop session_start",
    );
    expect(s.probeRecords()).toContainEqual(
      expect.objectContaining({ probe: "noop", event: "session_start" }),
    );
    const report = readFileSync(join(s.agentDir, "probe-report.jsonl"), "utf8");
    expect(report).not.toContain("JEV-MARKER-");
  }, 60_000);

  test("subagent call launches a child", async () => {
    const fixture = await fixtureWith([
      {
        name: "main-call",
        match: (r) => r.model === "fixture-main" && r.toolNames.includes("subagent"),
        reply: {
          toolCalls: [
            {
              name: "subagent",
              arguments: {
                subagent_type: "probe-worker",
                model: "fixture/fixture-fast",
                thinking: "high",
                prompt: "go",
                description: "probe",
              },
            },
          ],
        },
        times: 1,
      },
      { name: "child", match: (r) => r.model === "fixture-fast", reply: { text: "child done" } },
      { name: "main-after", match: (r) => r.model === "fixture-main", reply: { text: "done" } },
    ]);
    const s = await sessionWith(fixture, {
      executor: true,
      agents: {
        "probe-worker":
          "---\ndescription: Probe worker\ntools: read, grep\n---\nYou are a probe worker.\n",
      },
    });
    await s.prompt("start");
    await s.waitFor(
      () => fixture.requests.some((r) => r.model === "fixture-fast"),
      "child request",
    );
    const child = fixture.requests.find((r) => r.model === "fixture-fast");
    expect(child?.model).toBe("fixture-fast");
    expect(child?.reasoningEffort).toBeDefined();
  }, 90_000);

  test("times out with last event", async () => {
    const fixture = await fixtureWith([]);
    const s = await sessionWith(fixture, { timeoutMs: 1500 });
    await expect(s.waitFor(() => false, "never")).rejects.toThrow(/never.*last event/);
    // keep the session for the cleanup test below
    await s.close();
  }, 60_000);

  test("cleans up after a failed run", async () => {
    const before = piRpcPids();
    const fixture = await fixtureWith([]);
    const s = await sessionWith(fixture, { timeoutMs: 1500 });
    // An unmatched request is a 400: Pi reports the error and settles once (no retry duplicates).
    await s.prompt("hi");
    expect(fixture.unmatched.length).toBe(1);
    const failure = await s
      .waitFor(() => false, "never")
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect((failure as Error).message).toMatch(/last event/);
    await s.close();
    expect(existsSync(s.agentDir)).toBe(false);
    const leaked = [...piRpcPids()].filter((p) => !before.has(p));
    expect(leaked).toEqual([]);
  }, 60_000);
});
