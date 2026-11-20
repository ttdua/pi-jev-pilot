import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
  AgentTypeSnapshot,
  LaunchAdjustment,
  LaunchPolicy,
  LaunchRequest,
} from "@ttdua/pi-subagents";
import type { JevOutcome, JevRequest } from "../../src/jev/client.ts";
import type { Snapshot } from "../../src/host/platform/readiness.ts";
import type { ExecutorService } from "../../src/host/platform/service.ts";
import { registerWorkerRouting, type WorkerDeps } from "../../src/host/worker/routing.ts";
import type { WindowEntry } from "../../src/policy/worker/cutpoints.ts";
import type { Mode } from "../../src/store/defaults.ts";
import type { Config, Slot } from "../../src/store/config.ts";
import { resolveSettings } from "../../src/store/settings.ts";

export type Handler = (event: unknown, ctx: unknown) => Promise<unknown> | unknown;

export const TIERS = {
  basic: "fx/fast",
  broad: "fx/balanced",
  deep: "fx/deep",
};

export const TIERS_X = { ...TIERS, frontier: "fx/expert" };

/** The tools the executor gives an agent that declares none. */
export const DEFAULT_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];

export type Opts = {
  mode?: Mode;
  tiers?: Record<string, string>;
  switches?: Record<string, boolean>;
  valid?: boolean;
  keySet?: boolean;
  executor?: boolean | { launchPolicy?: boolean; agentRegistry?: boolean; implementation?: string };
  parentRequest?: boolean;
  forkLaunch?: "untouched" | "thinking";
  slots?: Slot[];
  window?: () => readonly WindowEntry[];
  /** A config read from a file, for tests that need legacy keys to pass through the reader. */
  config?: Config;
  timeoutMs?: number;
};

/** A snapshot with routing on. */
export function snap(o: Opts = {}): Snapshot {
  const settings = resolveSettings({
    config: {
      ...o.config,
      tiers: o.tiers ?? TIERS,
      state: { parentRequest: o.parentRequest ?? false },
      subagents: { forkLaunch: o.forkLaunch ?? "untouched" },
      ...(o.timeoutMs === undefined ? {} : { classifier: { timeoutMs: o.timeoutMs } }),
      ...(o.slots === undefined ? {} : { crew: { slots: o.slots } }),
    } as never,
    state: {
      switches: { subagents: true, ...o.switches },
      ...(o.mode === undefined ? {} : { mode: o.mode }),
    } as never,
  });
  return {
    config:
      o.valid === false
        ? { valid: false, issues: [] }
        : { valid: true, notices: [], deprecated: [] },
    state: { kind: "ok", issues: [] },
    localMode: { kind: "missing", issues: [] },
    settings,
    keyVar: "TYPESAFE_API_KEY",
    keySet: o.keySet ?? true,
    tuning: { kind: "missing", issues: [], record: {} },
    untunedTimeoutMs: settings.classifier.timeoutMs,
    executor: executorOf(o.executor),
  };
}

export function choice(tier: string, p = 0.9) {
  return {
    type: "choice",
    choice: tier,
    confidence: p,
    probabilities: { basic: 0, broad: 0, deep: 0, [tier]: p },
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
    probabilities: {
      low: 0,
      medium: 0,
      high: 0,
      xhigh: 0,
      max: 0,
      [level]: 0.9,
    },
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
      ...("frontier" in probabilities ? { expert_needed: { type: "noul", noul: 0.1 } } : {}),
    },
  };
}
export const ok = (b: unknown): JevOutcome => ({ kind: "ok", body: b, ms: 1 });

/** An agent snapshot as the executor's registry returns it; `general` by default. */
export function agentSnapshot(over: Partial<AgentTypeSnapshot> = {}): AgentTypeSnapshot {
  return {
    name: "general",
    source: "builtin",
    description: "General-purpose agent",
    instructions: "",
    tools: null,
    defaultTools: DEFAULT_TOOLS,
    disallowedTools: [],
    ...over,
  };
}

/** What a test overrides in a launch request; `agent` is merged into the default snapshot. */
export type LaunchOver = Omit<Partial<LaunchRequest>, "agent" | "toolSet"> & {
  agent?: Partial<AgentTypeSnapshot>;
  toolSet?: Partial<LaunchRequest["toolSet"]>;
};

let nextAgent = 0;

/** A launch request as the executor builds it for a `subagent` tool call by default. */
export function launchRequest(over: LaunchOver = {}): LaunchRequest {
  const agent = agentSnapshot(over.agent);
  const declared = agent.tools === null ? null : [...agent.tools];
  return {
    agentId: over.agentId ?? `ag-${++nextAgent}`,
    agentType: over.agentType ?? agent.name,
    agent,
    origin: over.origin ?? { kind: "tool", toolCallId: "call_1" },
    ...(over.parentSessionId === undefined ? {} : { parentSessionId: over.parentSessionId }),
    prompt: over.prompt ?? "do a thing",
    description: over.description ?? "d",
    requested: over.requested ?? {},
    locked: over.locked ?? [],
    context: over.context ?? "fresh",
    isBackground: over.isBackground ?? false,
    toolSet: {
      declared,
      disallowed: agent.disallowedTools,
      defaults: declared ?? DEFAULT_TOOLS,
      parentTools: DEFAULT_TOOLS,
      ...over.toolSet,
    },
  };
}

