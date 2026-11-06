import type { Config, Slot } from "./config.ts";
import { DEFAULTS, FEATURES, type Feature, type Mode, type Tier } from "./defaults.ts";
import type { State } from "./state-file.ts";

export type Tuning = { classifier?: { timeoutMs?: unknown } };

export type Settings = {
  classifier: { url: string; model: string; apiKeyEnv: string; timeoutMs: number };
  tiers: Partial<Record<Tier, string>>;
  crew: { slots: Slot[] };
  effort: { holdProviders: string[] };
  skills: { inject: "content" | "suggest" };
  tools: { mode: "observe" | "enforce" };
  state: { parentRequest: boolean };
  subagents: { forkedLaunch: "untouched" | "thinking" };
  review: { cli: "codex" | "opencode"; model?: string; effort?: string };
  mode: Mode;
  switches: Record<Feature, boolean>;
};

const TIMEOUT_MIN = 300;
const TIMEOUT_MAX = 5000;

function tunedTimeout(tuning: Tuning | undefined): number | undefined {
  const v = tuning?.classifier?.timeoutMs;
  return typeof v === "number" && Number.isInteger(v) && v >= TIMEOUT_MIN && v <= TIMEOUT_MAX
    ? v
    : undefined;
}

/** Pure: tuning > state > config > default. Returns fresh objects and arrays. */
export function resolveSettings(input: {
  config: Config;
  state: State;
  tuning?: Tuning;
}): Settings {
  const { config, state, tuning } = input;
  const c = config.classifier;

  const switches = { ...DEFAULTS.switches } as Record<Feature, boolean>;
  for (const f of FEATURES) {
    const v = state.switches?.[f];
    if (typeof v === "boolean") switches[f] = v;
  }

  const review: Settings["review"] = state.cliReview
    ? { cli: state.cliReview.cli }
    : { cli: config.review?.cli ?? (DEFAULTS.review.cli as "codex" | "opencode") };
  if (state.cliReview?.model !== undefined) review.model = state.cliReview.model;
  if (state.cliReview?.effort !== undefined) review.effort = state.cliReview.effort;

  return {
    classifier: {
      url: c?.url ?? DEFAULTS.classifier.url,
      model: c?.model ?? DEFAULTS.classifier.model,
      apiKeyEnv: c?.apiKeyEnv ?? DEFAULTS.classifier.apiKeyEnv,
      timeoutMs: tunedTimeout(tuning) ?? c?.timeoutMs ?? DEFAULTS.classifier.timeoutMs,
    },
    tiers: { ...config.tiers },
    crew: { slots: (config.crew?.slots ?? []).map((s) => ({ ...s })) },
    effort: { holdProviders: [...(config.effort?.holdProviders ?? DEFAULTS.effort.holdProviders)] },
    skills: { inject: config.skills?.inject ?? (DEFAULTS.skills.inject as "content" | "suggest") },
    tools: { mode: config.tools?.mode ?? (DEFAULTS.tools.mode as "observe" | "enforce") },
    state: { parentRequest: config.state?.parentRequest ?? DEFAULTS.state.parentRequest },
    subagents: {
      forkedLaunch:
        config.subagents?.forkedLaunch ??
        (DEFAULTS.subagents.forkedLaunch as "untouched" | "thinking"),
    },
    review,
    mode: state.mode ?? DEFAULTS.mode,
    switches,
  };
}
