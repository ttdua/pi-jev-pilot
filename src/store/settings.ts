import type { Config, Slot } from "./config.ts";
import type { Feature, Mode, Tier } from "./defaults.ts";
import {
  resolveClassifier,
  resolveCrew,
  resolveEffort,
  resolveMode,
  resolveReview,
  resolveSkills,
  resolveStateSection,
  resolveSubagents,
  resolveSwitches,
  resolveTiers,
  resolveTools,
} from "./settings-sections.ts";
import type { State } from "./state-file.ts";

export { untunedTimeout } from "./settings-sections.ts";

export type Tuning = { timeoutMs?: { value?: unknown; base?: unknown } };

export type Settings = {
  classifier: { url: string; model: string; apiKeyEnv: string; timeoutMs: number };
  tiers: Partial<Record<Tier, string>>;
  crew: { slots: Slot[] };
  effort: { holdProviders: string[] };
  skills: { inject: "content" | "suggest" };
  tools: { mode: "observe" | "enforce" };
  state: { parentRequest: boolean };
  subagents: { forkedLaunch: "untouched" | "thinking" };
  review: { cli: "codex" | "opencode"; enabled: boolean; model?: string; effort?: string };
  /** Effective mode: the directory override when set, else the global mode. */
  mode: Mode;
  modeSource: "local" | "global";
  globalMode: Mode;
  switches: Record<Feature, boolean>;
};

/** Pure: tuning > state > config > default. Returns fresh objects and arrays. */
export function resolveSettings(input: {
  config: Config;
  state: State;
  tuning?: Tuning;
  localMode?: Mode;
}): Settings {
  const { config, state, tuning, localMode } = input;
  return {
    classifier: resolveClassifier(config, tuning),
    tiers: resolveTiers(config),
    crew: resolveCrew(config),
    effort: resolveEffort(config),
    skills: resolveSkills(config),
    tools: resolveTools(config),
    state: resolveStateSection(config),
    subagents: resolveSubagents(config),
    review: resolveReview(config, state),
    ...resolveMode(state, localMode),
    switches: resolveSwitches(state),
  };
}
