import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultDeprecationWarnings } from "#src/config/deprecations";
import { lockedFieldName, resolveAgentInvocationConfig } from "#src/config/invocation-config";
import type { AgentConfig } from "#src/types";
import { makeAgentConfig } from "#test/helpers/make-agent-config";

/** What an agent file declaring a value for every lockable field sets. */
const OPINIONATED: Partial<AgentConfig> = {
  model: "provider/config-model",
  thinking: "high",
  maxTurns: 42,
  context: "fresh",
  runInBackground: false,
};

/** A tool call overriding every lockable field. */
const overridingParams = {
  model: "provider/param-model",
  thinking: "minimal",
  max_turns: 1,
  inherit_context: true,
  run_in_background: true,
} as const;

describe("resolveAgentInvocationConfig", () => {
  describe("with no lock declared", () => {
    it("prefers the caller's parameters over the agent's frontmatter", () => {
      const resolved = resolveAgentInvocationConfig(makeAgentConfig(OPINIONATED), overridingParams);

      expect(resolved.modelInput).toBe("provider/param-model");
      expect(resolved.thinking).toBe("minimal");
      expect(resolved.maxTurns).toBe(1);
      expect(resolved.context).toBe("fork");
      expect(resolved.runInBackground).toBe(true);
    });

    it("falls back to the agent's frontmatter for parameters the caller omits", () => {
      const resolved = resolveAgentInvocationConfig(makeAgentConfig(OPINIONATED), {});

      expect(resolved.modelInput).toBe("provider/config-model");
      expect(resolved.thinking).toBe("high");
      expect(resolved.maxTurns).toBe(42);
      expect(resolved.context).toBe("fresh");
      expect(resolved.runInBackground).toBe(false);
    });

    it("lets the caller fill booleans the agent leaves undefined", () => {
      const resolved = resolveAgentInvocationConfig(
        makeAgentConfig({ context: undefined, runInBackground: undefined }),
        { context: "fork", run_in_background: true },
      );

      expect(resolved.context).toBe("fork");
      expect(resolved.runInBackground).toBe(true);
    });

    it("defaults booleans to false when neither side sets them", () => {
      const resolved = resolveAgentInvocationConfig(
        makeAgentConfig({ context: undefined, runInBackground: undefined }),
        {},
      );

      expect(resolved.context).toBe("fresh");
      expect(resolved.runInBackground).toBe(false);
    });
  });

  /**
   * A `??`-based merge treats a caller's `0` or `false` as "nothing passed" and
   * silently keeps the agent's value. `resolveField` tests presence with `!== undefined`
   * for that reason, and these pin it — `max_turns: 0` means unlimited, so the two
   * readings differ in effect, not just in provenance.
   */
  describe("with a falsy value on either side", () => {
    it("lets the caller turn an agent's turn limit off", () => {
      const resolved = resolveAgentInvocationConfig(makeAgentConfig(OPINIONATED), { max_turns: 0 });

      expect(resolved.maxTurns).toBe(0);
    });

    it("keeps an agent's turn limit of zero when the caller passes none", () => {
      const resolved = resolveAgentInvocationConfig(makeAgentConfig({ maxTurns: 0 }), {});

      expect(resolved.maxTurns).toBe(0);
    });

    it("lets the caller switch off booleans the agent turned on", () => {
      const resolved = resolveAgentInvocationConfig(
        makeAgentConfig({ context: "fork", runInBackground: true }),
        { context: "fresh", run_in_background: false },
      );

      expect(resolved.context).toBe("fresh");
      expect(resolved.runInBackground).toBe(false);
    });

    it("lets the caller clear an agent's model with an empty string", () => {
      const resolved = resolveAgentInvocationConfig(makeAgentConfig(OPINIONATED), { model: "" });

      expect(resolved.modelInput).toBe("");
      expect(resolved.modelFromParams).toBe(true);
    });

    it("reports a discarded falsy override rather than reading it as absent", () => {
      const resolved = resolveAgentInvocationConfig(
        makeAgentConfig({ locked: true, maxTurns: 42, runInBackground: true }),
        { max_turns: 0, run_in_background: false },
      );

      expect(resolved.maxTurns).toBe(42);
      expect(resolved.runInBackground).toBe(true);
      expect(resolved.discarded).toEqual(["max_turns", "run_in_background"]);
    });
  });

  describe("with `locked: true`", () => {
    it("holds every field the agent file sets", () => {
      const resolved = resolveAgentInvocationConfig(
        makeAgentConfig({ ...OPINIONATED, locked: true }),
        overridingParams,
      );

      expect(resolved.modelInput).toBe("provider/config-model");
      expect(resolved.thinking).toBe("high");
      expect(resolved.maxTurns).toBe(42);
      expect(resolved.context).toBe("fresh");
      expect(resolved.runInBackground).toBe(false);
    });

    it("leaves a field the agent file does not set open to the caller", () => {
      const resolved = resolveAgentInvocationConfig(
        makeAgentConfig({ locked: true, model: undefined, thinking: undefined }),
        overridingParams,
      );

      expect(resolved.modelInput).toBe("provider/param-model");
      expect(resolved.thinking).toBe("minimal");
    });
  });

  describe("with a field list", () => {
    it("holds only the fields it names", () => {
      const resolved = resolveAgentInvocationConfig(
        makeAgentConfig({ ...OPINIONATED, locked: ["model", "max_turns"] }),
        overridingParams,
      );

      expect(resolved.modelInput).toBe("provider/config-model");
      expect(resolved.maxTurns).toBe(42);
      expect(resolved.thinking).toBe("minimal");
      expect(resolved.context).toBe("fork");
      expect(resolved.runInBackground).toBe(true);
    });

    it("denies the caller a field the agent file never sets", () => {
      const resolved = resolveAgentInvocationConfig(
        makeAgentConfig({ locked: ["model", "thinking"], model: undefined, thinking: undefined }),
        overridingParams,
      );

      expect(resolved.modelInput).toBeUndefined();
      expect(resolved.thinking).toBeUndefined();
    });

    it("defaults a locked boolean the agent file never sets to false", () => {
      const resolved = resolveAgentInvocationConfig(
        makeAgentConfig({
          locked: ["context", "run_in_background"],
          context: undefined,
          runInBackground: undefined,
        }),
        overridingParams,
      );

      expect(resolved.context).toBe("fresh");
      expect(resolved.runInBackground).toBe(false);
    });
  });

  describe("discarded", () => {
    it("is empty when no lock is declared", () => {
      const resolved = resolveAgentInvocationConfig(makeAgentConfig(OPINIONATED), overridingParams);

      expect(resolved.discarded).toEqual([]);
    });

    it("is empty when the caller passed nothing to discard", () => {
      const resolved = resolveAgentInvocationConfig(makeAgentConfig({ ...OPINIONATED, locked: true }), {});

      expect(resolved.discarded).toEqual([]);
    });

    it("lists every locked field the caller tried to override", () => {
      const resolved = resolveAgentInvocationConfig(
        makeAgentConfig({ ...OPINIONATED, locked: true }),
        overridingParams,
      );

      expect(resolved.discarded).toEqual([
        "model",
        "thinking",
        "max_turns",
        "context",
        "run_in_background",
      ]);
    });

    it("lists only the fields the lock names", () => {
      const resolved = resolveAgentInvocationConfig(
        makeAgentConfig({ ...OPINIONATED, locked: ["model", "max_turns"] }),
        overridingParams,
      );

      expect(resolved.discarded).toEqual(["model", "max_turns"]);
    });

    it("lists a bare lock the caller tried to fill", () => {
      const resolved = resolveAgentInvocationConfig(
        makeAgentConfig({ locked: ["model"], model: undefined }),
        overridingParams,
      );

      expect(resolved.discarded).toEqual(["model"]);
    });

    it("omits a field whose caller value matched the agent's own", () => {
      const resolved = resolveAgentInvocationConfig(
        makeAgentConfig({ ...OPINIONATED, locked: true }),
        { ...overridingParams, model: "provider/config-model" },
      );

      expect(resolved.discarded).not.toContain("model");
      expect(resolved.discarded).toContain("thinking");
    });
  });

  /**
   * `modelFromParams` decides whether an unresolvable model string surfaces as an
   * error or falls back to the parent model silently. The caller is present to read
   * an error; an agent file's author is not, so it tracks which side won.
   */
  describe("modelFromParams", () => {
    it("is true when the caller's model won", () => {
      const resolved = resolveAgentInvocationConfig(makeAgentConfig(OPINIONATED), overridingParams);

      expect(resolved.modelFromParams).toBe(true);
    });

    it("is false when the caller passed no model", () => {
      const resolved = resolveAgentInvocationConfig(makeAgentConfig(OPINIONATED), {});

      expect(resolved.modelFromParams).toBe(false);
    });

    it("is false when a lock discarded the caller's model", () => {
      const resolved = resolveAgentInvocationConfig(
        makeAgentConfig({ ...OPINIONATED, locked: ["model"] }),
        overridingParams,
      );

      expect(resolved.modelFromParams).toBe(false);
    });

    it("is false when neither side named a model", () => {
      const resolved = resolveAgentInvocationConfig(makeAgentConfig(), {});

      expect(resolved.modelFromParams).toBe(false);
    });
  });

  describe("context", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      defaultDeprecationWarnings.reset();
    });

    it("default is fresh", () => {
      const resolved = resolveAgentInvocationConfig(makeAgentConfig({ context: undefined }), {});
      expect(resolved.context).toBe("fresh");
      expect(resolved.contextSource).toBe("default");
    });

    it("caller wins over agent default", () => {
      const resolved = resolveAgentInvocationConfig(makeAgentConfig({ context: "fork" }), { context: "fresh" });
      expect(resolved.context).toBe("fresh");
      expect(resolved.contextSource).toBe("call");
    });

    it("takes the agent's value when the caller names none", () => {
      const resolved = resolveAgentInvocationConfig(makeAgentConfig({ context: "fork" }), {});
      expect(resolved.context).toBe("fork");
      expect(resolved.contextSource).toBe("agent");
    });

    it("locked agent wins over caller", () => {
      const resolved = resolveAgentInvocationConfig(
        makeAgentConfig({ context: "fork", locked: ["context"] }),
        { context: "fresh" },
      );
      expect(resolved.context).toBe("fork");
      expect(resolved.contextSource).toBe("agent");
      expect(resolved.discarded).toEqual(["context"]);
    });

    it("inherit_context true maps to fork as caller", () => {
      const resolved = resolveAgentInvocationConfig(makeAgentConfig({ context: undefined }), { inherit_context: true });
      expect(resolved.context).toBe("fork");
      expect(resolved.contextSource).toBe("call");
    });

    it("context wins over inherit_context", () => {
      const resolved = resolveAgentInvocationConfig(
        makeAgentConfig({ context: undefined }),
        { context: "fresh", inherit_context: true },
      );
      expect(resolved.context).toBe("fresh");
    });

    it("locked inherit_context reads as context", () => {
      const resolved = resolveAgentInvocationConfig(
        makeAgentConfig({ context: "fork", locked: [lockedFieldName("inherit_context") as "context"] }),
        { inherit_context: false },
      );
      expect(resolved.context).toBe("fork");
    });

    it("warns once per session for inherit_context", () => {
      vi.stubEnv("PI_SUBAGENTS_DEBUG", "1");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const agent = makeAgentConfig({ context: undefined });
      for (let i = 0; i < 3; i++) resolveAgentInvocationConfig(agent, { inherit_context: true });
      expect(warn.mock.calls.filter((c) => String(c[0]).includes("inherit_context"))).toHaveLength(1);
      warn.mockRestore();
    });
  });
});
