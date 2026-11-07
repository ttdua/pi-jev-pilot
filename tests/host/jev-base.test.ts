import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../helpers";
import { toolNames } from "./bodies";
import { startFixture, type Fixture, type RecordedRequest, type ScriptEntry } from "./fixture";
import { runOnce, startHostSession, type HostSession } from "./harness";
import { command, notifies, uiRequests, type UiRequest } from "./rpc-helpers";

const fixtures: Fixture[] = [];
const sessions: HostSession[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const s of sessions.splice(0)) await s.close();
  for (const f of fixtures.splice(0)) await f.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const KEY = { TYPESAFE_API_KEY: "test-key" };
const TIMEOUT = 60_000;

const mainReply = (delayMs?: number): ScriptEntry[] => [
  {
    name: "main",
    match: (r) => r.model === "fixture-main",
    reply: { text: "ok" },
    delayMs,
  },
];

async function fixtureWith(script: ScriptEntry[] = mainReply()): Promise<Fixture> {
  const f = await startFixture(script);
  fixtures.push(f);
  return f;
}

async function host(
  fixture: Fixture,
  opts: Partial<Parameters<typeof startHostSession>[0]> = {},
): Promise<HostSession> {
  const s = await startHostSession({
    fixture,
    self: true,
    env: KEY,
    timeoutMs: TIMEOUT,
    ...opts,
  });
  sessions.push(s);
  return s;
}

const jevWidgets = (s: HostSession): UiRequest[] =>
  uiRequests(s).filter((e) => e.method === "setWidget" && e.widgetKey === "jev");

