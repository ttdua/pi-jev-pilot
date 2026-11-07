import type { Config, Slot } from "./config.ts";
import { DEFAULTS, FEATURES, type Feature, type Mode, type Tier } from "./defaults.ts";
import type { State } from "./state-file.ts";

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
  mode: Mode;
  switches: Record<Feature, boolean>;
};

const TIMEOUT_MIN = 300;
const TIMEOUT_MAX = 5000;

function inRange(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= TIMEOUT_MIN && v <= TIMEOUT_MAX;
}

/** The tuned value applies only while the value it was tuned from is still the untuned one. */
function tunedTimeout(tuning: Tuning | undefined, untuned: number): number | undefined {
  const t = tuning?.timeoutMs;
  return inRange(t?.value) && inRange(t?.base) && t.base === untuned ? t.value : undefined;
}

/** The timeout before tuning: config value, else the default. */
export function untunedTimeout(config: Config): number {
  return config.classifier?.timeoutMs ?? DEFAULTS.classifier.timeoutMs;
}

/** Pure: tuning > state > config > default. Returns fresh objects and arrays. */
export function resolveSettings(input: {
  config: Config;
  state: State;
  tuning?: Tuning;
}): Settings {
  const { config, state, tuning } = input;
  const c = config.classifier;
  const untuned = untunedTimeout(config);

  const switches = { ...DEFAULTS.switches } as Record<Feature, boolean>;
  for (const f of FEATURES) {
    const v = state.switches?.[f];
    if (typeof v === "boolean") switches[f] = v;
  }

  const enabled = state.cliReviewEnabled ?? config.review?.enabled ?? DEFAULTS.review.enabled;
  const review: Settings["review"] = state.cliReview
    ? { cli: state.cliReview.cli, enabled }
    : { cli: config.review?.cli ?? (DEFAULTS.review.cli as "codex" | "opencode"), enabled };
  if (state.cliReview?.model !== undefined) review.model = state.cliReview.model;
  if (state.cliReview?.effort !== undefined) review.effort = state.cliReview.effort;

  return {
    classifier: {
      url: c?.url ?? DEFAULTS.classifier.url,
      model: c?.model ?? DEFAULTS.classifier.model,
      apiKeyEnv: c?.apiKeyEnv ?? DEFAULTS.classifier.apiKeyEnv,
      timeoutMs: tunedTimeout(tuning, untuned) ?? untuned,
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
