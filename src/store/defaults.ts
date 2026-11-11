export const FEATURES = [
  "effort",
  "subagents",
  "skills",
  "strategy",
  "tools",
  "expert",
  "status",
  "verbose",
] as const;
export type Feature = (typeof FEATURES)[number];

export const MODES = ["budget", "standard", "premium"] as const;
export type Mode = (typeof MODES)[number];

export const TIERS = ["fast", "balanced", "deep", "expert"] as const;
export type Tier = (typeof TIERS)[number];

export const RESERVED_SLOT_NAMES: readonly string[] = [
  "all",
  "budget",
  "cli-review",
  "default",
  "effort",
  "expert",
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
  effort: { holdProviders: ["9router"] as readonly string[] },
  skills: { inject: "content" },
  tools: { mode: "observe", grantAt: 0.8 },
  state: { parentRequest: false },
  subagents: { forkedLaunch: "untouched" },
  review: { cli: "codex", enabled: false },
  mode: "standard" as Mode,
  switches: {
    effort: true,
    subagents: true,
    skills: true,
    strategy: true,
    tools: true,
    expert: true,
    status: true,
    verbose: false,
  } as Readonly<Record<Feature, boolean>>,
} as const;

/** The six decision features, in display order; excludes `status` and `verbose`. */
export const DECISION_FEATURES: readonly Feature[] = [
  "effort",
  "subagents",
  "skills",
  "strategy",
  "tools",
  "expert",
];
