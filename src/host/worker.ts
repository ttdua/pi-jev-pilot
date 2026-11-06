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
import type { ModelThinking } from "../policy/effort.ts";
import {
  effectiveLaunch,
  type AgentFacts,
  type EffectiveLaunch,
  type TierName,
} from "../policy/launch.ts";
import { launchKind, routeLaunch, type LaunchKind, type Route } from "../policy/route.ts";
import { readWorkerOutcome, type WorkerAnswers } from "../policy/worker.ts";
import { readAgent } from "./agents.ts";
import { isChild } from "./child.ts";
import { loadSnapshot, type Snapshot } from "./readiness.ts";
import { jevDir } from "./stores.ts";

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
  /** Number of launches kept by tool call id. */
  pending(): number;
};

/** What a launch needs from `message_end` until its `tool_call` (and later, its ledger line). */
export type LaunchEntry = {
  facts: AgentFacts;
  launch: EffectiveLaunch;
  kind: LaunchKind;
  offered: readonly TierName[];
  outcome: Promise<JevOutcome> | undefined;
  specs: Record<string, QuestionSpec>;
  route?: Route;
  answers?: WorkerAnswers | undefined;
};

const CACHE_MAX = 256;

type Check = { ok: true; thinking: ModelThinking } | { ok: false; why: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
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
  let active = true;

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
    const entry: LaunchEntry = { facts, launch, kind, offered, outcome: undefined, specs: {} };
    if (kind.kind === "untouched") return entry;

    const names: Partial<Record<TierName, string>> = {};
    if (kind.tierQuestion) {
      for (const tier of offered) {
        const parts = splitModel(settings.tiers[tier] ?? "");
        const found = parts === undefined ? undefined : ctx.modelRegistry.find(parts[0], parts[1]);
        if (found !== undefined && typeof found.name === "string") names[tier] = found.name;
      }
    }
    const { questions, specs } = buildWorkerQuestions(kind.tierQuestion ? offered : [], names);
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
    const outcome = entry.outcome === undefined ? undefined : await entry.outcome;
    const answers = outcome === undefined ? undefined : readWorkerOutcome(outcome, entry.specs);
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
    },
    clearWarnings() {
      warned.clear();
    },
    pending: () => cache.size,
  };
}
