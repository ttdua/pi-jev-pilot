import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { JevOutcome, JevRequest } from "../../src/jev/client.ts";
import type { Snapshot } from "../../src/host/readiness.ts";
import { registerWorkerRouting, type WorkerDeps } from "../../src/host/worker.ts";
import type { Mode } from "../../src/store/defaults.ts";
import { resolveSettings } from "../../src/store/settings.ts";
import { tempDir } from "../helpers.ts";

export type Handler = (event: unknown, ctx: unknown) => Promise<unknown> | unknown;

export const TIERS = { fast: "fx/fast", balanced: "fx/balanced", deep: "fx/deep" };

export const TIERS_X = { ...TIERS, expert: "fx/expert" };

export type Opts = {
  mode?: Mode;
  tiers?: Record<string, string>;
  switches?: Record<string, boolean>;
  valid?: boolean;
  keySet?: boolean;
  executor?: boolean;
  parentRequest?: boolean;
  forkedLaunch?: "untouched" | "thinking";
};

export function snap(o: Opts = {}): Snapshot {
  const settings = resolveSettings({
    config: {
      tiers: o.tiers ?? TIERS,
      state: { parentRequest: o.parentRequest ?? false },
      subagents: { forkedLaunch: o.forkedLaunch ?? "untouched" },
    } as never,
    state: {
      switches: { subagents: true, ...o.switches },
      ...(o.mode === undefined ? {} : { mode: o.mode }),
    } as never,
  });
  return {
    config: o.valid === false ? { valid: false, issues: [] } : { valid: true },
    state: { kind: "ok", issues: [] },
    settings,
    keyVar: "TYPESAFE_API_KEY",
    keySet: o.keySet ?? true,
    executor: o.executor ?? true,
  };
}

export function choice(tier: string, p = 0.9) {
  return {
    type: "choice",
    choice: tier,
    confidence: p,
    probabilities: { fast: 0, balanced: 0, deep: 0, [tier]: p },
  };
}
/** A tier answer whose probability keys are exactly the offered tiers. */
export function choiceWith(pick: string, probabilities: Record<string, number>) {
  return {
    type: "choice",
    choice: pick,
    confidence: probabilities[pick] ?? 0,
    probabilities,
  };
}
export function effort(level: string) {
  return {
    type: "choice",
    choice: level,
    confidence: 0.9,
    probabilities: { low: 0, medium: 0, high: 0, xhigh: 0, max: 0, [level]: 0.9 },
  };
}
export function body(tier: string, eff = "medium") {
  return {
    answers: {
      tier: choice(tier),
      effort: effort(eff),
      risky: { type: "noul", noul: 0.1 },
    },
  };
}
export function bodyWith(tier: string, probabilities: Record<string, number>, eff = "medium") {
  return {
    answers: {
      tier: choiceWith(tier, probabilities),
      effort: effort(eff),
      risky: { type: "noul", noul: 0.1 },
      ...("expert" in probabilities ? { expert_needed: { type: "noul", noul: 0.1 } } : {}),
    },
  };
}
export const ok = (b: unknown): JevOutcome => ({ kind: "ok", body: b, ms: 1 });

export function harness(
  opts: Opts & { reg?: Record<string, { name?: string; auth?: boolean }> } = {},
) {
  const handlers = new Map<string, Handler[]>();
  const bus = new Map<string, Handler[]>();
  const pi = {
    on: (name: string, h: Handler) => {
      handlers.set(name, [...(handlers.get(name) ?? []), h]);
      return () => {};
    },
    events: {
      on: (name: string, h: Handler) => {
        bus.set(name, [...(bus.get(name) ?? []), h]);
        return () => {
          bus.set(
            name,
            (bus.get(name) ?? []).filter((x) => x !== h),
          );
        };
      },
    },
    getAllTools: () => [],
  } as unknown as ExtensionAPI;
  const reg = opts.reg ?? {
    "fx/fast": { name: "Fixture Fast" },
    "fx/balanced": {},
    "fx/deep": {},
    "fx/expert": {},
  };
  const finds: string[] = [];
  const notes: { text: string; type: string }[] = [];
  const ctx = {
    cwd: tempDir("jev-worker-cwd-"),
    signal: undefined,
    hasUI: true,
    ui: { notify: (text: string, type: string) => notes.push({ text, type }) },
    sessionManager: {
      getSessionId: () => "main-1",
      getBranch: () => [
        { type: "message", message: { role: "user", content: "old" } },
        { type: "message", message: { role: "user", content: [{ type: "text", text: "do X" }] } },
        { type: "message", message: { role: "assistant", content: "ok" } },
      ],
    },
    modelRegistry: {
      find: (p: string, id: string) => {
        finds.push(`${p}|${id}`);
        const r = reg[`${p}/${id}`];
        return r === undefined
          ? undefined
          : { id, provider: p, name: r.name ?? id, reasoning: true, auth: r.auth !== false };
      },
      hasConfiguredAuth: (m: { auth: boolean }) => m.auth,
    },
  };
  const asks: JevRequest[] = [];
  let script: (req: JevRequest) => JevOutcome | Promise<JevOutcome> = () => ok(body("fast"));
  let current = snap(opts);
  const deps: WorkerDeps = {
    ask: (req) => {
      asks.push(req);
      return Promise.resolve(script(req));
    },
    snapshot: () => current,
    append: (entry) => {
      if (appendFails) throw new Error("disk full");
      lines.push(entry as Record<string, unknown>);
    },
    now: () => 1_700_000_000_000,
    agentDir: tempDir("jev-worker-agents-"),
  };
  const lines: Record<string, unknown>[] = [];
  let appendFails = false;
  const routing = registerWorkerRouting(pi, deps);
  const fire = async (name: string, event: unknown, c: unknown = ctx) => {
    for (const h of handlers.get(name) ?? []) await h(event, c);
  };
  const emit = async (name: string, payload: unknown) => {
    for (const h of bus.get(name) ?? []) await h(payload, undefined);
  };
  const result = (id: string, agentId?: string, extra: object = {}) => ({
    type: "tool_result",
    toolName: "subagent",
    toolCallId: id,
    input: {},
    content: [],
    isError: false,
    details: agentId === undefined ? undefined : { agentId },
    ...extra,
  });
  const msg = (...calls: [string, Record<string, unknown>][]) => ({
    type: "message_end",
    message: {
      role: "assistant",
      content: calls.map(([id, args]) => ({
        type: "toolCall",
        id,
        name: "subagent",
        arguments: args,
      })),
    },
  });
  const call = (id: string, input: Record<string, unknown>, extra: object = {}) => ({
    type: "tool_call",
    toolName: "subagent",
    toolCallId: id,
    input,
    ...extra,
  });
  return {
    routing,
    ctx,
    asks,
    notes,
    finds,
    lines,
    emit,
    result,
    fire,
    failAppend: () => (appendFails = true),
    msg,
    call,
    setScript: (s: typeof script) => (script = s),
    setSnap: (o: Opts) => (current = snap(o)),
  };
}

export const base = () => ({
  prompt: "do a thing",
  description: "d",
  subagent_type: "general-purpose",
});
