import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startJevFixture, type FixtureRoute, type JevFixture } from "../jev/fixture";
import { RUBRIC_VERSION } from "../../src/jev/rubrics.ts";
import { readLedger } from "../../src/store/ledger.ts";
import { startFixture, type Fixture, type RecordedRequest, type ScriptEntry } from "./fixture";
import { startHostSession, type HostSession } from "./harness";
import type { RpcEvent } from "./rpc";
import { notifies } from "./rpc-helpers";

const fixtures: Fixture[] = [];
const jevs: JevFixture[] = [];
const sessions: HostSession[] = [];

afterEach(async () => {
  for (const s of sessions.splice(0)) await s.close();
  for (const f of fixtures.splice(0)) await f.stop();
  for (const j of jevs.splice(0)) await j.stop();
});

const TIMEOUT = 90_000;
const MARKER = "JEV-MARKER-9c1d";
const AGENT = "probe-worker";
const AGENT_TEXT =
  "---\ndescription: Probe worker\ntools: read, grep\n---\nYou are a probe worker.\n";

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
const isChild = (r: RecordedRequest): boolean => lastIsUser(r, "CHILD-TASK");
const isResumeChild = (r: RecordedRequest): boolean => lastIsUser(r, "RESUME-TASK");
const hasTool = (r: RecordedRequest): boolean => messages(r).some((m) => m.role === "tool");
const isMainFirst = (r: RecordedRequest): boolean =>
  r.model === "fixture-main" &&
  !isChild(r) &&
  !isResumeChild(r) &&
  !hasTool(r) &&
  JSON.stringify(r.body.messages).includes("START-MAIN");

// Main-session effort (WG-07) asks Jev on every prompt; count worker requests only.
const workerRequests = (j: JevFixture): JevFixture["requests"] =>
  j.requests.filter((r) => {
    try {
      const parsed = JSON.parse(r.body) as { state?: { task?: unknown } };
      return parsed.state?.task !== undefined;
    } catch {
      // Counted, so a malformed body can never make a "no request" assertion pass.
      return true;
    }
  });

const CALLER = { model: "fixture/fixture-balanced", thinking: "low" };

function launch(extra: Record<string, unknown> = {}, brief = "CHILD-TASK do the work"): object {
  return { prompt: brief, description: "probe", subagent_type: AGENT, ...CALLER, ...extra };
}

/** Script: child replies first, then one main call, then plain main replies. */
function script(calls: { name: string; arguments: Record<string, unknown> }[]): ScriptEntry[] {
  return [
    { name: "child", match: isChild, reply: { text: "child done" } },
    { name: "main-call", match: isMainFirst, reply: { toolCalls: calls }, times: 1 },
    { name: "main-after", match: (r) => r.model === "fixture-main", reply: { text: "done" } },
  ];
}

const subagentCall = (args: object): { name: string; arguments: Record<string, unknown> } => ({
  name: "subagent",
  arguments: args as Record<string, unknown>,
});

function choice(pick: string, options: string[]): object {
  const probabilities: Record<string, number> = {};
  for (const o of options) probabilities[o] = o === pick ? 0.9 : 0.1 / (options.length - 1);
  return { type: "choice", choice: pick, probabilities, confidence: 0.9 };
}
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

function jevAnswers(opts: {
  tier?: string;
  tiers?: string[];
  effort?: string;
  probs?: Record<string, number>;
  turns?: Partial<Record<"short" | "medium" | "long" | "very_long", number>>;
}): FixtureRoute {
  const answers: Record<string, object> = {
    effort: choice(opts.effort ?? "medium", EFFORTS),
    risky: { type: "noul", noul: 0.2 },
  };
  if (opts.turns !== undefined) {
    const probabilities = { short: 0, medium: 0, long: 0, very_long: 0, ...opts.turns };
    const [pick = "short"] = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0] ?? [];
    answers["turns"] = { type: "choice", choice: pick, probabilities, confidence: 0.9 };
  }
  if (opts.tier !== undefined) {
    answers["tier"] =
      opts.probs === undefined
        ? choice(opts.tier, opts.tiers ?? ["basic", "broad"])
        : { type: "choice", choice: opts.tier, probabilities: opts.probs, confidence: 0.5 };
  }
  if (opts.probs?.["frontier"] !== undefined)
    answers["expert_needed"] = { type: "noul", noul: 0.2 };
  return { json: { answers } };
}

