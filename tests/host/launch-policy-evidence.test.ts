// Host evidence for the executor launch policy (spec `host-seam-evidence`, "Launch policy host
// evidence"), jev-pilot's use of it through an installed checkout, and one end-to-end session.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startJevFixture, type FixtureRoute, type JevFixture } from "../jev/fixture";
import { tempDir } from "../helpers";
import { readLedger } from "../../src/store/ledger.ts";
import { validateLedgerEntry } from "../../src/store/ledger-schema.ts";
import { SLOT_TAKEN } from "../../src/host/worker/routing.ts";
import { startFixture, type Fixture, type RecordedRequest, type ScriptEntry } from "./fixture";
import { startHostSession, type HostSession, type InstallMode } from "./harness";
import { command, notifies } from "./rpc-helpers";

const fixtures: Fixture[] = [];
const jevs: JevFixture[] = [];
const sessions: HostSession[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const s of sessions.splice(0)) await s.close();
  for (const f of fixtures.splice(0)) await f.stop();
  for (const j of jevs.splice(0)) await j.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const TIMEOUT = 90_000;
const MARKER = "JEV-MARKER-4e2b";
const PROBE_TOOL = "probe_tool";
const PROBE_TOOL_TEXT = "PROBE-TOOL-OK";

const WORKER = "probe-worker";
const OPEN = "probe-open";
const LOCKED = "probe-locked";
const DENIED = "probe-denied";
const AGENTS = {
  [WORKER]: "---\ndescription: Probe worker\ntools: read, grep\n---\nYou are a probe worker.\n",
  [OPEN]: "---\ndescription: Open probe\n---\nYou are an open probe worker.\n",
  [LOCKED]:
    "---\ndescription: Locked probe\ntools: read, grep\nmodel: fixture/fixture-main\nlocked: model\n---\nYou are a locked probe worker.\n",
  [DENIED]: `---\ndescription: Denied probe\ndisallowed_tools: ${PROBE_TOOL}\n---\nYou are a denied probe worker.\n`,
};

// ---- Provider fixture script ----

type Msg = { role?: string; content?: unknown };
const messages = (r: RecordedRequest): Msg[] =>
  Array.isArray(r.body.messages) ? (r.body.messages as Msg[]) : [];
const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((p) => (p as { text?: string }).text ?? "").join("\n")
      : "";
const lastIsUser = (r: RecordedRequest, text: string): boolean => {
  const last = messages(r).at(-1);
  return last?.role === "user" && JSON.stringify(last).includes(text);
};
const hasTool = (r: RecordedRequest): boolean => messages(r).some((m) => m.role === "tool");
const isChild = (r: RecordedRequest): boolean => lastIsUser(r, "CHILD-TASK");
const isResumeChild = (r: RecordedRequest): boolean => lastIsUser(r, "RESUME-TASK");
/** A child request after a tool result: its first user message is the brief (the main's is not). */
const isChildAfterTool = (r: RecordedRequest): boolean =>
  messages(r).at(-1)?.role === "tool" &&
  JSON.stringify(messages(r).find((m) => m.role === "user")).includes("CHILD-TASK");
const isMainPrompt = (r: RecordedRequest, prompt: string): boolean =>
  r.model === "fixture-main" && lastIsUser(r, prompt);

type Call = { name: string; arguments: Record<string, unknown> };
const subagent = (args: Record<string, unknown>): Call => ({ name: "subagent", arguments: args });
const CALLER = { model: "fixture/fixture-balanced", thinking: "low" };
const launch = (type: string, extra: Record<string, unknown> = {}): Call =>
  subagent({
    prompt: `CHILD-TASK do the work ${MARKER}`,
    description: "probe",
    subagent_type: type,
    ...CALLER,
    ...extra,
  });

/** The child's first request calls `calls` in order, one per request, then answers in text. */
function childScript(calls: Call[]): ScriptEntry[] {
  const steps = calls.map((call, i): ScriptEntry => ({
    name: `child-call-${i}`,
    match: (r) =>
      (i === 0 ? isChild(r) : isChildAfterTool(r)) &&
      messages(r).filter((m) => m.role === "tool").length === i,
    reply: { toolCalls: [call] },
  }));
  return [
    ...steps,
    { name: "child-after", match: isChildAfterTool, reply: { text: "child done" } },
    { name: "child", match: isChild, reply: { text: "child done" } },
  ];
}