/** A fake executor service that keeps the one registered launch policy. */
export function fakeService(opts: { taken?: boolean } = {}) {
  let current: LaunchPolicy | undefined;
  const registrations: { timeoutMs: number }[] = [];
  let unregisters = 0;
  const service = {
    implementation: "@ttdua/pi-subagents",
    registerLaunchPolicy(policy: LaunchPolicy, options: { timeoutMs: number }) {
      if (opts.taken === true || current !== undefined) {
        throw new Error("launch policy slot is taken");
      }
      current = policy;
      registrations.push(options);
      return () => {
        unregisters++;
        if (current === policy) current = undefined;
      };
    },
  };
  return {
    service: service as unknown as ExecutorService,
    policy: () => current,
    registrations,
    unregisters: () => unregisters,
  };
}

type Script = (req: JevRequest) => JevOutcome | Promise<JevOutcome>;

/** The main session context the policy reads: registry, UI and session id. */
function mainCtx(
  reg: Record<string, { name?: string; auth?: boolean }>,
  notes: { text: string; type: string }[],
  finds: string[],
) {
  return {
    hasUI: true,
    ui: { notify: (text: string, type: string) => notes.push({ text, type }) },
    sessionManager: {
      getSessionId: () => "main-1",
      getBranch: () => [
        { type: "message", message: { role: "user", content: "old" } },
        {
          type: "message",
          message: { role: "user", content: [{ type: "text", text: "do X" }] },
        },
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
}

/** A Pi fake with only an event bus; routing registers no Pi handler. */
function fakeBus(tools: () => unknown[]) {
  const bus = new Map<string, ((d: unknown) => void)[]>();
  const handlers: string[] = [];
  const pi = {
    on: (name: string) => {
      handlers.push(name);
      return () => {};
    },
    events: {
      on: (name: string, h: (d: unknown) => void) => {
        bus.set(name, [...(bus.get(name) ?? []), h]);
        return () =>
          bus.set(
            name,
            (bus.get(name) ?? []).filter((x) => x !== h),
          );
      },
    },
    getAllTools: () => tools(),
  } as unknown as ExtensionAPI;
  const emit = (name: string, payload: unknown) => {
    for (const h of bus.get(name) ?? []) h(payload);
  };
  return { pi, emit, handlers, bus };
}

export function harness(
  opts: Opts & {
    reg?: Record<string, { name?: string; auth?: boolean }>;
    taken?: boolean;
    tools?: unknown[];
    service?: unknown;
  } = {},
) {
  let allTools: unknown[] = opts.tools ?? [];
  const { pi, emit, handlers, bus } = fakeBus(() => allTools);
  const reg = opts.reg ?? {
    "fx/fast": { name: "Fixture Fast" },
    "fx/balanced": {},
    "fx/deep": {},
    "fx/expert": {},
  };
  const finds: string[] = [];
  const notes: { text: string; type: string }[] = [];
  const ctx = mainCtx(reg, notes, finds);
  const asks: JevRequest[] = [];
  const lines: Record<string, unknown>[] = [];
  let appendFails = false;
  let script: Script = () => ok(body("basic"));
  let current = snap(opts);
  let clock = 1_700_000_000_000;
  const executor = fakeService({ taken: opts.taken });
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
    now: () => clock,
    service: () =>
      opts.service !== undefined
        ? (opts.service as typeof executor.service)
        : opts.executor === false
          ? undefined
          : executor.service,
    ...(opts.window === undefined ? {} : { window: opts.window }),
  };
  const routing = registerWorkerRouting(pi, deps);
  routing.start(ctx as never);

  /** Calls the registered policy for one launch, as the executor does at the launch's start. */
  const launch = async (
    over: LaunchOver = {},
    signal: AbortSignal = new AbortController().signal,
  ): Promise<{ request: LaunchRequest; adjustment: LaunchAdjustment | undefined }> => {
    const request = launchRequest(over);
    const policy = executor.policy();
    const adjustment = policy === undefined ? undefined : await policy(request, signal);
    return { request, adjustment };
  };
  const outcome = (agentId: string, extra: object = {}) => ({
    id: agentId,
    type: "general-purpose",
    description: "SECRET-DESC",
    status: "completed",
    toolUses: 3,
    durationMs: 1200,
    tokens: { input: 5, output: 6, total: 11 },
    ...extra,
  });
  return {
    pi,
    routing,
    ctx,
    asks,
    notes,
    finds,
    lines,
    handlers,
    bus,
    executor,
    launch,
    emit,
    /** The executor's `session-created` event for a launch. */
    created: (agentId: string, extra: object = {}) =>
      emit("subagents:child:session-created", { sessionId: `s-${agentId}`, agentId, ...extra }),
    completed: (agentId: string, extra: object = {}) =>
      emit("subagents:completed", outcome(agentId, extra)),
    failed: (agentId: string, extra: object = {}) =>
      emit("subagents:failed", outcome(agentId, { status: "error", ...extra })),
    resumed: (agentId: string) => emit("subagents:resumed", outcome(agentId)),
    failAppend: () => (appendFails = true),
    setScript: (s: Script) => (script = s),
    setSnap: (o: Opts) => (current = snap(o)),
    setTools: (t: unknown[]) => (allTools = t),
    tick: (ms: number) => (clock += ms),
  };
}

/** Launches through the policy, then completes it: session created, then completed. */
export async function runToCompletion(
  h: ReturnType<typeof harness>,
  over: LaunchOver = {},
  effective: object = {},
) {
  const result = await h.launch(over);
  h.created(result.request.agentId, effective);
  h.completed(result.request.agentId);
  return result;
}

function executorOf(v: Opts["executor"]): Snapshot["executor"] {
  if (v === false) return { kind: "absent" };
  const o = typeof v === "object" ? v : {};
  return {
    kind: "present",
    ...(o.implementation === undefined ? {} : { implementation: o.implementation }),
    launchPolicy: o.launchPolicy ?? true,
    agentRegistry: o.agentRegistry ?? true,
  };
}
