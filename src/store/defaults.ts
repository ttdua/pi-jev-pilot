export const FEATURES = [
  "effort",
  "subagents",
  "skills",
  "strategy",
  "frontier",
  "status",
  "verbose",
] as const;
export type Feature = (typeof FEATURES)[number];

export const MODES = ["budget", "standard", "premium"] as const;
export type Mode = (typeof MODES)[number];

export const TIERS = ["basic", "broad", "deep", "frontier"] as const;
export type Tier = (typeof TIERS)[number];

// DEPRECATED(remove next minor)
/** The pre-rename tier names and what they became; read paths only. `policy/launch.ts` holds the same map. */
export const LEGACY_TIER: Readonly<Record<"fast" | "balanced" | "expert", Tier>> = {
  fast: "basic",
  balanced: "broad",
  expert: "frontier",
};

export const RESERVED_SLOT_NAMES: readonly string[] = [
  "all",
  "budget",
  "cli-review",
  "default",
  "effort",
  "expert", // DEPRECATED(remove next minor): the old name of `frontier`
  "frontier",
  "mode",
  "off",
  "on",
  "premium",
  "remove",
  "reset",
  "review",
  "skills",
  "standard",
  "status",
  "strategy",
  "subagents",
  "tools",
  "tune",
  "verbose",
];

export const DEFAULTS = {
  classifier: {
    url: "https://api.typesafe.ai/v1/systemone",
    model: "jev-latest",
    apiKeyEnv: "TYPESAFE_API_KEY",
    timeoutMs: 1500,
  },
  effort: { holdProviders: [] as readonly string[] },
  skills: { inject: "content" },
  state: { parentRequest: false },
  subagents: { forkLaunch: "untouched" },
  mode: "standard" as Mode,
  switches: {
    effort: true,
    subagents: true,
    skills: true,
    strategy: true,
    frontier: true,
    status: true,
    verbose: false,
  } as Readonly<Record<Feature, boolean>>,
} as const;

/** The five decision features, in display order; excludes `status` and `verbose`. */
export const DECISION_FEATURES: readonly Feature[] = [
  "effort",
  "subagents",
  "skills",
  "strategy",
  "frontier",
];