async function newJev(route: FixtureRoute): Promise<JevFixture> {
  const j = await startJevFixture({ "/classify": route });
  jevs.push(j);
  return j;
}

/** Writes Jev config (and state) into the agent directory of a running session. */
function writeJev(
  agentDir: string,
  opts: { config: Record<string, unknown>; state?: Record<string, unknown> },
): void {
  const dir = join(agentDir, "jev");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify(opts.config));
  if (opts.state !== undefined) writeFileSync(join(dir, "state.json"), JSON.stringify(opts.state));
}

function config(
  jev: JevFixture,
  extra: {
    timeoutMs?: number;
    deep?: boolean;
    frontier?: boolean;
    forked?: "thinking" | "untouched";
    slotModel?: string;
  } = {},
): Record<string, unknown> {
  const tiers: Record<string, string> = {
    basic: "fixture/fixture-fast",
    broad: "fixture/fixture-balanced",
  };
  if (extra.deep) tiers["deep"] = "fixture2/fixture-deep";
  if (extra.frontier) tiers["frontier"] = "fixture/fixture-expert";
  return {
    classifier: { url: jev.url("/classify"), timeoutMs: extra.timeoutMs ?? 1500 },
    tiers,
    ...(extra.slotModel === undefined
      ? {}
      : { crew: { slots: [{ name: "reviewer", model: extra.slotModel, when: "Code review." }] } }),
    ...(extra.forked === undefined ? {} : { subagents: { forkLaunch: extra.forked } }),
  };
}

const SLOT = "slot::reviewer";
const slotAnswer = (effort: string): FixtureRoute =>
  jevAnswers({
    tier: SLOT,
    tiers: ["basic", "broad", SLOT],
    effort,
  });

const KEY = { TYPESAFE_API_KEY: "test-key" };

async function setup(
  script: ScriptEntry[],
  opts: {
    keyless?: boolean;
    env?: Record<string, string>;
    probes?: string[];
    persist?: boolean;
  } = {},
): Promise<{ fixture: Fixture; session: HostSession }> {
  const fixture = await startFixture(script);
  fixtures.push(fixture);
  const session = await startHostSession({
    fixture,
    probes: opts.probes ?? [],
    keyless: opts.keyless === true,
    agents: { [AGENT]: AGENT_TEXT },
    env: opts.env ?? KEY,
    timeoutMs: 60_000,
    ...(opts.persist === true ? { persist: true } : {}),
  });
  sessions.push(session);
  return { fixture, session };
}

const ledger = (s: HostSession): Record<string, unknown>[] => {
  const r = readLedger(join(s.agentDir, "jev"));
  return r.kind === "ok" ? (r.entries as unknown as Record<string, unknown>[]) : [];
};
const workerLines = (s: HostSession): Record<string, unknown>[] =>
  ledger(s).filter((e) => e["kind"] === "worker");

/** `turnBudget.maxTurns` of every `subagents:record` entry in the main session files. */
function recordedMaxTurns(s: HostSession): unknown[] {
  const out: unknown[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path);
      else if (e.name.endsWith(".jsonl")) {
        for (const l of readFileSync(path, "utf8").split("\n")) {
          let entry: { customType?: string; data?: { turnBudget?: { maxTurns?: unknown } } };
          try {
            entry = JSON.parse(l);
          } catch {
            continue;
          }
          if (entry.customType === "subagents:record") out.push(entry.data?.turnBudget?.maxTurns);
        }
      }
    }
  };
  const dir = join(s.agentDir, "sessions");
  if (existsSync(dir)) walk(dir);
  return out;
}

const childOf = (f: Fixture): RecordedRequest | undefined => f.requests.find(isChild);
const afterTool = (f: Fixture): boolean =>
  f.requests.some((r) => r.model === "fixture-main" && hasTool(r));

