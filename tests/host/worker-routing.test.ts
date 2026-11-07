import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startJevFixture, type FixtureRoute, type JevFixture } from "../jev/fixture";
import { readLedger } from "../../src/store/ledger.ts";
import { startFixture, type Fixture, type RecordedRequest, type ScriptEntry } from "./fixture";
import { startHostSession, type HostSession } from "./harness";
import type { RpcEvent } from "./rpc";

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

// Main-session effort (WG-07) also asks Jev on every prompt; count worker requests only.
const workerRequests = (j: JevFixture): JevFixture["requests"] =>
  j.requests.filter((r) => {
    try {
      return (JSON.parse(r.body) as { state?: { task?: unknown } }).state?.task !== undefined;
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
}): FixtureRoute {
  const answers: Record<string, object> = {
    effort: choice(opts.effort ?? "medium", EFFORTS),
    risky: { type: "noul", noul: 0.2 },
  };
  if (opts.tier !== undefined) {
    answers["tier"] =
      opts.probs === undefined
        ? choice(opts.tier, opts.tiers ?? ["fast", "balanced"])
        : { type: "choice", choice: opts.tier, probabilities: opts.probs, confidence: 0.5 };
  }
  if (opts.probs?.["expert"] !== undefined) answers["expert_needed"] = { type: "noul", noul: 0.2 };
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
    expert?: boolean;
    forked?: "thinking" | "untouched";
  } = {},
): Record<string, unknown> {
  const tiers: Record<string, string> = {
    fast: "fixture/fixture-fast",
    balanced: "fixture/fixture-balanced",
  };
  if (extra.deep) tiers["deep"] = "fixture2/fixture-deep";
  if (extra.expert) tiers["expert"] = "fixture/fixture-expert";
  return {
    classifier: { url: jev.url("/classify"), timeoutMs: extra.timeoutMs ?? 1500 },
    tiers,
    ...(extra.forked === undefined ? {} : { subagents: { forkedLaunch: extra.forked } }),
  };
}

const KEY = { TYPESAFE_API_KEY: "test-key" };

async function setup(
  script: ScriptEntry[],
  opts: { keyless?: boolean; env?: Record<string, string>; probes?: string[] } = {},
): Promise<{ fixture: Fixture; session: HostSession }> {
  const fixture = await startFixture(script);
  fixtures.push(fixture);
  const session = await startHostSession({
    fixture,
    self: true,
    executor: true,
    probes: opts.probes ?? [],
    keyless: opts.keyless === true,
    agents: { [AGENT]: AGENT_TEXT },
    env: opts.env ?? KEY,
    timeoutMs: 60_000,
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
      const jev = await newJev(jevAnswers({ tier: "fast", effort: "medium" }));
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
        tier: "fast",
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
      const jev = await newJev(jevAnswers({ tier: "fast", effort: "medium" }));
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
        tier: "fast",
        status: "completed",
        callerModel: "fixture/fixture-main",
      });
    },
    TIMEOUT,
  );

  test(
    "resume untouched",
    async () => {
      const jev = await newJev(jevAnswers({ tier: "fast", effort: "medium" }));
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
      await session.waitFor(() => workerLines(session).length >= 2, "two ledger lines");
      await session.waitFor(() => fixture.requests.some(isResumeChild), "resumed child request");
      const first = childOf(fixture);
      const resumed = fixture.requests.find(isResumeChild);
      expect(first?.model).toBe("fixture-fast");
      expect(resumed?.model).toBe(first?.model as string);
      const lines = workerLines(session);
      expect(lines[0]).toMatchObject({ tier: "fast", status: "completed" });
      expect(lines[1]).toMatchObject({ reason: "untouched", status: "completed" });
      expect(workerRequests(jev).length).toBe(1);
      expect(fixture.unmatched).toEqual([]);
    },
    TIMEOUT,
  );

  test(
    "forked launch left alone",
    async () => {
      const jev = await newJev(jevAnswers({ tier: "fast" }));
      const { fixture, session } = await setup(
        script([subagentCall(launch({ inherit_context: true }))]),
      );
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
      const { fixture, session } = await setup(
        script([subagentCall(launch({ inherit_context: true }))]),
      );
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
    "switch off sends nothing",
    async () => {
      const jev = await newJev(jevAnswers({ tier: "fast" }));
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
      const jev = await newJev(jevAnswers({ tier: "fast" }));
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
      const jev = await newJev(jevAnswers({ tier: "deep", tiers: ["fast", "balanced", "deep"] }));
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
        expect(line).toMatchObject({ tier: "balanced", fallback: "deep" });
      }
      for (const text of jevFiles(session)) expect(text).not.toContain(MARKER);
    },
    TIMEOUT,
  );

  test(
    "nested launch is routed at its own tool call",
    async () => {
      const jev = await newJev(jevAnswers({ tier: "fast", effort: "medium" }));
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
      const jev = await newJev(
        jevAnswers({
          tier: "deep",
          effort: "xhigh",
          probs: { fast: 0.05, balanced: 0.15, deep: 0.5, expert: 0.3 },
        }),
      );
      const { fixture, session } = await setup(script([subagentCall(launch())]));
      writeJev(session.agentDir, {
        config: config(jev, { deep: true, expert: true }),
        state: { version: 1, mode: "premium" },
      });
      await session.prompt("START-MAIN");
      await session.waitFor(() => workerLines(session).length >= 1, "ledger line");
      expect(childOf(fixture)?.model).toBe("fixture-expert");
      expect(workerLines(session)[0]).toMatchObject({
        mode: "premium",
        reason: "expert-admitted",
        tier: "expert",
      });
    },
    TIMEOUT,
  );

  test(
    "Jev down in premium",
    async () => {
      const jev = await newJev({ json: {}, status: 500 });
      const { fixture, session } = await setup(script([subagentCall(launch())]));
      writeJev(session.agentDir, {
        config: config(jev, { deep: true, expert: true }),
        state: { version: 1, mode: "premium" },
      });
      await session.prompt("START-MAIN");
      await session.waitFor(() => workerLines(session).length >= 1, "ledger line");
      const child = childOf(fixture);
      expect(child?.model).toBe("fixture-balanced");
      expect(child?.reasoningEffort).toBe("low");
      expect(workerLines(session)[0]).toMatchObject({ mode: "premium", reason: "miss" });
    },
    TIMEOUT,
  );
});