describe("status line and /jev through the real CLI", () => {
  test(
    "start draws one jev widget above the editor",
    async () => {
      const s = await host(await fixtureWith());
      await s.waitFor(() => jevWidgets(s).length >= 1, "jev widget");
      await Bun.sleep(300);
      const w = jevWidgets(s);
      expect(w.length).toBe(1);
      expect(w[0]?.widgetLines).toEqual(["Jev · standard"]);
      expect(w[0]?.widgetPlacement).toBe("aboveEditor");
    },
    TIMEOUT,
  );

  test(
    "no key variable shows no key",
    async () => {
      const s = await host(await fixtureWith(), { env: {} });
      await s.waitFor(() => jevWidgets(s).length >= 1, "jev widget");
      expect(jevWidgets(s).at(-1)?.widgetLines).toEqual(["Jev · no key"]);
    },
    TIMEOUT,
  );

  test(
    "/jev is handled, notifies once and leaves no session message",
    async () => {
      const s = await host(await fixtureWith());
      const data = await command(s, "/jev");
      expect(data?.disposition).toBe("handled");
      await s.waitFor(() => notifies(s).length >= 1, "notify");
      const n = notifies(s);
      expect(n.length).toBe(1);
      expect(n[0]?.notifyType).toBe("info");
      const msgs = await s.send({ type: "get_messages" });
      const all = (msgs.data?.messages ?? []) as {
        role?: string;
        content?: unknown;
      }[];
      const userText = all.filter((m) => m.role === "user").map((m) => JSON.stringify(m.content));
      expect(userText.some((c) => c.includes("/jev"))).toBe(false);
    },
    TIMEOUT,
  );

  test(
    "all decision features off shows off",
    async () => {
      const s = await host(await fixtureWith());
      for (const f of ["effort", "subagents", "skills", "strategy", "tools", "expert"]) {
        await command(s, `/jev ${f} off`);
      }
      await s.waitFor(() => jevWidgets(s).at(-1)?.widgetLines?.[0] === "Jev · off", "off widget");
      expect(jevWidgets(s).at(-1)?.widgetLines).toEqual(["Jev · off"]);
    },
    TIMEOUT,
  );

  test(
    "/jev status off removes the widget",
    async () => {
      const s = await host(await fixtureWith());
      await s.waitFor(() => jevWidgets(s).length >= 1, "start widget");
      const before = jevWidgets(s).length;
      await command(s, "/jev status off");
      await s.waitFor(() => jevWidgets(s).length > before, "cleared widget");
      expect(jevWidgets(s).at(-1)?.widgetLines).toBeUndefined();
    },
    TIMEOUT,
  );

  test(
    "unknown command notifies a warning",
    async () => {
      const s = await host(await fixtureWith());
      await command(s, "/jev tune apply");
      await s.waitFor(() => notifies(s).length >= 1, "notify");
      expect(notifies(s).at(-1)?.notifyType).toBe("warning");
    },
    TIMEOUT,
  );

  test(
    "/jev reports the executor when present",
    async () => {
      const s = await host(await fixtureWith(), { executor: true });
      await command(s, "/jev");
      await s.waitFor(() => notifies(s).length >= 1, "notify");
      const m = notifies(s).at(-1)?.message ?? "";
      expect(m).toContain("executor: present");
      expect(m).not.toContain("no executor");
    },
    TIMEOUT,
  );

  test(
    "/jev reports a missing executor",
    async () => {
      const s = await host(await fixtureWith());
      await command(s, "/jev");
      await s.waitFor(() => notifies(s).length >= 1, "notify");
      expect(notifies(s).at(-1)?.message).toContain("no executor");
    },
    TIMEOUT,
  );

  test(
    "/jev skills off while a prompt streams writes state and the run completes",
    async () => {
      const fixture = await fixtureWith(mainReply(3000));
      const s = await host(fixture);
      const settledBefore = s.events.filter((e) => e.type === "agent_settled").length;
      const first = await s.send({ type: "prompt", message: "hello" });
      expect(first.success).toBe(true);
      await s.waitFor(() => fixture.requests.length >= 1, "request in flight");
      const settledCount = (): number => s.events.filter((e) => e.type === "agent_settled").length;
      // The run must still be streaming when the command is sent.
      expect(settledCount()).toBe(settledBefore);
      await command(s, "/jev skills off");
      expect(settledCount()).toBe(settledBefore);
      const stateFile = join(s.agentDir, "jev", "state.json");
      await s.waitFor(() => existsSync(stateFile), "state.json written");
      // Read before the run settles: the write happened mid-stream.
      const state = JSON.parse(readFileSync(stateFile, "utf8")) as {
        switches?: Record<string, boolean>;
      };
      expect(state.switches?.skills).toBe(false);
      expect(settledCount()).toBe(settledBefore);
      await s.waitFor(() => settledCount() > settledBefore, "agent_settled");
      const msgs = await s.send({ type: "get_messages" });
      const json = JSON.stringify(msgs.data?.messages ?? []);
      expect(json).toContain("ok");
      expect(json).not.toContain("/jev skills");
      expect(fixture.unmatched).toEqual([]);
    },
    TIMEOUT,
  );

  test(
    "a restart keeps the saved switch",
    async () => {
      const fixture = await fixtureWith();
      const agentDir = tempDir("jev-host-agent-");
      const cwd = tempDir("jev-host-cwd-");
      dirs.push(agentDir, cwd);
      const a = await host(fixture, { agentDir, cwd });
      await command(a, "/jev skills off");
      await a.waitFor(() => notifies(a).length >= 1, "notify A");
      await a.close();
      sessions.splice(sessions.indexOf(a), 1);

      const b = await host(fixture, { agentDir, cwd });
      await command(b, "/jev");
      await b.waitFor(() => notifies(b).length >= 1, "notify B");
      expect(notifies(b).at(-1)?.message).toMatch(/skills: off/);
    },
    TIMEOUT,
  );
});

function noReview(f: Fixture): boolean {
  return f.requests.every((r: RecordedRequest) => !toolNames(r.body).includes("jev_review"));
}