/** Main prompt `prompt` launches `calls` once; later main requests answer in text. */
function mainScript(prompt: string, calls: Call[]): ScriptEntry[] {
  return [
    {
      name: `main-call-${prompt}`,
      match: (r) => isMainPrompt(r, prompt),
      reply: { toolCalls: calls },
      times: 1,
    },
  ];
}
const MAIN_AFTER: ScriptEntry = {
  name: "main-after",
  match: (r) => r.model === "fixture-main",
  reply: { text: "done" },
};

const childOf = (f: Fixture): RecordedRequest | undefined => f.requests.find(isChild);

// ---- Policy probe ----

type ProbePolicy = {
  adjustment?: Record<string, unknown>;
  delayMs?: number;
  timeoutMs?: number;
};

/** Writes the probe policy's script and returns the env that names it. */
function probePolicy(policy: ProbePolicy): Record<string, string> {
  const dir = tempDir("jev-policy-probe-");
  dirs.push(dir);
  const file = join(dir, "policy.json");
  writeFileSync(file, JSON.stringify(policy));
  return { JEV_POLICY_FILE: file };
}

const records = (s: HostSession, event: string) =>
  s.probeRecords().filter((r) => r.probe === "policy" && r.event === event);

// ---- Jev fixture ----

type JevBody = { state?: { task?: unknown }; questions?: Record<string, unknown> };
const parse = (body: string): JevBody => {
  try {
    return JSON.parse(body) as JevBody;
  } catch {
    return {};
  }
};
const isToolKey = (k: string): boolean => k.startsWith("tool::") || k.startsWith("grant::");
const isToolRequest = (body: string): boolean =>
  Object.keys(parse(body).questions ?? {}).some(isToolKey);
const toolRequests = (j: JevFixture) => j.requests.filter((r) => isToolRequest(r.body));

function choice(pick: string, options: string[]): object {
  const probabilities: Record<string, number> = {};
  for (const o of options) probabilities[o] = o === pick ? 0.9 : 0.1 / (options.length - 1);
  return { type: "choice", choice: pick, probabilities, confidence: 0.9 };
}

/** Answers every asked question: route `fast`/`medium`, flag `flag`, grant `grant`. */
function answersFor(body: string, opts: { flag?: string; grant?: string }): FixtureRoute {
  const answers: Record<string, object> = {
    effort: choice("medium", ["low", "medium", "high", "xhigh", "max"]),
    risky: { type: "noul", noul: 0.2 },
    tier: choice("fast", ["fast", "balanced"]),
  };
  for (const key of Object.keys(parse(body).questions ?? {})) {
    if (key.startsWith("tool::")) {
      answers[key] = { type: "noul", noul: key === `tool::${opts.flag}` ? 0.9 : 0.1 };
    } else if (key.startsWith("grant::")) {
      answers[key] = { type: "noul", noul: key === `grant::${opts.grant}` ? 0.9 : 0.1 };
    }
  }
  return { json: { answers } };
}

/** One shared timeline of fixture events, in the order the fixtures saw them. */
type Timeline = string[];

type Gate = { release(): void; route: FixtureRoute };

/**
 * Holds every tool assessment request until `release`; other requests are answered at once.
 * `jev:tool-answered` is logged when the held answer is handed to the server, before it is sent.
 */
function heldToolRoute(opts: { flag?: string }, log: Timeline): Gate {
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const route: FixtureRoute = {
    each: (body) => {
      if (!isToolRequest(body)) return answersFor(body, opts);
      log.push("jev:tool-request");
      return {
        held: gate.then(() => {
          log.push("jev:tool-answered");
          return answersFor(body, opts);
        }),
      };
    },
  };
  return { release: () => release(), route };
}

/** Logs `provider:child` when the provider fixture sees the child's first request. */
function loggedChild(log: Timeline): ScriptEntry {
  return {
    name: "child-logged",
    match: (r) => isChild(r) && (log.push("provider:child"), false),
    reply: { text: "never" },
  };
}

