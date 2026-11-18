// Host evidence for the `fresh` and `fork` subagent contexts (specs `subagent-context-mode`,
// `cli-review`), through real Pi sessions against the loopback recording fixture.
import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
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
import { command } from "./rpc-helpers";

const fixtures: Fixture[] = [];
const sessions: HostSession[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const s of sessions.splice(0)) await s.close();
  for (const f of fixtures.splice(0)) await f.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const TIMEOUT = 90_000;
const SYSTEM_MARKER = "JEV-MARKER-system-5b1c";
const CONVERSATION_MARKER = "JEV-MARKER-convo-8e42";
const FORKED_RESULT = "Forked: this branch continues as a subagent.";
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
    install: "executor-only",
    agents: AGENTS,
    env: { TYPESAFE_API_KEY: "test-key", ...extra.env },
    timeoutMs: 60_000,
    ...extra,
  });
  sessions.push(session);
  return { fixture, session };
}

function emptyPolicyFile(): string {
  const dir = tempDir("ctx-policy-");
  dirs.push(dir);
  const file = join(dir, "policy.json");
  writeFileSync(file, JSON.stringify({}));
  return file;
}

const forkRequests = (f: Fixture): RecordedRequest[] =>
  f.requests.filter((r) => isFork(r) && lastUser(r, "CHILD-TASK"));

/** Every `.jsonl` file under `dir`, with the session id from its header line. */
function transcripts(dir: string): { file: string; id: string; text: string }[] {
  const out: { file: string; id: string; text: string }[] = [];
  const walk = (d: string): void => {
    for (const entry of existsSync(d) ? readdirSync(d, { withFileTypes: true }) : []) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".jsonl")) {
        const text = readFileSync(path, "utf8");
        const header = JSON.parse(text.split("\n")[0] ?? "{}") as { id?: string };
        out.push({ file: path, id: header.id ?? "", text });
      }
    }
  };
  walk(dir);
  return out;
}

describe("fresh child", () => {
  test(
    "carries no parent system prompt and no parent conversation",
    async () => {
      const { fixture, session: s } = await start(
        [
          {
            name: "child",
            match: (r) => lastUser(r, "CHILD-TASK"),
            reply: { text: "child done" },
          },
          mainCalls([subagent("CHILD-TASK plain", FRESH, { context: "fresh" })]),
          MAIN_AFTER,
        ],
        { args: ["--append-system-prompt", `parent only ${SYSTEM_MARKER}`] },
      );
      await s.prompt(`START-MAIN ${CONVERSATION_MARKER}`);
      await s.waitFor(() => fixture.requests.some((r) => lastUser(r, "CHILD-TASK")), "child");
      const main = fixture.requests.find((r) => r.matched === "main-calls") as RecordedRequest;
      // Positive control: both markers are in the parent's own request.
      expect(JSON.stringify(main.body)).toContain(SYSTEM_MARKER);
      expect(JSON.stringify(main.body)).toContain(CONVERSATION_MARKER);
      const child = fixture.requests.find((r) => lastUser(r, "CHILD-TASK")) as RecordedRequest;
      expect(JSON.stringify(child.body)).not.toContain(SYSTEM_MARKER);
      expect(JSON.stringify(child.body)).not.toContain(CONVERSATION_MARKER);
      expect(messages(child).filter((m) => m.role === "user")).toHaveLength(1);
    },
    TIMEOUT,
  );
});

