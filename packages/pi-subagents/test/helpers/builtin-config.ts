/**
 * builtin-config.ts — The real built-in agent configs, loaded from the executor's
 * own agents/ directory with no package, global or project agents.
 */
import { join } from "node:path";
import { loadCustomAgents } from "#src/config/custom-agents";
import { builtinAgentDirs } from "#src/config/package-agents";
import type { AgentConfig } from "#src/types";

export function builtinConfig(name: string): AgentConfig {
  const agents = loadCustomAgents(join(import.meta.dirname, "no-project"), { builtinDirs: builtinAgentDirs(), packageDirs: [] });
  const config = [...agents.values()].find((a) => a.source === "builtin" && a.name === name);
  if (!config) throw new Error(`no built-in agent ${name}`);
  return config;
}
