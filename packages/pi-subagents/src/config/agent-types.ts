/**
 * agent-types.ts — Unified agent type registry.
 *
 * Holds whatever `loadUserAgents` returns: built-in, package, global and project agents,
 * already merged by the loader. Disabled agents are kept but excluded from spawning.
 */

import type { AgentConfig } from "#src/types";

/** The agent a launch falls back to when the requested name matches none. */
export const FALLBACK_AGENT = "general";

/** Thrown when a launch needs the fallback agent and it is absent or disabled. */
export class MissingFallbackAgentError extends Error {
  constructor() {
    super(`Agent type "${FALLBACK_AGENT}" is not available; the built-in agents are missing or disabled`);
    this.name = "MissingFallbackAgentError";
  }
}

// ── AgentConfigLookup interface ──────────────────────────────────────────────

/**
 * Narrow registry interface for consumers that only need config resolution.
 * Prefer this over the full `AgentTypeRegistry` in function signatures (ISP).
 */
export interface AgentConfigLookup {
  resolveAgentConfig(type: string): AgentConfig;
  getToolNamesForType(type: string): string[];
  /** Exact then case-insensitive lookup; no alias, no fallback. For display paths. */
  findAgentConfig(type: string): AgentConfig | undefined;
}

// ── AgentTypeRegistry class ──────────────────────────────────────────────────

/**
 * Injectable registry of all agent configurations (defaults + user-defined).
 *
 * Replaces the module-scoped `agents` Map and its companion free functions.
 * The constructor accepts a `loadUserAgents` callback to defer disk I/O to the
 * call site, keeping this class side-effect-free and easy to test.
 */
export class AgentTypeRegistry implements AgentConfigLookup {
  private agents = new Map<string, AgentConfig>();

  constructor(private loadUserAgents: () => Map<string, AgentConfig>) {
    this.reload();
  }

  /**
   * Re-scan every agent source and rebuild the registry from `loadUserAgents()`.
   */
  reload(): void {
    this.agents.clear();
    for (const [name, config] of this.loadUserAgents()) {
      this.agents.set(name, config);
    }
  }

  /**
   * Resolve a type name: exact, case-insensitive, then `general-purpose` as an alias of
   * the fallback when no agent of that name exists. Returns the canonical key or undefined.
   */
  resolveType(name: string): string | undefined {
    const key = this.resolveKey(name);
    if (key !== undefined) return key;
    return name.toLowerCase() === "general-purpose" ? this.resolveKey(FALLBACK_AGENT) : undefined;
  }

  /** Exact then case-insensitive lookup; no alias, no fallback. */
  findAgentConfig(type: string): AgentConfig | undefined {
    const key = this.resolveKey(type);
    return key === undefined ? undefined : this.agents.get(key);
  }

  /** Get all enabled type names (for spawning and tool descriptions). */
  getAvailableTypes(): string[] {
    return [...this.agents.entries()]
      .filter(([_, config]) => config.enabled !== false)
      .map(([name]) => name);
  }

  /** Get all type names including disabled (for UI listing). */
  getAllTypes(): string[] {
    return [...this.agents.keys()];
  }

  /** Get names of enabled built-in agents currently in the registry, in load order. */
  getDefaultAgentNames(): string[] {
    return [...this.agents.entries()]
      .filter(([_, config]) => config.enabled !== false && config.source === "builtin")
      .map(([name]) => name);
  }

  /** Get names of the remaining (non-built-in) agents currently in the registry. */
  getUserAgentNames(): string[] {
    return [...this.agents.entries()]
      .filter(([_, config]) => config.source !== "builtin")
      .map(([name]) => name);
  }

  /** Check if a type is valid and enabled (case-insensitive). */
  isValidType(type: string): boolean {
    const key = this.resolveKey(type);
    if (!key) return false;
    return this.agents.get(key)?.enabled !== false;
  }

  /**
   * Get the capability tool names for a type (case-insensitive).
   *
   * An agent that declares no `tools:` key gets the built-ins; one that declares
   * `tools: none` gets nothing. Resolution goes through `resolveAgentConfig` so
   * the two cannot disagree about which config a type names.
   */
  getToolNamesForType(type: string): string[] {
    return this.resolveAgentConfig(type).toolNames ?? [...BUILTIN_TOOL_NAMES];
  }

  /**
   * Resolve agent config with a non-null return: the named agent, else the enabled
   * fallback agent. Throws `MissingFallbackAgentError` when neither exists; no
   * stand-in agent is defined in code.
   */
  resolveAgentConfig(type: string): AgentConfig {
    const key = this.resolveType(type);
    const config = key === undefined ? undefined : this.agents.get(key);
    if (config) return config;

    const fallback = this.findAgentConfig(FALLBACK_AGENT);
    if (fallback && fallback.enabled !== false) return fallback;
    throw new MissingFallbackAgentError();
  }

  private resolveKey(name: string): string | undefined {
    if (this.agents.has(name)) return name;
    const lower = name.toLowerCase();
    for (const key of this.agents.keys()) {
      if (key.toLowerCase() === lower) return key;
    }
    return undefined;
  }
}

/** All known built-in tool names. */
export const BUILTIN_TOOL_NAMES: string[] = ["read", "bash", "edit", "write", "grep", "find", "ls"];
