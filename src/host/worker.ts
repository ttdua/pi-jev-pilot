import { join } from "node:path";
import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { askJev, type JevOutcome } from "../jev/client.ts";
import { buildWorkerQuestions, offeredTiers } from "../jev/questions.ts";
import { buildWorkerState } from "../jev/state.ts";
import type { QuestionSpec } from "../policy/answers.ts";
import type { ModeName } from "../policy/modes.ts";
import type { ModelThinking } from "../policy/effort.ts";
import {
  effectiveLaunch,
  type AgentFacts,
  type EffectiveLaunch,
  type TierName,
} from "../policy/launch.ts";
import { launchKind, routeLaunch, type LaunchKind, type Route } from "../policy/route.ts";
import { readWorkerOutcome, type WorkerAnswers } from "../policy/worker.ts";
import type { Answer } from "../policy/answers.ts";
import { appendLedger } from "../store/ledger.ts";
import { readAgent } from "./agents.ts";
import { isChild } from "./child.ts";
import { loadSnapshot, type Snapshot } from "./readiness.ts";
import { jevDir } from "./stores.ts";
import { takeToolCounts } from "./tool-counts.ts";

export type WorkerDeps = {
  ask?: typeof askJev;
  append?: (entry: unknown) => void;
  snapshot?: () => Snapshot;
  agentDir?: string;
  now?: () => number;
};

export type WorkerRouting = {
  off(): void;
  clearWarnings(): void;
  /** Launches, joined drafts and buffered outcomes still held. */
  pending(): number;
};

/** What a launch needs from `message_end` until its `tool_call` (and later, its ledger line). */
type LaunchEntry = {
  facts: AgentFacts;
  launch: EffectiveLaunch;
  kind: LaunchKind;
  /** Read once at classification; the request, tier decision and ledger line all use it. */
  mode: ModeName;
  offered: readonly TierName[];
  outcome: Promise<JevOutcome> | undefined;
  specs: Record<string, QuestionSpec>;
  route?: Route;
  answers?: WorkerAnswers | undefined;
  /** Set by `route()`: what the ledger line needs besides the route. */
  jev?: JevOutcome | undefined;
  session?: string;
  callerModel?: string;
  briefChars?: number;
  write?: { model?: string };
  /** Order stamp taken when `route()` last ran for this launch's `tool_call`. */
  seq?: number;
  /** Executor agent id, set when the tool result names one. */
  agentId?: string;
};

type Executor = {
  status?: unknown;
  durationMs?: unknown;
  toolUses?: unknown;
  tokens?: unknown;
};

/** The only executor fields a ledger line needs, stamped with arrival order. */
type Buffered = { seq: number; outcome: Executor };

function slim(data: Record<string, unknown>): Executor {
  const tokens = data["tokens"];
  return {
    status: data["status"],
    durationMs: data["durationMs"],
    toolUses: data["toolUses"],
    tokens: { total: isRecord(tokens) ? tokens["total"] : undefined },
  };
}

const CALLER_MODEL = /^[A-Za-z0-9._:/-]{1,128}$/;
const STATUSES = ["completed", "aborted", "stopped", "error"] as const;
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
const EVENTS = ["subagents:completed", "subagents:failed", "subagents:resumed"] as const;

const CACHE_MAX = 256;

