import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { askJev, JevOutcome } from "../../jev/client.ts";
import { buildWorkerQuestions, type SlotOption } from "../../jev/questions.ts";
import { buildWorkerState } from "../../jev/state.ts";
import type { TierName } from "../../policy/launch.ts";
import type { WindowEntry } from "../../policy/worker/index.ts";
import type { Slot } from "../../store/config.ts";
import { splitModel, type Snapshot } from "../platform/index.ts";
import { isRecord, type LaunchEntry } from "./entry.ts";
import { newEntry, type PolicyCall } from "./request.ts";

type Registry = Pick<ExtensionContext, "modelRegistry">;
type Settings = Snapshot["settings"];

/** What classifying a launch needs besides the policy call. */
export type ClassifyDeps = {
  ask: typeof askJev;
  window: () => readonly WindowEntry[];
  /** The API key value for the snapshot's key variable, read when the launch is classified. */
  apiKey: (keyVar: string) => string;
};

export const ASK_FAILED: JevOutcome = { kind: "miss", miss: "error", reason: "ask failed", ms: 0 };

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
function displayName(ctx: Registry, model: string): string | undefined {
  const parts = splitModel(model);
  const found = parts === undefined ? undefined : ctx.modelRegistry.find(parts[0], parts[1]);
  return typeof found?.name === "string" ? found.name : undefined;
}

function tierNames(
  ctx: Registry,
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

function slotOptions(ctx: Registry, slots: readonly Slot[]): SlotOption[] {
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

/** The cut-point window, called detached: `window` never receives a `this`. */
function windowEntries(deps: ClassifyDeps): readonly WindowEntry[] {
  const { window } = deps;
  return window();
}

/** The worker classifier state: the brief, the agent and, when enabled, the parent request. */
function workerState(call: PolicyCall, settings: Settings, entry: LaunchEntry) {
  const parentRequest = settings.state.parentRequest ? lastUserText(call.ctx) : undefined;
  const { prompt, description } = call.request;
  return buildWorkerState({
    brief: prompt,
    description,
    agent: entry.facts,
    runInBackground: entry.launch.runInBackground,
    ...(parentRequest === undefined ? {} : { parentRequest }),
  });
}

/**
 * Reads the agent and the launch, decides what to ask, and starts the Jev request, bounded by
 * the launch's shared classifier deadline. A rejected request reads as an error miss.
 */
export function classifyLaunch(call: PolicyCall, deps: ClassifyDeps): LaunchEntry {
  const { settings, keyVar } = call.snap;
  const entry = newEntry(call, windowEntries(deps));
  const { kind, offered, slots } = entry;
  if (kind.kind === "untouched") return entry;
  const { questions, specs } = buildWorkerQuestions(
    kind.tierQuestion ? offered : [],
    kind.tierQuestion ? tierNames(call.ctx, settings.tiers, offered) : {},
    kind.tierQuestion ? slotOptions(call.ctx, slots) : [],
  );
  const state = workerState(call, settings, entry);
  // Called detached: `ask` never receives a `this`.
  const { ask } = deps;
  entry.specs = specs;
  entry.outcome = Promise.resolve()
    .then(() =>
      ask({
        url: settings.classifier.url,
        apiKey: deps.apiKey(keyVar),
        model: settings.classifier.model,
        timeoutMs: call.remainingMs(),
        state,
        questions,
        signal: call.signal,
      }),
    )
    .catch((): JevOutcome => ASK_FAILED);
  return entry;
}
