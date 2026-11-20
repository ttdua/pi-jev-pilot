// Host evidence for the `fresh` and `fork` subagent contexts (specs `subagent-context-mode`,
// `cli-review`), through real Pi sessions against the loopback recording fixture.
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../helpers";
import { startFixture, type Fixture, type RecordedRequest, type ScriptEntry } from "./fixture";
import { DEFAULT_JEV_CONFIG, startHostSession, type HostSession } from "./harness";

const fixtures: Fixture[] = [];
const sessions: HostSession[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const s of sessions.splice(0)) await s.close();
  for (const f of fixtures.splice(0)) await f.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const TIMEOUT = 90_000;
const FRESH = "ctx-fresh";
const READER = "ctx-reader";
const AGENTS = {
  [FRESH]: "---\ndescription: Fresh probe\n---\nYou are a fresh probe.\n",
  [READER]:
    "---\ndescription: Read-only probe\ntools: read, grep\n---\nYou are a read-only probe.\n",
};

type Msg = { role?: string; content?: unknown };
const messages = (r: RecordedRequest): Msg[] =>
  Array.isArray(r.body.messages) ? (r.body.messages as Msg[]) : [];
const textOf = (content: unknown): string =>
  typeof content === "string" ? content : JSON.stringify(content ?? "");
const lastUser = (r: RecordedRequest, text: string): boolean => {
  const last = messages(r).at(-1);
  return last?.role === "user" && JSON.stringify(last).includes(text);
};
const isMainPrompt = (r: RecordedRequest, prompt: string): boolean =>
  r.model === "fixture-main" && lastUser(r, prompt);
const isFork = (r: RecordedRequest): boolean =>
  JSON.stringify(messages(r)).includes("<subagent_instructions>");
const toolResults = (r: RecordedRequest): string[] =>
  messages(r)
    .filter((m) => m.role === "tool")
    .map((m) => textOf(m.content));

type Call = { name: string; arguments: Record<string, unknown> };
const subagent = (task: string, type: string, extra: Record<string, unknown> = {}): Call => ({
  name: "subagent",
  arguments: { prompt: task, description: "ctx", subagent_type: type, ...extra },
});

const mainCalls = (calls: Call[]): ScriptEntry => ({
  name: "main-calls",
  match: (r) => isMainPrompt(r, "START-MAIN"),
  reply: { toolCalls: calls },
  times: 1,
});
const MAIN_AFTER: ScriptEntry = {
  name: "main-after",
  match: (r) => r.model === "fixture-main" && !isFork(r) && !lastUser(r, "CHILD-TASK"),
  reply: { text: "done" },
};

async function start(
  script: ScriptEntry[],
  extra: Partial<Parameters<typeof startHostSession>[0]> = {},
): Promise<{ fixture: Fixture; session: HostSession }> {
  const fixture = await startFixture(script);
  fixtures.push(fixture);
  const session = await startHostSession({
    fixture,
    agents: AGENTS,
    env: { TYPESAFE_API_KEY: "test-key", ...extra.env },
    timeoutMs: 60_000,
    ...extra,
  });
  sessions.push(session);
  return { fixture, session };
}

const forkRequests = (f: Fixture): RecordedRequest[] =>
  f.requests.filter((r) => isFork(r) && lastUser(r, "CHILD-TASK"));

describe("fork child", () => {
  test(
    "a fork calling jev_review keeps it declared and is refused",
    async () => {
      const tmp = tempDir("ctx-review-");
      dirs.push(tmp);
      const bin = join(tmp, "bin");
      mkdirSync(bin);
      copyFileSync(
        join(import.meta.dir, "..", "fixtures", "fake-cli", "codex"),
        join(bin, "codex"),
      );
      chmodSync(join(bin, "codex"), 0o755);
      const log = join(tmp, "codex.log");
      const review: Call = { name: "jev_review", arguments: { brief: "check it" } };
      const { fixture, session: s } = await start(
        [
          {
            name: "child-after",
            match: (r) => isFork(r) && messages(r).at(-1)?.role === "tool",
            reply: { text: "child done" },
          },
          {
            name: "child-review",
            match: (r) => isFork(r) && lastUser(r, "CHILD-TASK"),
            reply: { toolCalls: [review] },
            times: 1,
          },
          mainCalls([subagent("CHILD-TASK review it", READER, { context: "fork" })]),
          MAIN_AFTER,
        ],
        {
          jevConfig: { ...DEFAULT_JEV_CONFIG, reviewEnabled: true },
          env: { PATH: `${bin}:${process.env.PATH ?? ""}`, TMPDIR: tmp, FAKE_CODEX_LOG: log },
        },
      );
      await s.prompt("START-MAIN");
      await s.waitFor(() => fixture.requests.some((r) => r.matched === "child-after"), "after");
      const main = fixture.requests.find((r) => r.matched === "main-calls") as RecordedRequest;
      expect(main.toolNames).toContain("jev_review");
      expect((forkRequests(fixture)[0] as RecordedRequest).toolNames).toContain("jev_review");
      const after = fixture.requests.find((r) => r.matched === "child-after") as RecordedRequest;
      expect(toolResults(after).at(-1)).toMatch(/not available/);
      expect(existsSync(log)).toBe(false);
    },
    TIMEOUT,
  );
});