async function newJev(route: FixtureRoute): Promise<JevFixture> {
  const j = await startJevFixture({ "/classify": route });
  jevs.push(j);
  return j;
}
const answering = (opts: { flag?: string; grant?: string } = {}): FixtureRoute => ({
  each: (body) => answersFor(body, opts),
});

function jevConfig(jev: JevFixture, enforce: boolean): Record<string, unknown> {
  return {
    classifier: { url: jev.url("/classify"), timeoutMs: 5000 },
    tiers: { fast: "fixture/fixture-fast", balanced: "fixture/fixture-balanced" },
    ...(enforce ? { tools: { mode: "enforce" } } : {}),
  };
}

/** Jev config written before the session starts, so the harness keeps it. */
function agentDirWith(config: Record<string, unknown>, state?: Record<string, unknown>): string {
  const dir = tempDir("jev-policy-agent-");
  dirs.push(dir);
  mkdirSync(join(dir, "jev"), { recursive: true });
  writeFileSync(join(dir, "jev", "config.json"), JSON.stringify(config));
  if (state !== undefined) writeFileSync(join(dir, "jev", "state.json"), JSON.stringify(state));
  return dir;
}

// ---- Sessions ----

async function session(opts: {
  script: ScriptEntry[];
  install: InstallMode;
  env?: Record<string, string>;
  agentDir?: string;
}): Promise<{ fixture: Fixture; session: HostSession }> {
  const fixture = await startFixture([...opts.script, MAIN_AFTER]);
  fixtures.push(fixture);
  const s = await startHostSession({
    fixture,
    install: opts.install,
    probes: opts.agentDir === undefined ? ["policy"] : [],
    agentDir: opts.agentDir,
    agents: AGENTS,
    env: { TYPESAFE_API_KEY: "test-key", ...opts.env },
    timeoutMs: 60_000,
  });
  sessions.push(s);
  return { fixture, session: s };
}

/**
 * A checkout session with Jev config in place before start. The harness installs probes only
 * into an agent directory it creates, so the probe is installed here as a package path.
 */
async function jevSession(opts: {
  script: ScriptEntry[];
  config: Record<string, unknown>;
  state?: Record<string, unknown>;
  env?: Record<string, string>;
}): Promise<{ fixture: Fixture; session: HostSession }> {
  const agentDir = agentDirWith(opts.config, opts.state);
  const fixture = await startFixture([...opts.script, MAIN_AFTER]);
  fixtures.push(fixture);
  const s = await startHostSession({
    fixture,
    installs: [REPO_ROOT_SOURCE, PROBE_SOURCE],
    agentDir,
    agents: AGENTS,
    env: { TYPESAFE_API_KEY: "test-key", ...opts.env },
    timeoutMs: 60_000,
  });
  sessions.push(s);
  return { fixture, session: s };
}

const REPO_ROOT_SOURCE = join(import.meta.dir, "..", "..");
const PROBE_SOURCE = join(import.meta.dir, "probes", "policy");

const ledger = (s: HostSession): Record<string, unknown>[] => {
  const r = readLedger(join(s.agentDir, "jev"));
  return r.kind === "ok" ? (r.entries as unknown as Record<string, unknown>[]) : [];
};

/**
 * Every raw line of both ledger segments, parsed and validated: unlike `readLedger`, which drops
 * a bad line and counts it, any torn, unparsable or invalid line fails the test.
 */
function strictLedger(s: HostSession): Record<string, unknown>[] {
  const dir = join(s.agentDir, "jev");
  const read = readLedger(dir);
  expect(read.kind).toBe("ok");
  expect(read.kind === "ok" ? read.skipped : -1, "ledger lines skipped").toBe(0);
  const out: Record<string, unknown>[] = [];
  for (const file of LEDGER_FILES) {
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    if (text === "") continue;
    expect(text.endsWith("\n"), `${file} ends with a newline`).toBe(true);
    for (const raw of text.slice(0, -1).split("\n")) {
      const value = JSON.parse(raw) as Record<string, unknown>;
      const checked = validateLedgerEntry(value);
      expect(checked.ok ? [] : checked.issues, `${file} line valid`).toEqual([]);
      out.push(value);
    }
  }
  return out;
}
const LEDGER_FILES = ["ledger.1.jsonl", "ledger.jsonl"];
const workerLines = (s: HostSession): Record<string, unknown>[] =>
  ledger(s).filter((e) => e["kind"] === "worker");