describe("fork child", () => {
  test(
    "Fork before the parent has persisted",
    async () => {
      // `--no-session`: the parent writes no file at all, so only the in-memory branch exists.
      const { fixture, session: s } = await start([
        {
          name: "child",
          match: (r) => isFork(r) && lastUser(r, "CHILD-TASK"),
          reply: { text: "ok" },
        },
        mainCalls([subagent("CHILD-TASK from memory", FRESH, { context: "fork" })]),
        MAIN_AFTER,
      ]);
      await s.prompt(`START-MAIN ${CONVERSATION_MARKER}`);
      await s.waitFor(() => forkRequests(fixture).length === 1, "fork request");
      expect(transcripts(join(s.agentDir, "sessions"))).toEqual([]);
      const fork = forkRequests(fixture)[0] as RecordedRequest;
      expect(JSON.stringify(messages(fork))).toContain(CONVERSATION_MARKER);
    },
    TIMEOUT,
  );

  test(
    "two forks of one parent message share a prefix and have their own sessions",
    async () => {
      const { fixture, session: s } = await start(
        [
          {
            name: "child",
            match: (r) => isFork(r) && lastUser(r, "CHILD-TASK"),
            reply: { text: "ok" },
          },
          mainCalls([
            subagent("CHILD-TASK alpha", FRESH, { context: "fork" }),
            subagent("CHILD-TASK beta", FRESH, { context: "fork" }),
          ]),
          MAIN_AFTER,
        ],
        { persist: true },
      );
      await s.prompt(`START-MAIN ${CONVERSATION_MARKER}`);
      await s.waitFor(() => forkRequests(fixture).length === 2, "two fork requests");
      const [a, b] = forkRequests(fixture) as [RecordedRequest, RecordedRequest];
      const prefix = (r: RecordedRequest): string => JSON.stringify(messages(r).slice(0, -1));
      expect(prefix(a)).toBe(prefix(b));
      expect(toolResults(a).filter((t) => t === FORKED_RESULT)).toHaveLength(2);
      expect(JSON.stringify(a.body.tools)).toBe(JSON.stringify(b.body.tools));
      expect(JSON.stringify(messages(a).at(-1))).not.toBe(JSON.stringify(messages(b).at(-1)));

      const files = transcripts(join(s.agentDir, "sessions"));
      expect(new Set(files.map((f) => f.id)).size).toBe(files.length);
      const forks = files.filter((f) => f.text.includes("<subagent_instructions>"));
      expect(forks).toHaveLength(2);
      expect(forks.map((f) => f.file).sort()).toEqual(
        [...new Set(forks.map((f) => f.file))].sort(),
      );
      expect(files.filter((f) => !forks.includes(f))).toHaveLength(1);
    },
    TIMEOUT,
  );

  test(
    "a read-only fork calling edit is refused and changes no file",
    async () => {
      const edit: Call = {
        name: "edit",
        arguments: { path: "target.txt", edits: [{ oldText: "before", newText: "after" }] },
      };
      const { fixture, session: s } = await start([
        {
          name: "child-after",
          match: (r) => isFork(r) && messages(r).at(-1)?.role === "tool",
          reply: { text: "child done" },
        },
        {
          name: "child-edit",
          match: (r) => isFork(r) && lastUser(r, "CHILD-TASK"),
          reply: { toolCalls: [edit] },
          times: 1,
        },
        mainCalls([subagent("CHILD-TASK edit it", READER, { context: "fork" })]),
        MAIN_AFTER,
      ]);
      writeFileSync(join(s.cwd, "target.txt"), "before");
      await s.prompt("START-MAIN");
      await s.waitFor(() => fixture.requests.some((r) => r.matched === "child-after"), "after");
      const first = forkRequests(fixture)[0] as RecordedRequest;
      expect(first.toolNames).toContain("edit");
      const after = fixture.requests.find((r) => r.matched === "child-after") as RecordedRequest;
      expect(toolResults(after).at(-1)).toContain('Tool "edit" is not available to this subagent.');
      expect(readFileSync(join(s.cwd, "target.txt"), "utf8")).toBe("before");
    },
    TIMEOUT,
  );

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
          install: "checkout",
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

  test(
    "a fork before the parent's first turn starts from the startup entries",
    async () => {
      // Pi records a model change when a session starts, so a real parent's branch is never
      // empty and the "Cannot fork" refusal is unreachable here (unit-tested in the manager).
      // This is the thinnest parent a host can produce: no turn yet.
      const { fixture, session: s } = await start(
        [{ name: "fork", match: (r) => isFork(r), reply: { text: "ok" } }],
        {
          probes: ["policy"],
          env: { JEV_POLICY_FILE: emptyPolicyFile(), JEV_SPAWN_CONTEXT: "fork" },
        },
      );
      await s.waitFor(() => s.probeRecords().some((r) => r.event === "session_start"), "start");
      await command(s, `/probe-spawn ${FRESH} CHILD-TASK nothing before me`);
      await s.waitFor(() => forkRequests(fixture).length === 1, "fork request");
      expect(s.probeRecords().some((r) => r.event === "spawn:error")).toBe(false);
      const fork = forkRequests(fixture)[0] as RecordedRequest;
      expect(messages(fork).filter((m) => m.role === "user")).toHaveLength(1);
    },
    TIMEOUT,
  );
});
