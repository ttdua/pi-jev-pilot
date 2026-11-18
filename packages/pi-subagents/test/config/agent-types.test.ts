import { describe, expect, it } from "vitest";
import {
  AgentTypeRegistry,
  BUILTIN_TOOL_NAMES,
  FALLBACK_AGENT,
  MissingFallbackAgentError,
} from "#src/config/agent-types";
import type { AgentConfig } from "#src/types";
import { makeAgentConfig } from "#test/helpers/make-agent-config";
import { makeGeneralAgent } from "#test/helpers/make-registry";

/** A built-in fixture agent. */
function builtin(name: string, overrides: Partial<AgentConfig> = {}): [string, AgentConfig] {
  return [name, makeAgentConfig({ name, source: "builtin", ...overrides })];
}

describe("AgentTypeRegistry", () => {
  /** Holds `general` plus whatever else the test lists, as the loader returns them. */
  function makeRegistry(agents: [string, AgentConfig][] = []): AgentTypeRegistry {
    return new AgentTypeRegistry(() => new Map([["general", makeGeneralAgent()], ...agents]));
  }

  describe("construction and reload", () => {
    it("holds exactly what the loader returns", () => {
      const registry = new AgentTypeRegistry(() => new Map());
      expect(registry.getAllTypes()).toEqual([]);
    });

    it("calls the loader once per reload", () => {
      let callCount = 0;
      const registry = new AgentTypeRegistry(() => {
        callCount++;
        return new Map();
      });
      expect(callCount).toBe(1);
      registry.reload();
      expect(callCount).toBe(2);
    });

    it("reload picks up new agents from the loader", () => {
      let agents = new Map<string, AgentConfig>();
      const registry = new AgentTypeRegistry(() => agents);
      expect(registry.isValidType("auditor")).toBe(false);

      agents = new Map([["auditor", makeAgentConfig({ name: "auditor" })]]);
      registry.reload();
      expect(registry.isValidType("auditor")).toBe(true);
    });

    it("reload clears previous agents", () => {
      const agents = new Map([["auditor", makeAgentConfig({ name: "auditor" })]]);
      const registry = new AgentTypeRegistry(() => agents);
      agents.clear();
      registry.reload();
      expect(registry.isValidType("auditor")).toBe(false);
    });
  });

  describe("resolveType", () => {
    it("returns the canonical key for an exact match", () => {
      const registry = makeRegistry([builtin("explore")]);
      expect(registry.resolveType("explore")).toBe("explore");
    });

    it("returns the canonical key for a case-insensitive match", () => {
      const registry = makeRegistry([builtin("Worker")]);
      expect(registry.resolveType("worker")).toBe("Worker");
    });

    it("returns undefined for an unknown type", () => {
      expect(makeRegistry().resolveType("nonexistent")).toBeUndefined();
    });

    it("maps general-purpose to general, in any case, when no agent has that name", () => {
      const registry = makeRegistry();
      expect(registry.resolveType("general-purpose")).toBe("general");
      expect(registry.resolveType("GENERAL-PURPOSE")).toBe("general");
    });

    it("keeps a real general-purpose agent ahead of the alias", () => {
      const registry = makeRegistry([["general-purpose", makeAgentConfig({ name: "general-purpose" })]]);
      expect(registry.resolveType("general-purpose")).toBe("general-purpose");
    });

    it("does not map the alias when general is missing", () => {
      const registry = new AgentTypeRegistry(() => new Map());
      expect(registry.resolveType("general-purpose")).toBeUndefined();
    });
  });

  describe("findAgentConfig", () => {
    it("finds an agent exactly and case-insensitively", () => {
      const registry = makeRegistry([builtin("Explore")]);
      expect(registry.findAgentConfig("Explore")?.name).toBe("Explore");
      expect(registry.findAgentConfig("explore")?.name).toBe("Explore");
    });

    it("applies no alias and no fallback", () => {
      const registry = makeRegistry();
      expect(registry.findAgentConfig("general-purpose")).toBeUndefined();
      expect(registry.findAgentConfig("Plan")).toBeUndefined();
    });

    it("never throws when general is missing", () => {
      const registry = new AgentTypeRegistry(() => new Map());
      expect(registry.findAgentConfig("Plan")).toBeUndefined();
    });
  });

  describe("resolveAgentConfig", () => {
    it("returns the config for a known type, case-insensitively", () => {
      const registry = makeRegistry([builtin("Explore")]);
      expect(registry.resolveAgentConfig("explore").name).toBe("Explore");
    });

    it("falls back to general for an unknown type", () => {
      expect(makeRegistry().resolveAgentConfig("nonexistent").name).toBe(FALLBACK_AGENT);
    });

    it("resolves the legacy general-purpose name to general", () => {
      expect(makeRegistry().resolveAgentConfig("GENERAL-PURPOSE").name).toBe("general");
    });

    it("returns a disabled agent that exists, without falling back", () => {
      const registry = makeRegistry([["Plan", makeAgentConfig({ name: "Plan", enabled: false })]]);
      const config = registry.resolveAgentConfig("Plan");
      expect(config.name).toBe("Plan");
      expect(config.enabled).toBe(false);
    });

    it("throws a MissingFallbackAgentError naming general when general is absent", () => {
      const registry = new AgentTypeRegistry(() => new Map());
      expect(() => registry.resolveAgentConfig("anything")).toThrow(MissingFallbackAgentError);
      expect(() => registry.resolveAgentConfig("anything")).toThrow(
        'Agent type "general" is not available; the built-in agents are missing or disabled',
      );
    });

    it("throws when general is disabled", () => {
      const registry = new AgentTypeRegistry(
        () => new Map([["general", makeGeneralAgent({ enabled: false })]]),
      );
      expect(() => registry.resolveAgentConfig("anything")).toThrow(MissingFallbackAgentError);
    });
  });

  describe("getAvailableTypes", () => {
    it("excludes disabled agents", () => {
      const registry = makeRegistry([["Plan", makeAgentConfig({ name: "Plan", enabled: false })]]);
      expect(registry.getAvailableTypes()).not.toContain("Plan");
      expect(registry.getAvailableTypes()).toContain("general");
    });
  });

  describe("getAllTypes", () => {
    it("includes disabled agents", () => {
      const registry = makeRegistry([["Plan", makeAgentConfig({ name: "Plan", enabled: false })]]);
      expect(registry.getAllTypes()).toContain("Plan");
    });
  });

  describe("getDefaultAgentNames", () => {
    it("returns the enabled built-ins in load order", () => {
      const registry = makeRegistry([
        builtin("explore"),
        builtin("scout", { enabled: false }),
        ["auditor", makeAgentConfig({ name: "auditor", source: "package" })],
      ]);
      expect(registry.getDefaultAgentNames()).toEqual(["general", "explore"]);
    });
  });

  describe("getUserAgentNames", () => {
    it("returns the agents whose source is not builtin", () => {
      const registry = makeRegistry([
        ["auditor", makeAgentConfig({ name: "auditor", source: "project" })],
        ["reviewer", makeAgentConfig({ name: "reviewer", source: "package" })],
      ]);
      expect(registry.getUserAgentNames()).toEqual(["auditor", "reviewer"]);
    });
  });

  describe("isValidType", () => {
    it("is true for an enabled agent, case-insensitively", () => {
      const registry = makeRegistry([builtin("Explore")]);
      expect(registry.isValidType("explore")).toBe(true);
    });

    it("is false for disabled and unknown types", () => {
      const registry = makeRegistry([["Plan", makeAgentConfig({ name: "Plan", enabled: false })]]);
      expect(registry.isValidType("Plan")).toBe(false);
      expect(registry.isValidType("nonexistent")).toBe(false);
      expect(registry.isValidType("")).toBe(false);
    });
  });

  describe("getToolNamesForType", () => {
    it("returns all built-in tools for general, which declares none", () => {
      expect(makeRegistry().getToolNamesForType("general")).toEqual(BUILTIN_TOOL_NAMES);
    });

    it("returns the declared list for a restricted agent", () => {
      const registry = makeRegistry([builtin("explore", { toolNames: ["read", "grep", "find", "ls"] })]);
      expect(registry.getToolNamesForType("explore")).toEqual(["read", "grep", "find", "ls"]);
    });

    it("returns BUILTIN_TOOL_NAMES for an unknown type (via general)", () => {
      expect(makeRegistry().getToolNamesForType("nonexistent")).toEqual(BUILTIN_TOOL_NAMES);
    });

    it("returns an empty list for an agent that declared tools: none", () => {
      const registry = makeRegistry([["silent", makeAgentConfig({ name: "silent", toolNames: [] })]]);
      expect(registry.getToolNamesForType("silent")).toEqual([]);
    });

    it("returns the built-ins for an agent that declared no tools key", () => {
      const registry = makeRegistry([
        ["unrestricted", makeAgentConfig({ name: "unrestricted", toolNames: undefined })],
      ]);
      expect(registry.getToolNamesForType("unrestricted")).toEqual(BUILTIN_TOOL_NAMES);
    });

    it("returns a disabled agent's own list rather than the built-ins", () => {
      const registry = makeRegistry([
        ["retired", makeAgentConfig({ name: "retired", toolNames: ["read"], enabled: false })],
      ]);
      expect(registry.getToolNamesForType("retired")).toEqual(["read"]);
    });
  });

  describe("code-defined agents", () => {
    it("is no longer exported from types.ts", async () => {
      const typesModule = await import("#src/types");
      expect((typesModule as Record<string, unknown>).DEFAULT_AGENT_NAMES).toBeUndefined();
    });

    it("has no static default-name list", () => {
      expect((AgentTypeRegistry as unknown as Record<string, unknown>).DEFAULT_AGENT_NAMES).toBeUndefined();
    });
  });

  describe("instance isolation", () => {
    it("two registries have independent state", () => {
      const r1 = makeRegistry([["auditor", makeAgentConfig({ name: "auditor" })]]);
      const r2 = makeRegistry();
      expect(r1.isValidType("auditor")).toBe(true);
      expect(r2.isValidType("auditor")).toBe(false);
    });
  });
});