async function status(s: HostSession): Promise<string> {
  const before = notifies(s).length;
  await command(s, "/jev");
  await s.waitFor(() => notifies(s).length > before, "status notify");
  return notifies(s)[before]?.message ?? "";
}

async function reload(s: HostSession): Promise<void> {
  const before = records(s, "session_start").length;
  await command(s, "/probe-reload");
  await s.waitFor(() => records(s, "session_start").length > before, "session_start after reload");
}

const toolResult = (r: RecordedRequest | undefined): string =>
  textOf(
    messages(r ?? ({ body: {} } as RecordedRequest))
      .filter((m) => m.role === "tool")
      .at(-1)?.content,
  );

// ---- Seam evidence: the vendored executor alone, with the probe policy ----

const POLICY_FAST = { adjustment: { model: "fixture/fixture-fast", thinking: "medium" } };
// For checkout sessions: a child on `fixture-expert` would mean the probe, not jev-pilot, held the slot.
const POLICY_EXPERT = { adjustment: { model: "fixture/fixture-expert", thinking: "max" } };

describe("launch policy seam evidence", () => {
  test(
    "Policy model reaches the child: foreground",
    async () => {
      const { fixture, session: s } = await session({
        install: "executor-only",
        env: probePolicy(POLICY_FAST),
        script: [...childScript([]), ...mainScript("START-MAIN", [launch(WORKER)])],
      });
      await s.prompt("START-MAIN");
      await s.waitFor(() => childOf(fixture) !== undefined, "child request");
      expect(childOf(fixture)?.model).toBe("fixture-fast");
      expect(childOf(fixture)?.reasoningEffort).toBe("medium");
      expect(records(s, "policy:call")[0]?.data).toMatchObject({ origin: "tool", bg: false });
      expect(fixture.unmatched).toEqual([]);
    },
    TIMEOUT,
  );

  test(
    "Policy model reaches the child: background",
    async () => {
      const { fixture, session: s } = await session({
        install: "executor-only",
        env: probePolicy(POLICY_FAST),
        script: [
          ...childScript([]),
          ...mainScript("START-MAIN", [launch(WORKER, { run_in_background: true })]),
        ],
      });
      await s.prompt("START-MAIN");
      await s.waitFor(() => childOf(fixture) !== undefined, "child request");
      expect(childOf(fixture)?.model).toBe("fixture-fast");
      expect(childOf(fixture)?.reasoningEffort).toBe("medium");
      expect(records(s, "policy:call")[0]?.data).toMatchObject({ origin: "tool", bg: true });
    },
    TIMEOUT,
  );

  test(
    "Policy model reaches the child: service launch",
    async () => {
      const { fixture, session: s } = await session({
        install: "executor-only",
        env: probePolicy(POLICY_FAST),
        script: childScript([]),
      });
      await command(s, `/probe-spawn ${WORKER} CHILD-TASK service ${MARKER}`);
      await s.waitFor(() => childOf(fixture) !== undefined, "child request");
      expect(records(s, "spawn")).toHaveLength(1);
      expect(childOf(fixture)?.model).toBe("fixture-fast");
      expect(childOf(fixture)?.reasoningEffort).toBe("medium");
      expect(records(s, "policy:call")[0]?.data).toMatchObject({ origin: "service" });
    },
    TIMEOUT,
  );

  test(
    "Inherited context with a policy model",
    async () => {
      const { fixture, session: s } = await session({
        install: "executor-only",
        env: probePolicy(POLICY_FAST),
        script: [
          ...childScript([]),
          ...mainScript(`START-MAIN ${MARKER}`, [launch(WORKER, { inherit_context: true })]),
        ],
      });
      await s.prompt(`START-MAIN ${MARKER}`);
      await s.waitFor(() => childOf(fixture) !== undefined, "child request");
      const child = childOf(fixture);
      expect(child?.model).toBe("fixture-fast");
      expect(child?.reasoningEffort).toBe("medium");
      // The parent's prompt reached the child through the inherited context.
      expect(JSON.stringify(child?.body.messages).includes(`START-MAIN ${MARKER}`)).toBe(true);
      expect(records(s, "policy:call")[0]?.data).toMatchObject({ inherit: true });
      expect(JSON.stringify(s.probeRecords())).not.toContain(MARKER);
    },
    TIMEOUT,
  );

  test(
    "Locked field wins over the policy",
    async () => {
      const { fixture, session: s } = await session({
        install: "executor-only",
        env: probePolicy(POLICY_FAST),
        script: [...childScript([]), ...mainScript("START-MAIN", [launch(LOCKED)])],
      });
      await s.prompt("START-MAIN");
      await s.waitFor(() => childOf(fixture) !== undefined, "child request");
      // `locked: model` keeps the agent's model; thinking is not locked and follows the policy.
      expect(childOf(fixture)?.model).toBe("fixture-main");
      expect(childOf(fixture)?.reasoningEffort).toBe("medium");
    },
    TIMEOUT,
  );

  test(
    "Policy past its timeout: the launch runs with the requested values",
    async () => {
      const { fixture, session: s } = await session({
        install: "executor-only",
        env: probePolicy({ ...POLICY_FAST, timeoutMs: 300, delayMs: 20_000 }),
        script: [...childScript([]), ...mainScript("START-MAIN", [launch(WORKER)])],
      });
      await s.prompt("START-MAIN");
      await s.waitFor(() => childOf(fixture) !== undefined, "child request");
      expect(childOf(fixture)?.model).toBe("fixture-balanced");
      expect(childOf(fixture)?.reasoningEffort).toBe("low");
      // The watchdog aborted the policy's signal; the 20 s delay never ran out.
      await s.waitFor(() => records(s, "policy:aborted").length === 1, "policy aborted");
    },
    TIMEOUT,
  );

  test(
    "Grant reaches the child",
    async () => {
      const { fixture, session: s } = await session({
        install: "executor-only",
        env: probePolicy({ adjustment: { addTools: [PROBE_TOOL] } }),
        script: [
          ...childScript([{ name: PROBE_TOOL, arguments: {} }]),
          ...mainScript("START-MAIN", [launch(OPEN)]),
        ],
      });
      await s.prompt("START-MAIN");
      await s.waitFor(() => fixture.requests.some(isChildAfterTool), "child after tool");
      expect(childOf(fixture)?.toolNames).toContain(PROBE_TOOL);
      expect(toolResult(fixture.requests.find(isChildAfterTool))).toContain(PROBE_TOOL_TEXT);
      expect(records(s, "tool:executed")).toHaveLength(1);
      expect(records(s, "child:bound").some((r) => r.data?.["granted"] === true)).toBe(true);
    },
    TIMEOUT,
  );

  test(
    "disallowed_tools wins over a grant",
    async () => {
      const { fixture, session: s } = await session({
        install: "executor-only",
        env: probePolicy({ adjustment: { addTools: [PROBE_TOOL] } }),
        script: [...childScript([]), ...mainScript("START-MAIN", [launch(DENIED)])],
      });
      await s.prompt("START-MAIN");
      await s.waitFor(() => childOf(fixture) !== undefined, "child request");
      expect(childOf(fixture)?.toolNames).not.toContain(PROBE_TOOL);
      expect(childOf(fixture)?.toolNames).toContain("read");
    },
    TIMEOUT,
  );

  test(
    "Published before capture and found at load, on start and after reload",
    async () => {
      const { fixture, session: s } = await session({
        install: "executor-only",
        env: probePolicy(POLICY_FAST),
        script: [
          ...childScript([]),
          ...mainScript("START-AFTER-RELOAD", [launch(WORKER, { description: "after reload" })]),
        ],
      });
      await s.waitFor(() => records(s, "session_start").length >= 1, "session_start");
      await reload(s);
      // Load-time consumer finds the service: once per load.
      expect(records(s, "load").map((r) => r.data?.["service"])).toEqual([true, true]);
      expect(records(s, "session_start").map((r) => r.data)).toEqual([
        { reason: "startup", service: true },
        { reason: "reload", service: true },
      ]);
      expect(records(s, "policy:registered")).toHaveLength(2);
      expect(records(s, "policy:taken")).toHaveLength(0);
      await s.prompt("START-AFTER-RELOAD");
      await s.waitFor(() => childOf(fixture) !== undefined, "child request");
      expect(childOf(fixture)?.model).toBe("fixture-fast");
      expect(records(s, "policy:call")).toHaveLength(1);
    },
    TIMEOUT,
  );
});

