import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { askJev, JevOutcome } from "../../jev/client.ts";
import { buildWorkerQuestions, offeredTiers, type SlotOption } from "../../jev/questions.ts";
import { buildWorkerState } from "../../jev/state.ts";
import { effectiveLaunch, type TierName } from "../../policy/launch.ts";
import { cutPointsFor, launchKind, type WindowEntry } from "../../policy/worker/index.ts";
import type { Slot } from "../../store/config.ts";
import { readAgent, splitModel, type Snapshot } from "../platform/index.ts";
import { isRecord, type LaunchEntry } from "./entry.ts";

type Ctx = Pick<ExtensionContext, "cwd" | "signal" | "sessionManager" | "modelRegistry">;
type Settings = Snapshot["settings"];
type Input = Record<string, unknown>;

/** What classifying a launch needs besides the launch and the context. */
export type ClassifyDeps = {
  ask: typeof askJev;
  agentDir: () => string;
  window: () => readonly WindowEntry[];
  /** The API key value for the snapshot's key variable, read when the launch is classified. */
  apiKey: (keyVar: string) => string;
};

const ASK_FAILED: JevOutcome = { kind: "miss", miss: "error", reason: "ask failed", ms: 0 };

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((p): p is { type: "text"; text: string } => isRecord(p) && p["type"] === "text")
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .join("\n");
}

/** Text of the last user message on the branch, or undefined when empty. */
export function lastUserText(ctx: Pick<ExtensionContext, "sessionManager">): string | undefined {
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

/** Registry display name of a `provider/model` id, when the registry has one. */
function displayName(ctx: Ctx, model: string): string | undefined {
  const parts = splitModel(model);
  const found = parts === undefined ? undefined : ctx.modelRegistry.find(parts[0], parts[1]);
  return typeof found?.name === "string" ? found.name : undefined;
}

function tierNames(
  ctx: Ctx,
  tiers: Partial<Record<TierName, string>>,
  offered: readonly TierName[],
): Partial<Record<TierName, string>> {
  const names: Partial<Record<TierName, string>> = {};
  for (const tier of offered) {
    const name = displayName(ctx, tiers[tier] ?? "");
    if (name !== undefined) names[tier] = name;
  }
  return names;
}

function slotOptions(ctx: Ctx, slots: readonly Slot[]): SlotOption[] {
  return slots.map((slot) => {
    const name = displayName(ctx, slot.model);
    return {
      name: slot.name,
      model: slot.model,
      when: slot.when,
      ...(name ? { displayName: name } : {}),
    };
  });
}

/** The launch as routing first sees it, before any classifier question is asked. */
function newEntry(input: Input, ctx: Ctx, settings: Settings, deps: ClassifyDeps): LaunchEntry {
  const facts = readAgent(input["subagent_type"], { cwd: ctx.cwd, agentDir: deps.agentDir() });
  const launch = effectiveLaunch(input, facts);
  const offered = offeredTiers(settings.tiers, settings.switches.expert);
  const slots = settings.crew.slots.map((s) => ({ name: s.name, model: s.model, when: s.when }));
  return {
    facts,
    launch,
    kind: launchKind(launch, offered, settings.subagents.forkedLaunch, slots.length),
    mode: settings.mode,
    cuts: cutPointsFor(deps.window(), settings.mode),
    offered,
    slots,
    outcome: undefined,
    specs: {},
  };
}

/** The worker classifier state: the brief, the agent and, when enabled, the parent request. */
function workerState(input: Input, ctx: Ctx, settings: Settings, entry: LaunchEntry) {
  const parentRequest = settings.state.parentRequest ? lastUserText(ctx) : undefined;
  return buildWorkerState({
    brief: typeof input["prompt"] === "string" ? input["prompt"] : "",
    ...(typeof input["description"] === "string" ? { description: input["description"] } : {}),
    agent: entry.facts,
    runInBackground: entry.launch.runInBackground,
    ...(parentRequest === undefined ? {} : { parentRequest }),
  });
}

/**
 * Reads the agent and the launch, decides what to ask, and starts the Jev request. The request
 * runs in the background; a rejected request reads as an error miss.
 */
export function classifyLaunch(
  input: Input,
  ctx: Ctx,
  snap: Snapshot,
  deps: ClassifyDeps,
): LaunchEntry {
  const { settings } = snap;
  const entry = newEntry(input, ctx, settings, deps);
  const { kind, offered, slots } = entry;
  if (kind.kind === "untouched") return entry;
  const { questions, specs } = buildWorkerQuestions(
    kind.tierQuestion ? offered : [],
    kind.tierQuestion ? tierNames(ctx, settings.tiers, offered) : {},
    kind.tierQuestion ? slotOptions(ctx, slots) : [],
  );
  const state = workerState(input, ctx, settings, entry);
  // Called detached, as before the split: `ask` never receives a `this`.
  const { ask } = deps;
  entry.specs = specs;
  entry.outcome = Promise.resolve(
    ask({
      url: settings.classifier.url,
      apiKey: deps.apiKey(snap.keyVar),
      model: settings.classifier.model,
      timeoutMs: settings.classifier.timeoutMs,
      state,
      questions,
      ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
    }),
  ).catch((): JevOutcome => ASK_FAILED);
  return entry;
}