type Ui = RpcEvent & { method?: string; message?: string; notifyType?: string };
const warnings = (s: HostSession): Ui[] =>
  (s.events as Ui[]).filter(
    (e) => e.type === "extension_ui_request" && e.method === "notify" && e.notifyType === "warning",
  );

function jevFiles(s: HostSession): string[] {
  const dir = join(s.agentDir, "jev");
  return readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8"));
}

describe("worker routing through the real CLI", () => {
  test(
    "caller model replaced",
    async () => {
      const jev = await newJev(jevAnswers({ tier: "basic", effort: "medium" }));
      const { fixture, session } = await setup(
        script([subagentCall(launch({ model: "fixture/fixture-main" }))]),
      );
      writeJev(session.agentDir, { config: config(jev) });
      await session.prompt("START-MAIN");
      await session.waitFor(() => workerLines(session).length >= 1, "ledger line");
      const child = childOf(fixture);
      expect(child?.model).toBe("fixture-fast");
      expect(child?.reasoningEffort).toBe("medium");
      const lines = workerLines(session);
      expect(lines.length).toBe(1);
      expect(lines[0]).toMatchObject({
        tier: "basic",
        status: "completed",
        callerModel: "fixture/fixture-main",
      });
      expect(workerRequests(jev).length).toBe(1);
      expect(fixture.unmatched).toEqual([]);
    },
    TIMEOUT,
  );

  test(
    "background launch",
    async () => {
      const jev = await newJev(jevAnswers({ tier: "basic", effort: "medium" }));
      const { fixture, session } = await setup(
        script([subagentCall(launch({ model: "fixture/fixture-main", run_in_background: true }))]),
      );
      writeJev(session.agentDir, { config: config(jev) });
      await session.prompt("START-MAIN");
      await session.waitFor(() => workerLines(session).length >= 1, "ledger line");
      const child = childOf(fixture);
      expect(child?.model).toBe("fixture-fast");
      expect(child?.reasoningEffort).toBe("medium");
      expect(workerLines(session)[0]).toMatchObject({
        tier: "basic",
        status: "completed",
        callerModel: "fixture/fixture-main",
      });
    },
    TIMEOUT,
  );

  test(
    "resume untouched",
    async () => {
      const jev = await newJev(jevAnswers({ tier: "basic", effort: "medium" }));
      const entries: ScriptEntry[] = [
        { name: "resume-child", match: isResumeChild, reply: { text: "resumed done" } },
        { name: "child", match: isChild, reply: { text: "child done" } },
        {
          name: "main-call",
          match: isMainFirst,
          reply: { toolCalls: [subagentCall(launch())] },
          times: 1,
        },
        {
          name: "main-resume",
          match: (r) => r.model === "fixture-main" && hasTool(r) && !isChild(r),
          reply: (r) => {
            const tool = messages(r)
              .filter((m) => m.role === "tool")
              .at(-1);
            const id = /Agent ID: (\S+)/.exec(textOf(tool?.content))?.[1] ?? "missing";
            return {
              toolCalls: [
                subagentCall({
                  prompt: "RESUME-TASK continue",
                  description: "resume",
                  subagent_type: AGENT,
                  resume: id,
                }),
              ],
            };
          },
          times: 1,
        },
        { name: "main-after", match: (r) => r.model === "fixture-main", reply: { text: "done" } },
      ];
      const { fixture, session } = await setup(entries);
      writeJev(session.agentDir, { config: config(jev) });
      await session.prompt("START-MAIN");
      await session.waitFor(() => fixture.requests.some(isResumeChild), "resumed child request");
      await session.waitFor(
        () =>
          fixture.requests.some(
            (r) => r.model === "fixture-main" && JSON.stringify(r.body).includes("resumed done"),
          ),
        "main turn after the resume",
      );
      const first = childOf(fixture);
      const resumed = fixture.requests.find(isResumeChild);
      expect(first?.model).toBe("fixture-fast");
      expect(resumed?.model).toBe(first?.model as string);
      // A resume never reaches the launch policy: the first launch has a line, the resume none.
      const lines = workerLines(session);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ tier: "basic", status: "completed" });
      expect(workerRequests(jev).length).toBe(1);
      expect(fixture.unmatched).toEqual([]);
    },
    TIMEOUT,
  );

  test(
    "forked launch left alone",
    async () => {
      const jev = await newJev(jevAnswers({ tier: "basic" }));
      const { fixture, session } = await setup(script([subagentCall(launch({ context: "fork" }))]));
      writeJev(session.agentDir, { config: config(jev, { forked: "untouched" }) });
      await session.prompt("START-MAIN");
      await session.waitFor(() => workerLines(session).length >= 1, "ledger line");
      const child = childOf(fixture);
      expect(child?.model).toBe("fixture-balanced");
      expect(child?.reasoningEffort).toBe("low");
      expect(workerRequests(jev).length).toBe(0);
      expect(workerLines(session)[0]).toMatchObject({ reason: "untouched", answered: false });
    },
    TIMEOUT,
  );

  test(
    "forked launch with thinking",
    async () => {
      const jev = await newJev(jevAnswers({ effort: "high" }));
      const { fixture, session } = await setup(script([subagentCall(launch({ context: "fork" }))]));
      writeJev(session.agentDir, { config: config(jev, { forked: "thinking" }) });
      await session.prompt("START-MAIN");
      await session.waitFor(() => workerLines(session).length >= 1, "ledger line");
      const child = childOf(fixture);
      expect(child?.model).toBe("fixture-balanced");
      expect(child?.reasoningEffort).toBe("high");
      expect(workerRequests(jev).length).toBe(1);
      const body = JSON.parse(workerRequests(jev)[0]?.body ?? "{}") as { questions?: object };
      expect(Object.keys(body.questions ?? {}).sort()).toEqual(["effort", "risky"]);
      expect(workerLines(session)[0]).toMatchObject({ reason: "untouched", answered: true });
    },
    TIMEOUT,
  );

  test.each([
    ["timeout", { hang: true } as FixtureRoute, 300],
    ["error", { json: {}, status: 500 } as FixtureRoute, 1500],
  ])(
    "Jev %s leaves the caller's model and thinking",
    async (miss, route, timeoutMs) => {
      const jev = await newJev(route);
      const { fixture, session } = await setup(script([subagentCall(launch())]));
      writeJev(session.agentDir, { config: config(jev, { timeoutMs }) });
      await session.prompt("START-MAIN");
      await session.waitFor(() => workerLines(session).length >= 1, "ledger line");
      const child = childOf(fixture);
      expect(child?.model).toBe("fixture-balanced");
      expect(child?.reasoningEffort).toBe("low");
      expect(workerLines(session)[0]).toMatchObject({ miss, reason: "miss", answered: false });
    },
    TIMEOUT,
  );

  test(
    "turn limit raised through the executor",
    async () => {
      const turns = { short: 0.1, medium: 0.2, long: 0.6, very_long: 0.1 };
      const jev = await newJev(jevAnswers({ tier: "basic", effort: "medium", turns }));
      const { session } = await setup(script([subagentCall(launch({ max_turns: 20 }))]), {
        persist: true,
      });
      writeJev(session.agentDir, { config: config(jev) });
      await session.prompt("START-MAIN");
      await session.waitFor(() => workerLines(session).length >= 1, "ledger line");
      await session.waitFor(() => recordedMaxTurns(session).length >= 1, "run record");
      expect(workerLines(session)[0]).toMatchObject({ requestedTurns: 20, turnFloor: 100 });
      expect(recordedMaxTurns(session)).toEqual([100]);
    },
    TIMEOUT,
  );

  describe("tuned floors", () => {
    const turns = { short: 0.1, medium: 0.2, long: 0.6, very_long: 0.1 };
    const writeTuning = (agentDir: string, body: string): void =>
      writeFileSync(join(agentDir, "jev", "tuning.json"), body);
    const longTuned = (value: number): string =>
      JSON.stringify({
        version: 2,
        turnFloors: { long: { changedAt: 1, tuned: { value, base: 100 } } },
      });

    test(
      "Tuned floor written",
      async () => {
        const jev = await newJev(jevAnswers({ tier: "basic", effort: "medium", turns }));
        const { session } = await setup(script([subagentCall(launch({ max_turns: 20 }))]), {
          persist: true,
        });
        writeJev(session.agentDir, { config: config(jev) });
        writeTuning(session.agentDir, longTuned(120));
        await session.prompt("START-MAIN");
        await session.waitFor(() => workerLines(session).length >= 1, "ledger line");
        await session.waitFor(() => recordedMaxTurns(session).length >= 1, "run record");
        expect(recordedMaxTurns(session)).toEqual([120]);
        expect(workerLines(session)[0]).toMatchObject({ turnFloor: 120 });
      },
      TIMEOUT,
    );

    test(
      "Lowered floor never lowers a limit",
      async () => {
        const jev = await newJev(jevAnswers({ tier: "basic", effort: "medium", turns }));
        const { session } = await setup(script([subagentCall(launch({ max_turns: 90 }))]), {
          persist: true,
        });
        writeJev(session.agentDir, { config: config(jev) });
        writeTuning(session.agentDir, longTuned(80));
        await session.prompt("START-MAIN");
        await session.waitFor(() => workerLines(session).length >= 1, "ledger line");
        await session.waitFor(() => recordedMaxTurns(session).length >= 1, "run record");
        expect(recordedMaxTurns(session)).toEqual([90]);
        expect(workerLines(session)[0]).not.toHaveProperty("turnFloor");
      },
      TIMEOUT,
    );

    test(
      "Bad tuning file uses built-in floors",
      async () => {
        const jev = await newJev(jevAnswers({ tier: "basic", effort: "medium", turns }));
        const { session } = await setup(script([subagentCall(launch({ max_turns: 20 }))]), {
          persist: true,
        });
        writeJev(session.agentDir, { config: config(jev) });
        writeTuning(session.agentDir, '{"version":2,');
        await session.prompt("START-MAIN");
        await session.waitFor(() => workerLines(session).length >= 1, "ledger line");
        await session.waitFor(() => recordedMaxTurns(session).length >= 1, "run record");
        expect(recordedMaxTurns(session)).toEqual([100]);
      },
      TIMEOUT,
    );

    test(
      "Jev miss writes no floor",
      async () => {
        const jev = await newJev({ hang: true });
        const { session } = await setup(script([subagentCall(launch({ max_turns: 20 }))]), {
          persist: true,
        });
        writeJev(session.agentDir, { config: config(jev, { timeoutMs: 300 }) });
        writeTuning(session.agentDir, longTuned(120));
        await session.prompt("START-MAIN");
        await session.waitFor(() => workerLines(session).length >= 1, "ledger line");
        await session.waitFor(() => recordedMaxTurns(session).length >= 1, "run record");
        expect(recordedMaxTurns(session)).toEqual([20]);
      },
      TIMEOUT,
    );
  });

  test(
    "turn limit kept on Jev error",
    async () => {
      const jev = await newJev({ json: {}, status: 500 });
      const { session } = await setup(script([subagentCall(launch({ max_turns: 20 }))]), {
        persist: true,
      });
      writeJev(session.agentDir, { config: config(jev) });
      await session.prompt("START-MAIN");
      await session.waitFor(() => workerLines(session).length >= 1, "ledger line");
      await session.waitFor(() => recordedMaxTurns(session).length >= 1, "run record");
      expect(recordedMaxTurns(session)).toEqual([20]);
    },
    TIMEOUT,
  );

  test(
    "turn limit kept with the switch off",
    async () => {
      const jev = await newJev(jevAnswers({ tier: "basic", turns: { long: 1 } }));
      const { fixture, session } = await setup(script([subagentCall(launch({ max_turns: 20 }))]), {
        persist: true,
      });
      writeJev(session.agentDir, {
        config: config(jev),
        state: { version: 1, switches: { subagents: false } },
      });
      await session.prompt("START-MAIN");
      await session.waitFor(() => afterTool(fixture), "main after the launch");
      await session.waitFor(() => recordedMaxTurns(session).length >= 1, "run record");
      expect(recordedMaxTurns(session)).toEqual([20]);
      expect(workerRequests(jev).length).toBe(0);
    },
    TIMEOUT,
  );

  test(
    "Worker routing uses the tuned value",
    async () => {
      const jev = await newJev({ hang: true });
      const { fixture, session } = await setup(script([subagentCall(launch())]));
      writeJev(session.agentDir, { config: config(jev, { timeoutMs: 300 }) });
      writeFileSync(
        join(session.agentDir, "jev", "tuning.json"),
        JSON.stringify({ version: 1, timeoutMs: { value: 600, base: 300 } }),
      );
      await session.prompt("START-MAIN");
      await session.waitFor(() => workerLines(session).length >= 1, "ledger line");
      expect(childOf(fixture)?.model).toBe("fixture-balanced");
      const line = workerLines(session)[0];
      expect(line).toMatchObject({ miss: "timeout", reason: "miss", answered: false });
      expect(line?.["ms"] as number).toBeGreaterThanOrEqual(550);
      expect(line?.["ms"] as number).toBeLessThan(800);
    },
    TIMEOUT,
  );

  test(
    "switch off sends nothing",
    async () => {
      const jev = await newJev(jevAnswers({ tier: "basic" }));
      const { fixture, session } = await setup(script([subagentCall(launch())]));
      writeJev(session.agentDir, {
        config: config(jev),
        state: { version: 1, switches: { subagents: false } },
      });
      await session.prompt("START-MAIN");
      await session.waitFor(() => afterTool(fixture), "main after the launch");
      await Bun.sleep(300);
      expect(childOf(fixture)?.model).toBe("fixture-balanced");
      expect(workerRequests(jev).length).toBe(0);
      expect(workerLines(session)).toEqual([]);
    },
    TIMEOUT,
  );

  test(
    "no key sends nothing",
    async () => {
      const jev = await newJev(jevAnswers({ tier: "basic" }));
      const { fixture, session } = await setup(script([subagentCall(launch())]), { env: {} });
      writeJev(session.agentDir, { config: config(jev) });
      await session.prompt("START-MAIN");
      await session.waitFor(() => afterTool(fixture), "main after the launch");
      expect(childOf(fixture)?.model).toBe("fixture-balanced");
      expect(workerRequests(jev).length).toBe(0);
      expect(workerLines(session)).toEqual([]);
    },
    TIMEOUT,
  );

  test(
    "unusable tier warns once, cascades and keeps the brief out of files",
    async () => {
      const jev = await newJev(jevAnswers({ tier: "deep", tiers: ["basic", "broad", "deep"] }));
      const { fixture, session } = await setup(
        script([
          subagentCall(launch({}, `CHILD-TASK one ${MARKER}`)),
          subagentCall(launch({}, `CHILD-TASK two ${MARKER}`)),
        ]),
        { keyless: true },
      );
      writeJev(session.agentDir, { config: config(jev, { deep: true }) });
      await session.prompt("START-MAIN");
      await session.waitFor(() => workerLines(session).length >= 2, "two ledger lines");
      const children = fixture.requests.filter(isChild);
      expect(children.map((c) => c.model)).toEqual(["fixture-balanced", "fixture-balanced"]);
      expect(workerRequests(jev).length).toBe(2);
      const warned = warnings(session).filter((w) => w.message?.includes("tiers.deep"));
      expect(warned.length).toBe(1);
      for (const line of workerLines(session)) {
        expect(line).toMatchObject({ tier: "broad", fallback: "deep" });
      }
      for (const text of jevFiles(session)) expect(text).not.toContain(MARKER);
    },
    TIMEOUT,
  );

  test(
    "nested launch is routed at its own tool call",
    async () => {
      const jev = await newJev(jevAnswers({ tier: "basic", effort: "medium" }));
      const { fixture, session } = await setup(
        script([{ name: "nest", arguments: { args: launch({ model: "fixture/fixture-main" }) } }]),
        { probes: ["nested"] },
      );
      writeJev(session.agentDir, { config: config(jev) });
      await session.prompt("START-MAIN");
      await session.waitFor(() => workerLines(session).length >= 1, "ledger line");
      expect(workerRequests(jev).length).toBe(1);
      expect(
        session
          .probeRecords()
          .some((r) => r.probe === "nested" && r.event === "tool_call" && r.data?.hasParent),
      ).toBe(true);
      const child = childOf(fixture);
      expect(child?.model).toBe("fixture-fast");
      expect(child?.reasoningEffort).toBe("medium");
    },
    TIMEOUT,
  );

  test(
    "Premium launch end to end",
    async () => {
      const answers = jevAnswers({
        tier: "frontier",
        effort: "low",
        probs: { basic: 0, broad: 0, deep: 0, frontier: 1 },
      });
      const run = async (mode: string) => {
        const jev = await newJev(answers);
        const { fixture, session } = await setup(script([subagentCall(launch())]));
        writeJev(session.agentDir, {
          config: config(jev, { deep: true, frontier: true }),
          state: { version: 1, mode },
        });
        await session.prompt("START-MAIN");
        await session.waitFor(() => workerLines(session).length >= 1, "ledger line");
        return { fixture, session, request: workerRequests(jev)[0]?.body };
      };
      const standard = await run("standard");
      const premium = await run("premium");
      expect(premium.request).toBeDefined();
      expect(JSON.parse(premium.request ?? "{}")).toEqual(JSON.parse(standard.request ?? "{}"));
      const child = childOf(premium.fixture);
      expect(child?.model).toBe("fixture-expert");
      expect(child?.reasoningEffort).toBe("low");
      expect(workerLines(premium.session)[0]).toMatchObject({
        mode: "premium",
        reason: "frontier",
        rubric: RUBRIC_VERSION,
        score: 3,
        tier: "frontier",
      });
    },
    TIMEOUT * 2,
  );

  test(
    "Jev down in premium",
    async () => {
      const jev = await newJev({ json: {}, status: 500 });
      const { fixture, session } = await setup(script([subagentCall(launch())]));
      writeJev(session.agentDir, {
        config: config(jev, { deep: true, frontier: true }),
        state: { version: 1, mode: "premium" },
      });
      await session.prompt("START-MAIN");
      await session.waitFor(() => workerLines(session).length >= 1, "ledger line");
      const child = childOf(fixture);
      expect(child?.model).toBe("fixture-balanced");
      expect(child?.reasoningEffort).toBe("low");
      expect(workerLines(session)[0]).toMatchObject({ mode: "premium", reason: "miss" });
      expect(workerLines(session)[0]).not.toHaveProperty("score");
    },
    TIMEOUT,
  );

  test.each([
    ["Review launch on the reviewer slot", {}],
    ["Background review launch", { run_in_background: true }],
  ])(
    "%s",
    async (_name, extra) => {
      const jev = await newJev(slotAnswer("high"));
      const { fixture, session } = await setup(
        script([subagentCall(launch({ model: "fixture/fixture-main", ...extra }))]),
      );
      writeJev(session.agentDir, { config: config(jev, { slotModel: "fixture/fixture-review" }) });
      await session.prompt("START-MAIN");
      await session.waitFor(() => workerLines(session).length >= 1, "ledger line");
      const child = childOf(fixture);
      expect(child?.model).toBe("fixture-review");
      expect(child?.reasoningEffort).toBe("high");
      expect(workerLines(session)[0]).toMatchObject({
        tier: SLOT,
        model: "fixture/fixture-review",
      });
      const body = JSON.parse(workerRequests(jev)[0]?.body ?? "{}") as {
        questions?: { tier?: { criteria?: Record<string, string> } };
      };
      expect(body.questions?.tier?.criteria?.[SLOT]).toContain("Code review.");
    },
    TIMEOUT,
  );

  test(
    "Frontier wins over the reviewer slot",
    async () => {
      const jev = await newJev(
        jevAnswers({
          tier: SLOT,
          effort: "high",
          probs: { basic: 0, broad: 0, [SLOT]: 0.6, frontier: 0.4 },
        }),
      );
      const { fixture, session } = await setup(script([subagentCall(launch())]));
      writeJev(session.agentDir, {
        config: config(jev, { frontier: true, slotModel: "fixture/fixture-review" }),
        state: { version: 1, mode: "premium" },
      });
      await session.prompt("START-MAIN");
      await session.waitFor(() => workerLines(session).length >= 1, "ledger line");
      expect(childOf(fixture)?.model).toBe("fixture-expert");
      expect(workerLines(session)[0]).toMatchObject({ reason: "frontier", tier: "frontier" });
    },
    TIMEOUT,
  );

  test(
    "Unusable reviewer slot falls back",
    async () => {
      const jev = await newJev(slotAnswer("medium"));
      const { fixture, session } = await setup(script([subagentCall(launch())]), { keyless: true });
      writeJev(session.agentDir, {
        config: config(jev, { slotModel: "fixture2/fixture-review-keyless" }),
      });
      await session.prompt("START-MAIN");
      await session.waitFor(() => workerLines(session).length >= 1, "ledger line");
      expect(childOf(fixture)?.model).toBe("fixture-balanced");
      expect(workerLines(session)[0]).toMatchObject({ tier: "broad", fallback: SLOT });
      const warned = warnings(session).filter((w) =>
        w.message?.includes('crew.slots "reviewer" model'),
      );
      expect(warned.length).toBe(1);
    },
    TIMEOUT,
  );

  test(
    "Jev down with a slot configured",
    async () => {
      const jev = await newJev({ json: {}, status: 500 });
      const { fixture, session } = await setup(script([subagentCall(launch())]));
      writeJev(session.agentDir, { config: config(jev, { slotModel: "fixture/fixture-review" }) });
      await session.prompt("START-MAIN");
      await session.waitFor(() => workerLines(session).length >= 1, "ledger line");
      const child = childOf(fixture);
      expect(child?.model).toBe("fixture-balanced");
      expect(child?.reasoningEffort).toBe("low");
      expect(workerLines(session)[0]).toMatchObject({ reason: "miss" });
    },
    TIMEOUT,
  );

  test(
    "Present after children",
    async () => {
      const jev = await newJev(jevAnswers({ tier: "basic", effort: "medium" }));
      const entries: ScriptEntry[] = [
        { name: "child", match: isChild, reply: { text: "child done" } },
        {
          name: "main-two",
          match: isMainFirst,
          reply: { toolCalls: [subagentCall(launch()), subagentCall(launch())] },
          times: 1,
        },
        {
          name: "main-second",
          match: (r) => r.model === "fixture-main" && lastIsUser(r, "SECOND-MAIN"),
          reply: { toolCalls: [subagentCall(launch())] },
          times: 1,
        },
        { name: "main-after", match: (r) => r.model === "fixture-main", reply: { text: "done" } },
      ];
      const { fixture, session } = await setup(entries);
      writeJev(session.agentDir, { config: config(jev) });
      await session.prompt("START-MAIN");
      await session.waitFor(() => workerLines(session).length >= 2, "two ledger lines");
      await session.waitFor(() => afterTool(fixture), "main turn after the children");
      await session.send({ type: "prompt", message: "/jev" });
      await session.waitFor(
        () => notifies(session).some((n) => n.message?.includes("executor:")),
        "/jev report",
      );
      const report = notifies(session).find((n) => n.message?.includes("executor:"));
      expect(report?.message).toContain("executor: @ttdua/pi-subagents");
      // The main session still routes a launch made after both children were disposed.
      await session.prompt("SECOND-MAIN");
      await session.waitFor(() => workerLines(session).length >= 3, "third ledger line");
      const children = fixture.requests.filter(isChild);
      expect(children.at(-1)?.model).toBe("fixture-fast");
      expect(workerLines(session).at(-1)).toMatchObject({ tier: "basic", status: "completed" });
    },
    TIMEOUT,
  );
});
