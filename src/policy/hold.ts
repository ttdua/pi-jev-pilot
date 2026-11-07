// Pure rule deciding whether a main prompt keeps its effort. Imports nothing outside src/policy/.

import type { ThinkingLevel } from "./effort.ts";

export type HoldAnchor = { provider: string; model: string; level: ThinkingLevel };

export function isHeld(o: {
  provider: string | undefined;
  model: string | undefined;
  holdProviders: readonly string[];
  anchor: HoldAnchor | undefined;
}): boolean {
  const { provider, model, holdProviders, anchor } = o;
  if (provider === undefined || model === undefined || anchor === undefined) return false;
  return holdProviders.includes(provider) && anchor.provider === provider && anchor.model === model;
}