// ---- jev-pilot through the installed checkout ----

describe("jev-pilot launch policy through the installed checkout", () => {
  test(
    "Registered at session start and re-registered after reload",
    async () => {
      const jev = await newJev(answering());
      const { fixture, session: s } = await jevSession({
        config: jevConfig(jev, false),
        env: probePolicy(POLICY_EXPERT),
        script: [
          ...childScript([]),
          ...mainScript("START-ONE", [launch(WORKER, { description: "one" })]),
          ...mainScript("START-TWO", [launch(WORKER, { description: "two" })]),
        ],
      });
      await s.waitFor(() => records(s, "session_start").length >= 1, "session_start");
      // jev-pilot loads before the probe and holds the one slot: the probe is refused.
      expect(records(s, "policy:taken")).toHaveLength(1);
      expect(await status(s)).not.toContain(SLOT_TAKEN);
      await s.prompt("START-ONE");
      await s.waitFor(() => workerLines(s).length >= 1, "first worker line");
      await reload(s);
      // After reload jev-pilot registered again (the old policy was unregistered first).
      expect(records(s, "policy:taken")).toHaveLength(2);
      expect(records(s, "policy:registered")).toHaveLength(0);
      expect(await status(s)).not.toContain(SLOT_TAKEN);
      await s.prompt("START-TWO");
      await s.waitFor(() => workerLines(s).length >= 2, "second worker line");
      const children = fixture.requests.filter(isChild);
      expect(children.map((c) => c.model)).toEqual(["fixture-fast", "fixture-fast"]);
      expect(workerLines(s).map((l) => l["tier"])).toEqual(["fast", "fast"]);
      expect(fixture.unmatched).toEqual([]);
    },
    TIMEOUT,
  );

  test.each([
    ["foreground", false],
    ["background", true],
  ] as const)(
    "Caller model replaced (%s); the ledger's effective model equals the child's first request",
    async (_kind, background) => {
      const jev = await newJev(answering());
      const extra = { model: "fixture/fixture-main", run_in_background: background };
      const { fixture, session: s } = await jevSession({
        config: jevConfig(jev, false),
        script: [...childScript([]), ...mainScript("START-MAIN", [launch(WORKER, extra)])],
      });
      await s.prompt("START-MAIN");
      await s.waitFor(() => workerLines(s).length >= 1, "worker line");
      const child = childOf(fixture);
      expect(child?.model).toBe("fixture-fast");
      expect(child?.reasoningEffort).toBe("medium");
      expect(workerLines(s)[0]).toMatchObject({
        callerModel: "fixture/fixture-main",
        effectiveModel: `fixture/${child?.model}`,
        effectiveThinking: child?.reasoningEffort,
        status: "completed",
      });
    },
    TIMEOUT,
  );

  test(
    "Foreground completion: one completed line with toolUses 3",
    async () => {
      const jev = await newJev(answering({ grant: PROBE_TOOL }));
      const probe = { name: PROBE_TOOL, arguments: {} };
      const { fixture, session: s } = await jevSession({
        config: jevConfig(jev, true),
        script: [
          ...childScript([probe, probe, probe]),
          ...mainScript("START-MAIN", [launch(OPEN)]),
        ],
      });
      await s.prompt("START-MAIN");
      await s.waitFor(() => workerLines(s).length >= 1, "worker line");
      expect(records(s, "tool:executed")).toHaveLength(3);
      const lines = strictLedger(s).filter((e) => e["kind"] === "worker");
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ status: "completed", toolUses: 3 });
      expect(fixture.unmatched).toEqual([]);
    },
    TIMEOUT,
  );

  test(
    "Enforce removes",
    async () => {
      const jev = await newJev(answering({ flag: "edit" }));
      const edit = { name: "edit", arguments: { path: "x.txt", edits: [] } };
      const { fixture, session: s } = await jevSession({
        config: jevConfig(jev, true),
        script: [...childScript([edit]), ...mainScript("START-MAIN", [launch(OPEN)])],
      });
      await s.prompt("START-MAIN");
      await s.waitFor(() => workerLines(s).length >= 1, "worker line");
      const child = fixture.requests.filter((r) => isChild(r) || isChildAfterTool(r));
      expect(child.length).toBe(2);
      for (const r of child) expect(r.toolNames).not.toContain("edit");
      expect(toolResult(child[1])).toMatch(/not found/i);
      expect(workerLines(s)[0]).toMatchObject({ toolsFlagged: 1 });
    },
    TIMEOUT,
  );

  test(
    "Enforce grants",
    async () => {
      const jev = await newJev(answering({ grant: PROBE_TOOL }));
      const { fixture, session: s } = await jevSession({
        config: jevConfig(jev, true),
        script: [
          ...childScript([{ name: PROBE_TOOL, arguments: {} }]),
          ...mainScript("START-MAIN", [launch(OPEN)]),
        ],
      });
      await s.prompt("START-MAIN");
      await s.waitFor(() => workerLines(s).length >= 1, "worker line");
      expect(Object.keys(parse(toolRequests(jev)[0]?.body ?? "").questions ?? {})).toContain(
        `grant::${PROBE_TOOL}`,
      );
      expect(childOf(fixture)?.toolNames).toContain(PROBE_TOOL);
      expect(toolResult(fixture.requests.find(isChildAfterTool))).toContain(PROBE_TOOL_TEXT);
      expect(workerLines(s)[0]).toMatchObject({ toolsGranted: 1 });
    },
    TIMEOUT,
  );

  test.each([
    ["observe", false],
    ["enforce", true],
  ] as const)(
    "Slow answer in %s: the child's first request follows the tool answer",
    async (_mode, enforce) => {
      const log: Timeline = [];
      const gate = heldToolRoute({ flag: "edit" }, log);
      const jev = await newJev(gate.route);
      const { fixture, session: s } = await jevSession({
        config: jevConfig(jev, enforce),
        script: [loggedChild(log), ...childScript([]), ...mainScript("START-MAIN", [launch(OPEN)])],
      });
      const prompted = s.prompt("START-MAIN");
      await s.waitFor(() => log.includes("jev:tool-request"), "tool request");
      gate.release();
      await prompted;
      await s.waitFor(() => log.includes("provider:child"), "child request");
      expect(log).toEqual(["jev:tool-request", "jev:tool-answered", "provider:child"]);
      if (enforce) expect(childOf(fixture)?.toolNames).not.toContain("edit");
      else expect(childOf(fixture)?.toolNames).toContain("edit");
    },
    TIMEOUT,
  );

  test(
    "Ordering control: with tool assessment off, the child starts while a held answer waits",
    async () => {
      // Positive control for the timeline: the same held route, but nothing awaits it, so the
      // child request is logged before the release. Shows the timeline can record either order.
      const log: Timeline = [];
      const gate = heldToolRoute({ flag: "edit" }, log);
      const jev = await newJev(gate.route);
      const { session: s } = await jevSession({
        config: jevConfig(jev, false),
        state: { version: 1, switches: { tools: false } },
        script: [loggedChild(log), ...childScript([]), ...mainScript("START-MAIN", [launch(OPEN)])],
      });
      await s.prompt("START-MAIN");
      await s.waitFor(() => log.includes("provider:child"), "child request");
      gate.release();
      log.push("test:released");
      expect(log).toEqual(["provider:child", "test:released"]);
      expect(toolRequests(jev)).toHaveLength(0);
    },
    TIMEOUT,
  );

  test(
    "Resumed worker is not reassessed",
    async () => {
      const jev = await newJev(answering({ flag: "edit" }));
      const resume: ScriptEntry = {
        name: "main-resume",
        match: (r) => r.model === "fixture-main" && hasTool(r),
        reply: (r) => {
          const id = /Agent ID: (\S+)/.exec(toolResult(r))?.[1] ?? "missing";
          return {
            toolCalls: [
              subagent({
                prompt: "RESUME-TASK go on",
                description: "resume",
                subagent_type: OPEN,
                resume: id,
              }),
            ],
          };
        },
        times: 1,
      };
      const { fixture, session: s } = await jevSession({
        config: jevConfig(jev, true),
        script: [
          { name: "resume-child", match: isResumeChild, reply: { text: "resumed done" } },
          ...childScript([]),
          ...mainScript("START-MAIN", [launch(OPEN)]),
          resume,
        ],
      });
      await s.prompt("START-MAIN");
      await s.waitFor(() => fixture.requests.some(isResumeChild), "resumed child request");
      expect(toolRequests(jev)).toHaveLength(1);
      expect(fixture.requests.find(isResumeChild)?.toolNames).not.toContain("edit");
      expect(childOf(fixture)?.toolNames).not.toContain("edit");
    },
    TIMEOUT,
  );

  test(
    "Jev down in enforce keeps the default tools",
    async () => {
      const script = [...childScript([]), ...mainScript("START-MAIN", [launch(OPEN)])];
      const off = await newJev(answering());
      const reference = await jevSession({
        config: jevConfig(off, true),
        state: { version: 1, switches: { tools: false } },
        script,
      });
      await reference.session.prompt("START-MAIN");
      await reference.session.waitFor(() => childOf(reference.fixture) !== undefined, "child");
      const down = await newJev({ status: 500 });
      const run = await jevSession({ config: jevConfig(down, true), script });
      await run.session.prompt("START-MAIN");
      await run.session.waitFor(() => childOf(run.fixture) !== undefined, "child");
      expect(toolRequests(down)).toHaveLength(1);
      const tools = (f: Fixture): string[] => [...(childOf(f)?.toolNames ?? [])].sort();
      expect(tools(run.fixture).length).toBeGreaterThan(0);
      expect(tools(run.fixture)).toEqual(tools(reference.fixture));
      expect(tools(run.fixture)).not.toContain(PROBE_TOOL);
    },
    TIMEOUT,
  );
});

