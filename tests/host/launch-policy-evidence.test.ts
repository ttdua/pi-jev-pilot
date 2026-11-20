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
import { executorDir, startHostSession, type HostSession } from "./harness";
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
const lastIsUser = (r: RecordedRequest, text: string): boolean => {
  const last = messages(r).at(-1);
  return last?.role === "user" && JSON.stringify(last).includes(text);
};
const isChild = (r: RecordedRequest): boolean => lastIsUser(r, "CHILD-TASK");
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

function choice(pick: string, options: string[]): object {
  const probabilities: Record<string, number> = {};
  for (const o of options) probabilities[o] = o === pick ? 0.9 : 0.1 / (options.length - 1);
  return { type: "choice", choice: pick, probabilities, confidence: 0.9 };
}

/** Answers every asked question: route `fast`/`medium`. */
function answersFor(): FixtureRoute {
  return {
    json: {
      answers: {
        effort: choice("medium", ["low", "medium", "high", "xhigh", "max"]),
        risky: { type: "noul", noul: 0.2 },
        tier: choice("fast", ["fast", "balanced"]),
      },
    },
  };
}

async function newJev(route: FixtureRoute): Promise<JevFixture> {
  const j = await startJevFixture({ "/classify": route });
  jevs.push(j);
  return j;
}
const answering = (): FixtureRoute => answersFor();

function jevConfig(jev: JevFixture): Record<string, unknown> {
  return {
    classifier: { url: jev.url("/classify"), timeoutMs: 5000 },
    tiers: { fast: "fixture/fixture-fast", balanced: "fixture/fixture-balanced" },
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
    installs: [executorDir(), REPO_ROOT_SOURCE, PROBE_SOURCE],
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

const POLICY_EXPERT = { adjustment: { model: "fixture/fixture-expert", thinking: "max" } };

// ---- jev-pilot through the installed checkout ----

describe("jev-pilot launch policy through the installed checkout", () => {
  test(
    "Registered at session start and re-registered after reload",
    async () => {
      const jev = await newJev(answering());
      const { fixture, session: s } = await jevSession({
        config: jevConfig(jev),
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
        config: jevConfig(jev),
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
      const jev = await newJev(answering());
      const probe = { name: "ls", arguments: {} };
      const { fixture, session: s } = await jevSession({
        config: jevConfig(jev),
        script: [
          ...childScript([probe, probe, probe]),
          ...mainScript("START-MAIN", [launch(OPEN)]),
        ],
      });
      await s.prompt("START-MAIN");
      await s.waitFor(() => workerLines(s).length >= 1, "worker line");
      const lines = strictLedger(s).filter((e) => e["kind"] === "worker");
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ status: "completed", toolUses: 3 });
      expect(fixture.unmatched).toEqual([]);
    },
    TIMEOUT,
  );
});

// ---- End to end ----

describe("e2e", () => {
  test(
    "one session: routed tool launch, service spawn, /jev and a clean ledger",
    async () => {
      const jev = await newJev(answering());
      const { fixture, session: s } = await jevSession({
        config: jevConfig(jev),
        env: probePolicy(POLICY_EXPERT),
        script: [
          ...childScript([]),
          ...mainScript("START-MAIN", [launch(OPEN, { model: "fixture/fixture-main" })]),
        ],
      });
      await s.prompt("START-MAIN");
      await s.waitFor(() => workerLines(s).length >= 1, "tool launch line");
      await command(s, `/probe-spawn ${OPEN} CHILD-TASK service ${MARKER}`);
      await s.waitFor(() => workerLines(s).length >= 2, "service launch line");
      const text = await status(s);
      expect(text).toContain("executor: @ttdua/pi-subagents");
      expect(text).not.toContain(SLOT_TAKEN);

      const children = fixture.requests.filter(isChild);
      expect(children.map((c) => c.model)).toEqual(["fixture-fast", "fixture-fast"]);

      const all = strictLedger(s);
      const lines = all.filter((e) => e["kind"] === "worker");
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        expect(line).toMatchObject({
          tier: "fast",
          status: "completed",
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
