/**
 * builtin-config.ts — The real built-in agent configs, loaded from the executor's
 * own agents/ directory with no package, global or project agents.
 */
import { join } from "node:path";
import { loadCustomAgents } from "#src/config/custom-agents";
import { builtinAgentDirs } from "#src/config/package-agents";
import type { AgentConfig } from "#src/types";

export function builtinConfig(name: string): AgentConfig {
  // Hermetic: point the global agent dir at an empty path so the operator's real agents never load.
  const saved = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(import.meta.dirname, "no-global");
  try {
    const agents = loadCustomAgents(join(import.meta.dirname, "no-project"), { builtinDirs: builtinAgentDirs(), packageDirs: [] });
    const config = [...agents.values()].find((a) => a.source === "builtin" && a.name === name);
    if (!config) throw new Error(`no built-in agent ${name}`);
    return config;
  } finally {
    if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = saved;
  }
}
