/**
 * make-registry.ts — AgentTypeRegistry fixture whose loader always holds an
 * enabled built-in `general`, as the executor's own agents/ directory provides.
 */
import { AgentTypeRegistry } from "#src/config/agent-types";
import type { AgentConfig } from "#src/types";
import { makeAgentConfig } from "#test/helpers/make-agent-config";

/** The `general` agent as the built-in directory declares it. */
export function makeGeneralAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return makeAgentConfig({
    name: "general",
    description: "general-purpose work on complex, multi-step tasks, including file edits",
    toolNames: undefined,
    toolsDeclared: false,
    systemPrompt: "General role.",
    source: "builtin",
    ...overrides,
  });
}

/** A registry over `load`'s agents plus `general`, unless `load` defines its own. */
export function registryWithGeneral(load: () => Map<string, AgentConfig> = () => new Map()): AgentTypeRegistry {
  return new AgentTypeRegistry(() => {
    const agents = load();
    if (![...agents.keys()].some((name) => name.toLowerCase() === "general")) {
      return new Map([["general", makeGeneralAgent()], ...agents]);
    }
    return agents;
  });
}