describe("print and JSON mode", () => {
  test(
    "print mode shows no status line and leaves provider requests unchanged",
    async () => {
      const agentDir = tempDir("jev-host-agent-");
      const cwd = tempDir("jev-host-cwd-");
      dirs.push(agentDir, cwd);
      // Same agent dir and cwd: the first run has no package, the second installs it.
      const plain = await fixtureWith();
      const r1 = await runOnce({
        fixture: plain,
        mode: "print",
        message: "hello",
        self: false,
        agentDir,
        cwd,
        env: KEY,
      });
      expect(r1.code).toBe(0);
      const withPkg = await fixtureWith();
      const r2 = await runOnce({
        fixture: withPkg,
        mode: "print",
        message: "hello",
        self: true,
        agentDir,
        cwd,
        env: KEY,
      });
      expect(r2.code).toBe(0);
      // That the package is loaded in print mode is proven by the "/jev skills off" print test below.
      expect(r2.stdout).not.toContain("Jev ·");
      expect(r2.stderr).not.toContain("Jev ·");
      expect(plain.requests.length).toBeGreaterThan(0);
      // Ports differ per fixture, so the models.json base URL is not part of the body; compare bodies.
      const bodies = (f: Fixture): string[] =>
        f.requests.map((r: RecordedRequest) => JSON.stringify(r.body));
      expect(noReview(withPkg)).toBe(true);
      expect(noReview(plain)).toBe(true);
      expect(bodies(withPkg)).toEqual(bodies(plain));
    },
    TIMEOUT,
  );

  test(
    "json mode carries no status line",
    async () => {
      const fixture = await fixtureWith();
      const r = await runOnce({
        fixture,
        mode: "json",
        message: "hello",
        self: true,
        env: KEY,
      });
      dirs.push(r.agentDir, r.cwd);
      expect(r.code).toBe(0);
      expect(r.stdout.length).toBeGreaterThan(0);
      for (const line of r.stdout.split("\n")) {
        expect(line).not.toContain("Jev ·");
        expect(line).not.toContain('"widgetKey":"jev"');
      }
      expect(r.stderr).not.toContain("Jev ·");
    },
    TIMEOUT,
  );

  test(
    "json mode runs /jev skills off with no jev output and writes state",
    async () => {
      const fixture = await fixtureWith();
      const r = await runOnce({
        fixture,
        mode: "json",
        message: "/jev skills off",
        self: true,
        env: KEY,
      });
      dirs.push(r.agentDir, r.cwd);
      expect(r.code).toBe(0);
      const file = join(r.agentDir, "jev", "state.json");
      expect(existsSync(file)).toBe(true);
      for (const line of `${r.stdout}\n${r.stderr}`.split("\n")) {
        expect(line).not.toContain("Jev ·");
        expect(line).not.toContain('"widgetKey":"jev"');
      }
    },
    TIMEOUT,
  );

  test(
    "print mode runs /jev skills off silently and writes state",
    async () => {
      const fixture = await fixtureWith();
      const r = await runOnce({
        fixture,
        mode: "print",
        message: "/jev skills off",
        self: true,
        env: KEY,
      });
      dirs.push(r.agentDir, r.cwd);
      expect(r.code).toBe(0);
      expect(r.stdout).toBe("");
      expect(r.stderr).not.toContain("Jev ·");
      expect(r.stderr).toBe("");
      const file = join(r.agentDir, "jev", "state.json");
      expect(existsSync(file)).toBe(true);
      const state = JSON.parse(readFileSync(file, "utf8")) as {
        switches?: Record<string, boolean>;
      };
      expect(state.switches?.skills).toBe(false);
      expect(fixture.requests.length).toBe(0);
    },
    TIMEOUT,
  );
});

describe("executor child", () => {
  test("a child session draws no second jev widget", async () => {
    const msgs = (r: RecordedRequest): { role?: string }[] =>
      Array.isArray(r.body.messages) ? (r.body.messages as { role?: string }[]) : [];
    const text = (r: RecordedRequest): string => JSON.stringify(r.body.messages);
    const isChild = (r: RecordedRequest): boolean =>
      JSON.stringify(msgs(r).at(-1)).includes("CHILD-TASK") && msgs(r).at(-1)?.role === "user";
    const fixture = await fixtureWith([
      { name: "child", match: isChild, reply: { text: "child done" } },
      {
        name: "main-call",
        match: (r) =>
          r.model === "fixture-main" &&
          !isChild(r) &&
          !msgs(r).some((m) => m.role === "tool") &&
          text(r).includes("START-MAIN"),
        reply: {
          toolCalls: [
            {
              name: "subagent",
              arguments: {
                prompt: "CHILD-TASK do the work",
                description: "smoke",
                subagent_type: "smoke-worker",
              },
            },
          ],
        },
        times: 1,
      },
      {
        name: "main-after",
        match: (r) => r.model === "fixture-main",
        reply: { text: "done" },
      },
    ]);
    const s = await host(fixture, {
      executor: true,
      agents: {
        "smoke-worker": "---\ndescription: Smoke worker\ntools: read\n---\nYou are a worker.\n",
      },
    });
    await s.prompt("START-MAIN");
    await s.waitFor(() => fixture.requests.some(isChild), "child request");
    await s.waitFor(
      () => fixture.requests.some((r) => r.matched === "main-after"),
      "main resumes after child",
    );
    // Start draw + one redraw for the main run's decision; the child session adds none.
    const lines = jevWidgets(s).map((w) => w.widgetLines);
    expect(lines).toEqual([["Jev · standard"], ["Jev · standard · no answer"]]);
    expect(fixture.unmatched).toEqual([]);
  }, 120_000);
});
