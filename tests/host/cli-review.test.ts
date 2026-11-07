import { afterEach, describe, expect, test } from "bun:test";
import {
  copyFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tempDir } from "../helpers";
import { startFixture, type Fixture, type RecordedRequest, type ScriptEntry } from "./fixture";
import { DEFAULT_JEV_CONFIG, startHostSession, type HostSession } from "./harness";
import { command, writeConfigFile } from "./rpc-helpers";

const FAKE_CODEX = join(import.meta.dir, "..", "fixtures", "fake-cli", "codex");
const TIMEOUT = 120_000;

const fixtures: Fixture[] = [];
const sessions: HostSession[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const s of sessions.splice(0)) await s.close();
  for (const f of fixtures.splice(0)) await f.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

type Setup = { fixture: Fixture; session: HostSession; tmp: string; log: string };

/** Starts a host session with a copy of the fake codex first on PATH. */
async function setup(
  script: ScriptEntry[],
  mode: "ok" | "fail",
  extra: Partial<Parameters<typeof startHostSession>[0]> = {},
): Promise<Setup> {
  const fixture = await startFixture(script);
  fixtures.push(fixture);
  const tmp = tempDir("jev-cli-tmp-");
  dirs.push(tmp);
  const bin = join(tmp, "bin");
  mkdirSync(bin);
  copyFileSync(FAKE_CODEX, join(bin, "codex"));
  chmodSync(join(bin, "codex"), 0o755);
  const log = join(tmp, "codex.log");
  const session = await startHostSession({
    fixture,
    self: true,
    jevConfig: { ...DEFAULT_JEV_CONFIG, reviewEnabled: true },
    timeoutMs: TIMEOUT,
    env: {
      TYPESAFE_API_KEY: "test-key",
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      TMPDIR: tmp,
      FAKE_CODEX_MODE: mode,
      FAKE_CODEX_LOG: log,
    },
    ...extra,
  });
  sessions.push(session);
  return { fixture, session, tmp, log };
}

type Msg = { role?: string; content?: unknown };
const msgs = (r: RecordedRequest): Msg[] =>
  Array.isArray(r.body.messages) ? (r.body.messages as Msg[]) : [];
const hasToolResult = (r: RecordedRequest): boolean => msgs(r).some((m) => m.role === "tool");
const toolResult = (r: RecordedRequest): string =>
  msgs(r)
    .filter((m) => m.role === "tool")
    .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
    .join("\n");

const reviewCall = (): ScriptEntry => ({
  name: "review-call",
  match: (r) =>
    r.model === "fixture-main" &&
    !hasToolResult(r) &&
    JSON.stringify(r.body.messages).includes("START-MAIN"),
  reply: { toolCalls: [{ name: "jev_review", arguments: { brief: "JEV-MARKER-BRIEF check it" } }] },
  times: 1,
});
const after: ScriptEntry = {
  name: "after",
  match: (r) => r.model === "fixture-main" && hasToolResult(r),
  reply: { text: "done" },
};

async function runReviewFlow(mode: "ok" | "fail", extra = {}): Promise<Setup> {
  const s = await setup([reviewCall(), after], mode, extra);
  await s.session.prompt("START-MAIN");
  await s.session.waitFor(
    () => s.fixture.requests.some((r) => r.matched === "after"),
    "tool result request",
  );
  return s;
}

