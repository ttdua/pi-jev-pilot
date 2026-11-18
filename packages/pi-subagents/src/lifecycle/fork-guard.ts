/**
 * fork-guard.ts — The fork's internal child extension, and its callable set.
 *
 * A fork declares exactly the parent's tools so its request prefix matches the
 * parent's. Tools it may not use stay declared and are refused when called.
 * The guard also keeps the parent's system prompt on every run and sends the
 * parent's session id as the provider cache-routing key.
 */

import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

/** Tools no child may call: the executor's own orchestration tools. */
export const ORCHESTRATION_TOOLS: readonly string[] = ["subagent", "get_subagent_result", "steer_subagent"];

/**
 * Session headers `pi-ai` providers send (design.md "Spike results"). The
 * `before_provider_headers` hook runs before the provider builds them, so it
 * sees none and must set every name; its values win the later merge.
 * `openai-codex-responses` overwrites `session-id` and `x-client-request-id`
 * after the hook, so Codex keeps the fork's own id there (known gap).
 */
export const FORK_SESSION_HEADERS: readonly string[] = [
  "x-session-affinity",
  "x-session-id",
  "session_id",
  "session-id",
  "x-client-request-id",
  "x-affinity",
];

/** Payload cache keys, rewritten only where the provider already set one. */
const PAYLOAD_CACHE_KEYS = ["prompt_cache_key", "promptCacheKey"] as const;

/** Live state the guard reads; `callable` grows when the grant check runs after bind. */
export interface ForkGuardState {
  callable: Set<string>;
  parentSessionId: string;
  /**
   * The parent's system prompt, forced on every run through `before_agent_start`.
   * A loader `systemPromptOverride` is not enough: Pi 1.5.0 treats it as the
   * preamble and still renders its own `<cwd>` section after it.
   */
  systemPrompt: string;
}

/** The refusal a fork returns for a call to a tool it may not use. */
export function refusalReason(toolName: string): string {
  return `Tool "${toolName}" is not available to this subagent.`;
}

export function forkGuardExtension(state: ForkGuardState): ExtensionFactory {
  return (pi) => {
    pi.on("before_agent_start", () => ({ systemPrompt: state.systemPrompt }));
    pi.on("tool_call", (event) =>
      state.callable.has(event.toolName) ? undefined : { block: true, reason: refusalReason(event.toolName) },
    );
    pi.on("before_provider_headers", (event) => {
      for (const name of FORK_SESSION_HEADERS) event.headers[name] = state.parentSessionId;
    });
    pi.on("before_provider_request", (event) => rewriteCacheKeys(event.payload, state.parentSessionId));
  };
}

/** The payload with each present cache key set to `id`; undefined keeps the payload. */
function rewriteCacheKeys(payload: unknown, id: string): unknown {
  if (typeof payload !== "object" || payload === null) return undefined;
  const present = PAYLOAD_CACHE_KEYS.filter((key) => key in payload);
  if (present.length === 0) return undefined;
  const out: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
  for (const key of present) out[key] = id;
  return out;
}

/** What the callable set is computed from. */
export interface ForkToolsInput {
  /** The child's tools as the fresh pipeline would give them (allowlist, policy plan, MCP expanded). */
  agentTools: readonly string[];
  disallowed: readonly string[];
  /** The tools the parent declares; the fork declares exactly these. */
  parentTools: readonly string[];
}

/**
 * The parent tools the fork may call (the fresh pipeline's tools intersected
 * with the parent's, minus disallowed and orchestration tools), and the tools
 * the agent allows that the parent lacks.
 */
export function forkCallableTools(input: ForkToolsInput): { callable: string[]; agentOnly: string[] } {
  const denied = new Set([...input.disallowed, ...ORCHESTRATION_TOOLS]);
  const wanted = new Set(input.agentTools.filter((name) => !denied.has(name)));
  const parent = new Set(input.parentTools);
  return {
    callable: input.parentTools.filter((name) => wanted.has(name)),
    agentOnly: [...wanted].filter((name) => !parent.has(name)),
  };
}