// ---- End to end ----

describe("e2e", () => {
  test(
    "one session: routed tool launch, service spawn, enforce grant, /jev and a clean ledger",
    async () => {
      const jev = await newJev(answering({ grant: PROBE_TOOL }));
      const { fixture, session: s } = await jevSession({
        config: jevConfig(jev, true),
        env: probePolicy(POLICY_EXPERT),
        script: [
          ...childScript([{ name: PROBE_TOOL, arguments: {} }]),
          ...mainScript("START-MAIN", [launch(OPEN, { model: "fixture/fixture-main" })]),
        ],
      });
      await s.prompt("START-MAIN");
      await s.waitFor(() => workerLines(s).length >= 1, "tool launch line");
      await command(s, `/probe-spawn ${OPEN} CHILD-TASK service ${MARKER}`);
      await s.waitFor(() => workerLines(s).length >= 2, "service launch line");
      const text = await status(s);
      expect(text).toContain("executor: present");
      expect(text).not.toContain(SLOT_TAKEN);

      const children = fixture.requests.filter(isChild);
      expect(children.map((c) => c.model)).toEqual(["fixture-fast", "fixture-fast"]);
      for (const c of children) expect(c.toolNames).toContain(PROBE_TOOL);
      expect(records(s, "tool:executed")).toHaveLength(2);

      const all = strictLedger(s);
      const lines = all.filter((e) => e["kind"] === "worker");
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        expect(line).toMatchObject({
          tier: "fast",
          status: "completed",
          toolsGranted: 1,
          effectiveModel: "fixture/fixture-fast",
        });
      }
      // Positive control: the marker reached Jev, so its absence from the files is meaningful.
      expect(jev.requests.some((r) => r.body.includes(MARKER))).toBe(true);
      const dir = join(s.agentDir, "jev");
      for (const f of readdirSync(dir)) {
        expect(readFileSync(join(dir, f), "utf8")).not.toContain(MARKER);
      }
      expect(fixture.unmatched).toEqual([]);
    },
    TIMEOUT,
  );
});
