// Model id helpers shared by worker routing and the slot commands.
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { ModelThinking } from "../policy/effort.ts";
import { slotTarget, type Target, type TierName } from "../policy/launch.ts";
import { editDistance } from "../shared/text.ts";
import type { Slot } from "../store/config.ts";

export type ModelCheck =
  | { ok: true; thinking: ModelThinking }
  | { ok: false; why: "not a provider/model" | "not in the model registry" | "no credentials" };

/** `provider/model` split at the first slash; the model part may hold more slashes. */
export function splitModel(id: string): [string, string] | undefined {
  const at = id.indexOf("/");
  return at <= 0 || at === id.length - 1 ? undefined : [id.slice(0, at), id.slice(at + 1)];
}

export function checkModel(registry: ModelRegistry, id: string): ModelCheck {
  const parts = splitModel(id);
  if (parts === undefined) return { ok: false, why: "not a provider/model" };
  const model = registry.find(parts[0], parts[1]);
  if (model === undefined) return { ok: false, why: "not in the model registry" };
  if (!registry.hasConfiguredAuth(model)) return { ok: false, why: "no credentials" };
  return {
    ok: true,
    thinking: { reasoning: model.reasoning, thinkingLevelMap: model.thinkingLevelMap },
  };
}

/** Up to `max` usable models (with credentials) closest to `id`, best first. */
export function nearestModels(registry: ModelRegistry, id: string, max = 3): string[] {
  const wanted = id.toLowerCase();
  return registry
    .getAvailable()
    .map((m) => `${m.provider}/${m.id}`)
    .map((name) => ({ name, distance: editDistance(name.toLowerCase(), wanted) }))
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name))
    .slice(0, max)
    .map((entry) => entry.name);
}

/** The model id a target runs on: a tier from `tiers`, a slot from `slots` by name. */
export function resolveModel(
  target: Target,
  tiers: Partial<Record<TierName, string>>,
  slots: readonly Slot[],
): string | undefined {
  const slot = slots.find((s) => slotTarget(s.name) === target);
  return slot !== undefined ? slot.model : tiers[target as TierName];
}
