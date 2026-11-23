import type { Config, Slot } from "./config.ts";
import type { Feature, Mode, Tier } from "./defaults.ts";
import {
  resolveClassifier,
  resolveCrew,
  resolveEffort,
  resolveMode,
  resolveSkills,
  resolveStateSection,
  resolveSubagents,
  resolveSwitches,
  resolveTiers,
  resolveTurnFloors,
} from "./settings-sections.ts";
import type { BandFloors, FloorBand } from "../shared/turn-floors.ts";
import type { State } from "./state-file.ts";

export { untunedTimeout } from "./settings-sections.ts";

type Tuned = { value?: unknown; base?: unknown };

export type Tuning = {
  timeoutMs?: Tuned;
  turnFloors?: Partial<Record<FloorBand, { tuned?: Tuned }>>;
};

export type Settings = {
  classifier: { url: string; model: string; apiKeyEnv: string; timeoutMs: number };
  turnFloors: BandFloors;
  tiers: Partial<Record<Tier, string>>;
  crew: { slots: Slot[] };
  effort: { holdProviders: string[] };
  skills: { inject: "content" | "suggest" };
  state: { parentRequest: boolean };
  subagents: { forkLaunch: "untouched" | "thinking" };
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
    turnFloors: resolveTurnFloors(tuning),
    tiers: resolveTiers(config),
    crew: resolveCrew(config),
    effort: resolveEffort(config),
    skills: resolveSkills(config),
    state: resolveStateSection(config),
    subagents: resolveSubagents(config),
    ...resolveMode(state, localMode),
    switches: resolveSwitches(state),
  };
}