type Check = { ok: true; thinking: ModelThinking } | { ok: false; why: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function count(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined;
}

function probs(
  answer: Answer | undefined,
  keys?: readonly string[],
): Record<string, number> | undefined {
  if (answer?.type !== "choice") return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(answer.probabilities)) {
    if (keys === undefined || keys.includes(k)) {
      Object.defineProperty(out, k, {
        value: v,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return out;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((p): p is { type: "text"; text: string } => isRecord(p) && p["type"] === "text")
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .join("\n");
}

/** Text of the last user message on the branch, or undefined when empty. */
function lastUserText(ctx: ExtensionContext): string | undefined {
  const branch: unknown[] = ctx.sessionManager.getBranch();
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (!isRecord(entry) || entry["type"] !== "message") continue;
    const message = entry["message"];
    if (!isRecord(message) || message["role"] !== "user") continue;
    const text = textOf(message["content"]);
    return text === "" ? undefined : text;
  }
  return undefined;
}

function splitModel(id: string): [string, string] | undefined {
  const at = id.indexOf("/");
  return at <= 0 || at === id.length - 1 ? undefined : [id.slice(0, at), id.slice(at + 1)];
}

function checkTier(ctx: ExtensionContext, id: string): Check {
  const parts = splitModel(id);
  const model = parts === undefined ? undefined : ctx.modelRegistry.find(parts[0], parts[1]);
  if (model === undefined) return { ok: false, why: "not in the model registry" };
  if (!ctx.modelRegistry.hasConfiguredAuth(model)) return { ok: false, why: "no credentials" };
  return {
    ok: true,
    thinking: { reasoning: model.reasoning, thinkingLevelMap: model.thinkingLevelMap },
  };
}

export function registerWorkerRouting(pi: ExtensionAPI, deps: WorkerDeps = {}): WorkerRouting {
  const ask = deps.ask ?? askJev;
  const snapshot = deps.snapshot ?? (() => loadSnapshot(pi));
  const agentDir = (): string => deps.agentDir ?? getAgentDir();
  const cache = new Map<string, LaunchEntry>();
  const warned = new Set<string>();
  const append = deps.append ?? ((entry: unknown): void => void appendLedger(jevDir(), entry));
  const now = deps.now ?? Date.now;
  /** Launches whose tool result arrived, by executor agent id. */
  const byAgent = new Map<string, LaunchEntry>();
  /** Executor outcomes that arrived before their tool result, by agent id. */
  const outcomes = new Map<string, Buffered>();
  /** Monotonic order of tool calls and buffered outcomes (the clock is not strictly increasing). */
  let seq = 0;
  let active = true;

  const put = <T>(map: Map<string, T>, key: string, value: T): void => {
    map.delete(key);
    map.set(key, value);
    while (map.size > CACHE_MAX) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  };

  /** One `worker` line; never throws. */
  const write = (entry: LaunchEntry, outcome: Executor | undefined): void => {
    try {
      const { route: r, answers, jev, facts } = entry;
      if (r === undefined || r.kind === "skip") return;
      const line: Record<string, unknown> = {
        v: 1,
        at: now(),
        kind: "worker",
        session: entry.session,
        mode: entry.mode,
        answered: jev?.kind === "ok" && answers?.kind === "read",
        agent: facts.name,
        briefChars: entry.briefChars ?? 0,
      };
      if (jev !== undefined && jev.kind !== "cancelled") line["ms"] = count(jev.ms);
      if (answers?.kind === "miss") line["miss"] = answers.miss;
      if (answers?.kind === "read") {
        const a = answers.answers;
        const risky = a["risky"];
        if (risky?.type === "noul") line["risky"] = risky.noul;
        const expert = a["expert_needed"];
        if (expert?.type === "noul") line["expertNeeded"] = expert.noul;
        const tierP = probs(a["tier"]);
        if (tierP !== undefined) line["tierP"] = tierP;
        const effortP = probs(a["effort"], EFFORTS);
        if (effortP !== undefined) line["effortP"] = effortP;
      }
      if (r.kind === "untouched") {
        line["reason"] = "untouched";
        if (r.locked === true) line["locked"] = true;
      } else {
        const { record } = r;
        line["reason"] = record.reason;
        if (record.tier !== undefined) line["tier"] = record.tier;
        if (record.fallback !== undefined) line["fallback"] = record.fallback;
        if (record.effort !== undefined) line["effort"] = record.effort;
        if (record.locked === true) line["locked"] = true;
        if (r.write.model !== undefined) line["model"] = r.write.model;
      }
      if (entry.callerModel !== undefined) line["callerModel"] = entry.callerModel;
      if (entry.agentId !== undefined && !entry.launch.resume) {
        const counts = takeToolCounts(entry.agentId);
        if (counts !== undefined) {
          line["toolsScored"] = counts.toolsScored;
          line["toolsFlagged"] = counts.toolsFlagged;
        }
      }
      const status = STATUSES.find((s) => s === outcome?.status);
      line["status"] = outcome === undefined ? "error" : (status ?? "error");
      const durationMs = count(outcome?.durationMs);
      if (durationMs !== undefined) line["durationMs"] = durationMs;
      const toolUses = count(outcome?.toolUses);
      if (toolUses !== undefined) line["toolUses"] = toolUses;
      const t = outcome?.tokens;
      const tokens = isRecord(t) ? count(t["total"]) : undefined;
      if (tokens !== undefined) line["tokens"] = tokens;
      append(line);
    } catch {
      /* a failed ledger line never affects the launch */
    }
  };

  const remember = (id: string, entry: LaunchEntry): void => {
    cache.delete(id);
    cache.set(id, entry);
    while (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  };

  /** Fresh gate; returns the snapshot only when routing may act. */
  const gate = (ctx: ExtensionContext): Snapshot | undefined => {
    if (!active) return undefined;
    if (isChild(ctx.sessionManager.getSessionId())) return undefined;
    const snap = snapshot();
    if (!snap.config.valid || !snap.keySet || !snap.executor) return undefined;
    return snap.settings.switches.subagents ? snap : undefined;
  };

  const classify = (
    input: Record<string, unknown>,
    ctx: ExtensionContext,
    snap: Snapshot,
  ): LaunchEntry => {
    const { settings } = snap;
    const facts = readAgent(input["subagent_type"], { cwd: ctx.cwd, agentDir: agentDir() });
    const launch = effectiveLaunch(input, facts);
    const offered = offeredTiers(settings.tiers, settings.switches.expert);
    const kind = launchKind(launch, offered, settings.subagents.forkedLaunch);
    const entry: LaunchEntry = {
      facts,
      launch,
      kind,
      mode: settings.mode,
      offered,
      outcome: undefined,
      specs: {},
    };
    if (kind.kind === "untouched") return entry;

    const names: Partial<Record<TierName, string>> = {};
    if (kind.tierQuestion) {
      for (const tier of offered) {
        const parts = splitModel(settings.tiers[tier] ?? "");
        const found = parts === undefined ? undefined : ctx.modelRegistry.find(parts[0], parts[1]);
        if (found !== undefined && typeof found.name === "string") names[tier] = found.name;
      }
    }
    const { questions, specs } = buildWorkerQuestions(
      kind.tierQuestion ? offered : [],
      names,
      entry.mode,
    );
    const parentRequest = settings.state.parentRequest ? lastUserText(ctx) : undefined;
    const state = buildWorkerState({
      brief: typeof input["prompt"] === "string" ? input["prompt"] : "",
      ...(typeof input["description"] === "string" ? { description: input["description"] } : {}),
      agent: facts,
      runInBackground: launch.runInBackground,
      ...(parentRequest === undefined ? {} : { parentRequest }),
    });
    entry.specs = specs;
    entry.outcome = Promise.resolve(
      ask({
        url: settings.classifier.url,
        apiKey: process.env[snap.keyVar] ?? "",
        model: settings.classifier.model,
        timeoutMs: settings.classifier.timeoutMs,
        state,
        questions,
        ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
      }),
    ).catch((): JevOutcome => ({ kind: "miss", miss: "error", reason: "ask failed", ms: 0 }));
    return entry;
  };

  const warn = (
    ctx: ExtensionContext,
    snap: Snapshot,
    tier: TierName,
    why: string,
    to: TierName | undefined,
  ): void => {
    if (!ctx.hasUI) return;
    const model = snap.settings.tiers[tier] ?? "";
    const key = `${tier}\u0000${model}`;
    if (warned.has(key)) return;
    warned.add(key);
    const tail = to === undefined ? "launch left unchanged" : `using ${to}`;
    ctx.ui.notify(
      `Jev: tier ${tier} (${model}) cannot run (${why}); ${tail}. Fix tiers.${tier} in ${join(jevDir(), "config.json")}.`,
      "warning",
    );
  };

  const route = async (
    id: string,
    input: Record<string, unknown>,
    ctx: ExtensionContext,
    snap: Snapshot,
  ): Promise<void> => {
    let entry = cache.get(id);
    if (entry === undefined) {
      entry = classify(input, ctx, snap);
      remember(id, entry);
    }
    const caller = input["model"];
    if (typeof caller === "string" && CALLER_MODEL.test(caller)) entry.callerModel = caller;
    entry.seq = ++seq;
    entry.session = ctx.sessionManager.getSessionId();
    entry.briefChars = typeof input["prompt"] === "string" ? Array.from(input["prompt"]).length : 0;
    const outcome = entry.outcome === undefined ? undefined : await entry.outcome;
    const answers = outcome === undefined ? undefined : readWorkerOutcome(outcome, entry.specs);
    entry.jev = outcome;
    const { settings } = snap;
    const checks = new Map<TierName, Check>();
    const checkOf = (tier: TierName): Check => {
      let c = checks.get(tier);
      if (c === undefined) {
        c = checkTier(ctx, settings.tiers[tier] ?? "");
        checks.set(tier, c);
      }
      return c;
    };
    const writesModel =
      entry.kind.kind === "ask" && entry.kind.tierQuestion && !entry.launch.modelLocked;
    const result = routeLaunch({
      answers,
      launch: entry.launch,
      offered: entry.offered,
      mode: entry.mode,
      forkedLaunch: settings.subagents.forkedLaunch,
      canRun: (t) => !writesModel || checkOf(t).ok,
      thinkingOf: (t) => {
        const c = checkOf(t);
        return c.ok ? c.thinking : undefined;
      },
      modelOf: (t) => settings.tiers[t] ?? "",
    });
    entry.answers = answers;
    entry.route = result;
    if (result.kind !== "routed") return;

    const { model, thinking } = result.write;
    if (model !== undefined) input["model"] = model;
    if (thinking !== undefined) input["thinking"] = thinking;

    const decided = result.record.fallback;
    if (decided !== undefined && writesModel) {
      const c = checkOf(decided);
      if (!c.ok) {
        const to = result.record.tier === decided ? undefined : result.record.tier;
        try {
          warn(ctx, snap, decided, c.why, to);
        } catch {
          /* a failed warning never blocks the launch */
        }
      }
    }
  };

  const offs: (() => void)[] = [];

  offs.push(
    pi.on("message_end", async (event, ctx) => {
      try {
        const snap = gate(ctx);
        if (snap === undefined) return;
        const message: unknown = event.message;
        if (!isRecord(message) || message["role"] !== "assistant") return;
        const content = message["content"];
        if (!Array.isArray(content)) return;
        const pending: Promise<JevOutcome>[] = [];
        for (const block of content) {
          if (!isRecord(block) || block["type"] !== "toolCall" || block["name"] !== "subagent") {
            continue;
          }
          const id = block["id"];
          const args = block["arguments"];
          if (typeof id !== "string" || !isRecord(args)) continue;
          try {
            const entry = classify(args, ctx, snap);
            remember(id, entry);
            if (entry.outcome !== undefined) pending.push(entry.outcome);
          } catch {
            /* this launch is classified again at its tool_call */
          }
        }
        await Promise.all(pending);
      } catch {
        /* fail open */
      }
    }),
  );

  offs.push(
    pi.on("tool_call", async (event, ctx) => {
      try {
        if (event.toolName !== "subagent") return;
        const snap = gate(ctx);
        if (snap === undefined) return;
        await route(event.toolCallId, event.input as Record<string, unknown>, ctx, snap);
      } catch {
        /* fail open: the input stays as the caller sent it */
      }
    }),
  );

  offs.push(
    pi.on("tool_result", (event) => {
      try {
        if (!active || event.toolName !== "subagent") return;
        const entry = cache.get(event.toolCallId);
        cache.delete(event.toolCallId);
        const details: unknown = event.details;
        const agentId = isRecord(details) ? details["agentId"] : undefined;
        const named = typeof agentId === "string" && agentId !== "";
        if (entry !== undefined && named) entry.agentId = agentId;
        if (entry?.route === undefined || entry.route.kind === "skip") {
          // Nothing will be written for this launch: an outcome buffered for its agent
          // belongs to an earlier run or to this unwritten launch, so drop it.
          if (named) outcomes.delete(agentId);
          return;
        }
        if (!named) {
          write(entry, undefined);
          return;
        }
        const buffered = outcomes.get(agentId);
        outcomes.delete(agentId);
        // Only an outcome that arrived after this launch's tool_call can be its own.
        if (buffered === undefined || buffered.seq < (entry.seq ?? 0)) {
          put(byAgent, agentId, entry);
          return;
        }
        write(entry, buffered.outcome);
      } catch {
        /* fail open */
      }
    }),
  );

  for (const name of EVENTS) {
    try {
      offs.push(
        pi.events.on(name, (data: unknown) => {
          try {
            if (!active || !isRecord(data) || typeof data["id"] !== "string") return;
            const id = data["id"];
            const entry = byAgent.get(id);
            if (entry === undefined) {
              put(outcomes, id, { seq: ++seq, outcome: slim(data) });
              return;
            }
            byAgent.delete(id);
            write(entry, slim(data));
          } catch {
            /* fail open */
          }
        }),
      );
    } catch {
      /* a missing event bus leaves only the refused-launch lines */
    }
  }

  return {
    off() {
      active = false;
      for (const off of offs.splice(0)) {
        try {
          off();
        } catch {
          /* keep shutdown clean */
        }
      }
      cache.clear();
      byAgent.clear();
      outcomes.clear();
    },
    clearWarnings() {
      warned.clear();
    },
    pending: () => cache.size + byAgent.size + outcomes.size,
  };
}
