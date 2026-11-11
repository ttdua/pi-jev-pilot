import type { Config } from "./config.ts";
import { DEFAULTS, FEATURES, type Feature, type Mode } from "./defaults.ts";
import type { Settings, Tuning } from "./settings.ts";
import type { State } from "./state-file.ts";

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

export function resolveClassifier(
  config: Config,
  tuning: Tuning | undefined,
): Settings["classifier"] {
  const c = config.classifier;
  const untuned = untunedTimeout(config);
  return {
    url: c?.url ?? DEFAULTS.classifier.url,
    model: c?.model ?? DEFAULTS.classifier.model,
    apiKeyEnv: c?.apiKeyEnv ?? DEFAULTS.classifier.apiKeyEnv,
    timeoutMs: tunedTimeout(tuning, untuned) ?? untuned,
  };
}

export function resolveTiers(config: Config): Settings["tiers"] {
  return { ...config.tiers };
}

export function resolveCrew(config: Config): Settings["crew"] {
  return { slots: (config.crew?.slots ?? []).map((s) => ({ ...s })) };
}

export function resolveEffort(config: Config): Settings["effort"] {
  return { holdProviders: [...(config.effort?.holdProviders ?? DEFAULTS.effort.holdProviders)] };
}

export function resolveSkills(config: Config): Settings["skills"] {
  return { inject: config.skills?.inject ?? (DEFAULTS.skills.inject as "content" | "suggest") };
}

export function resolveTools(config: Config): Settings["tools"] {
  return {
    mode: config.tools?.mode ?? (DEFAULTS.tools.mode as "observe" | "enforce"),
    grantAt: config.tools?.grantAt ?? DEFAULTS.tools.grantAt,
  };
}

export function resolveStateSection(config: Config): Settings["state"] {
  return { parentRequest: config.state?.parentRequest ?? DEFAULTS.state.parentRequest };
}

export function resolveSubagents(config: Config): Settings["subagents"] {
  return {
    forkedLaunch:
      config.subagents?.forkedLaunch ??
      (DEFAULTS.subagents.forkedLaunch as "untouched" | "thinking"),
  };
}

export function resolveReview(config: Config, state: State): Settings["review"] {
  const enabled = state.cliReviewEnabled ?? config.review?.enabled ?? DEFAULTS.review.enabled;
  const review: Settings["review"] = state.cliReview
    ? { cli: state.cliReview.cli, enabled }
    : { cli: config.review?.cli ?? (DEFAULTS.review.cli as "codex" | "opencode"), enabled };
  if (state.cliReview?.model !== undefined) review.model = state.cliReview.model;
  if (state.cliReview?.effort !== undefined) review.effort = state.cliReview.effort;
  return review;
}

/** Effective mode: the directory override when set, else the global mode. */
export function resolveMode(
  state: State,
  localMode: Mode | undefined,
): Pick<Settings, "mode" | "modeSource" | "globalMode"> {
  const globalMode = state.mode ?? DEFAULTS.mode;
  return {
    mode: localMode ?? globalMode,
    modeSource: localMode ? "local" : "global",
    globalMode,
  };
}

export function resolveSwitches(state: State): Settings["switches"] {
  const switches = { ...DEFAULTS.switches } as Record<Feature, boolean>;
  for (const f of FEATURES) {
    const v = state.switches?.[f];
    if (typeof v === "boolean") switches[f] = v;
  }
  return switches;
}