describe("cli-review through the real CLI", () => {
  // Scenario "On from the config": the config turns the review on, so the main session offers it.
  test(
    "offered in the main session",
    async () => {
      const s = await setup([{ name: "main", match: () => true, reply: { text: "ok" } }], "ok");
      await s.session.prompt("hello");
      await s.session.waitFor(() => s.fixture.requests.length >= 1, "first request");
      expect(s.fixture.requests[0]?.toolNames).toContain("jev_review");
    },
    TIMEOUT,
  );

  test(
    "absent in a child session",
    async () => {
      const isChild = (r: RecordedRequest): boolean => {
        const last = msgs(r).at(-1);
        return last?.role === "user" && JSON.stringify(last).includes("CHILD-TASK");
      };
      const s = await setup(
        [
          { name: "child", match: isChild, reply: { text: "child done" } },
          {
            name: "main-call",
            match: (r) =>
              r.model === "fixture-main" &&
              !isChild(r) &&
              !hasToolResult(r) &&
              JSON.stringify(r.body.messages).includes("START-MAIN"),
            reply: {
              toolCalls: [
                {
                  name: "subagent",
                  arguments: {
                    prompt: "CHILD-TASK do the work",
                    description: "child",
                    subagent_type: "free-worker",
                  },
                },
              ],
            },
            times: 1,
          },
          { name: "main-after", match: (r) => r.model === "fixture-main", reply: { text: "done" } },
        ],
        "ok",
        {
          executor: true,
          agents: {
            "free-worker": "---\ndescription: Unrestricted worker\n---\nYou are a worker.\n",
          },
        },
      );
      await s.session.prompt("START-MAIN");
      await s.session.waitFor(() => s.fixture.requests.some(isChild), "child request");
      await s.session.waitFor(
        () => s.fixture.requests.some((r) => r.matched === "main-after"),
        "main resumes",
      );
      const child = s.fixture.requests.find(isChild)!;
      expect(child.toolNames).toContain("read");
      expect(child.toolNames).not.toContain("jev_review");
      expect(JSON.stringify(child.body)).not.toContain("jev_review");
      const main = s.fixture.requests.find((r) => r.matched === "main-call")!;
      expect(main.toolNames).toContain("jev_review");
    },
    TIMEOUT,
  );

  test(
    "success through the tool",
    async () => {
      const s = await runReviewFlow("ok");
      const result = toolResult(s.fixture.requests.find((r) => r.matched === "after")!);
      expect(result).toContain("Codex review");
      expect(result).toContain("PASS");
      const log = readFileSync(s.log, "utf8");
      expect(log).toContain("exec");
      expect(log).toMatch(/exec argc=\d+ model=$/m);
      expect(log).not.toContain("debug models");
    },
    TIMEOUT,
  );

  test(
    "failure through the tool",
    async () => {
      const s = await runReviewFlow("fail");
      const result = toolResult(s.fixture.requests.find((r) => r.matched === "after")!);
      expect(result).toContain("The Codex review did not run:");
      expect(result).toContain("Exit code 3.");
    },
    TIMEOUT,
  );

  test(
    "nothing stored",
    async () => {
      const s = await runReviewFlow("ok");
      const markers = ["JEV-MARKER-BRIEF", "JEV-MARKER-OUT"];
      const scan = (root: string): string[] => {
        const hits: string[] = [];
        const walk = (d: string): void => {
          for (const e of readdirSync(d, { withFileTypes: true })) {
            const p = join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.isFile()) {
              const text = readFileSync(p, "utf8");
              if (markers.some((m) => text.includes(m))) hits.push(p);
            }
          }
        };
        walk(root);
        return hits;
      };
      expect(scan(s.session.agentDir)).toEqual([]);
      // bin/ holds the fake script, whose source names the marker.
      expect(scan(s.tmp).filter((p) => !p.startsWith(join(s.tmp, "bin")))).toEqual([]);
      expect(readdirSync(s.tmp).filter((n) => n.startsWith("jev-review-"))).toEqual([]);
    },
    TIMEOUT,
  );

  describe("on and off", () => {
    const idle: ScriptEntry[] = [{ name: "main", match: () => true, reply: { text: "ok" } }];
    const firstOf = (s: Setup, n: number): RecordedRequest => s.fixture.requests[n]!;

    /** Pre-creates the agent dir so state.json and config.json can be written before the session. */
    const prepared = (state?: Record<string, unknown>, config?: Record<string, unknown>) => {
      const agentDir = tempDir("jev-host-agent-");
      dirs.push(agentDir);
      if (config) writeConfigFile(agentDir, config);
      if (state) {
        mkdirSync(join(agentDir, "jev"), { recursive: true });
        writeFileSync(join(agentDir, "jev", "state.json"), JSON.stringify(state));
      }
      return agentDir;
    };

    test(
      "off by default",
      async () => {
        const s = await setup(idle, "ok", { jevConfig: { ...DEFAULT_JEV_CONFIG } });
        await s.session.prompt("hello");
        await s.session.waitFor(() => s.fixture.requests.length >= 1, "first request");
        expect(firstOf(s, 0).toolNames).not.toContain("jev_review");
        expect(JSON.stringify(firstOf(s, 0).body)).not.toContain("jev_review");
      },
      TIMEOUT,
    );

    test(
      "state off over config on",
      async () => {
        const agentDir = prepared({ version: 1, cliReviewEnabled: false });
        const s = await setup(idle, "ok", { agentDir });
        await s.session.prompt("hello");
        await s.session.waitFor(() => s.fixture.requests.length >= 1, "first request");
        expect(firstOf(s, 0).toolNames).not.toContain("jev_review");
      },
      TIMEOUT,
    );

    test(
      "turned on mid-session",
      async () => {
        const s = await setup(idle, "ok", { jevConfig: { ...DEFAULT_JEV_CONFIG } });
        await s.session.prompt("one");
        await s.session.waitFor(() => s.fixture.requests.length >= 1, "turn one");
        expect(firstOf(s, 0).toolNames).not.toContain("jev_review");
        await command(s.session, "/jev cli-review on");
        await s.session.prompt("two");
        await s.session.waitFor(() => s.fixture.requests.length >= 2, "turn two");
        expect(firstOf(s, 1).toolNames).toContain("jev_review");
      },
      TIMEOUT,
    );

    test(
      "turned off mid-session",
      async () => {
        const s = await setup(idle, "ok");
        await s.session.prompt("one");
        await s.session.waitFor(() => s.fixture.requests.length >= 1, "turn one");
        expect(firstOf(s, 0).toolNames).toContain("jev_review");
        await command(s.session, "/jev cli-review off");
        await s.session.prompt("two");
        await s.session.waitFor(() => s.fixture.requests.length >= 2, "turn two");
        expect(firstOf(s, 1).toolNames).not.toContain("jev_review");
      },
      TIMEOUT,
    );

    test(
      "on, off and on again in one session",
      async () => {
        const s = await setup(idle, "ok");
        await s.session.prompt("one");
        await s.session.waitFor(() => s.fixture.requests.length >= 1, "turn one");
        expect(firstOf(s, 0).toolNames).toContain("jev_review");
        await command(s.session, "/jev cli-review off");
        await s.session.prompt("two");
        await s.session.waitFor(() => s.fixture.requests.length >= 2, "turn two");
        expect(firstOf(s, 1).toolNames).not.toContain("jev_review");
        expect(JSON.stringify(firstOf(s, 1).body)).not.toContain("jev_review");
        await command(s.session, "/jev cli-review on");
        await s.session.prompt("three");
        await s.session.waitFor(() => s.fixture.requests.length >= 3, "turn three");
        expect(firstOf(s, 2).toolNames).toContain("jev_review");
      },
      TIMEOUT,
    );

    test(
      "refused while off",
      async () => {
        // Pi refuses an inactive tool itself, so the tool must be active when the setting flips:
        // the review is on at the sync, and state.json turns it off while the first request is served.
        const agentDir = prepared();
        const turnOff = (): void =>
          writeFileSync(
            join(agentDir, "jev", "state.json"),
            JSON.stringify({ version: 1, cliReviewEnabled: false }),
          );
        const flip = reviewCall();
        const matches = flip.match;
        flip.match = (r) => {
          const hit = matches(r);
          if (hit) turnOff();
          return hit;
        };
        const s = await setup([flip, after], "ok", { agentDir });
        await s.session.prompt("START-MAIN");
        await s.session.waitFor(
          () => s.fixture.requests.some((r) => r.matched === "after"),
          "tool result request",
        );
        const result = toolResult(s.fixture.requests.find((r) => r.matched === "after")!);
        expect(result).toContain("jev_review is off");
        expect(result).toContain("/jev cli-review on");
        expect(!existsSync(s.log) || readFileSync(s.log, "utf8") === "").toBe(true);
      },
      TIMEOUT,
    );

    test(
      "invalid config, on from state",
      async () => {
        const agentDir = prepared({ version: 1, cliReviewEnabled: true }, { notAKnownKey: true });
        const s = await setup([reviewCall(), after], "ok", { agentDir });
        await s.session.prompt("START-MAIN");
        await s.session.waitFor(
          () => s.fixture.requests.some((r) => r.matched === "after"),
          "tool result request",
        );
        expect(readFileSync(s.log, "utf8")).toContain("exec");
      },
      TIMEOUT,
    );
  });
});
