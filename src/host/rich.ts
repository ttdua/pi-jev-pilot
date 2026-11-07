import { pickRich, type GitCounts, type RichGroup, type RichInputs } from "../jev/state.ts";
import type { AgentFacts } from "../policy/launch.ts";

export type RichSources = {
  groups: readonly RichGroup[];
  cwd: string;
  last?: { effort?: string; strategy?: string };
  git?: Promise<GitCounts | undefined>;
  tools: () => { name: string; description: string }[];
  agents: () => AgentFacts[];
};

/** Builds one group's input; a throw is the caller's to absorb. */
type Builder = (i: RichSources) => Promise<RichInputs> | RichInputs;

const BUILDERS: Record<RichGroup, Builder> = {
  last_decision: (i) => (i.last === undefined ? {} : { lastDecision: i.last }),
  git: async (i) => {
    const git = await i.git;
    return git === undefined ? {} : { git };
  },
  capabilities: (i) => ({
    capabilities: {
      tools: i.tools(),
      agents: i.agents().map((a) => ({
        name: a.name,
        description: a.description,
        tools: a.declaredTools,
      })),
    },
  }),
};

/** Raw inputs for the listed groups only. A group that throws is left out; the rest stay. */
export async function buildRichInputs(i: RichSources): Promise<RichInputs> {
  const all: RichInputs = {};
  for (const group of i.groups) {
    try {
      Object.assign(all, await BUILDERS[group](i));
    } catch {
      /* fail open: this group is omitted */
    }
  }
  return pickRich(all, i.groups);
}
