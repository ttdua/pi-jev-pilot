/**
 * parent-snapshot.ts — Capture parent session state as a plain data snapshot.
 */

import type { Model } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { ModelRegistry } from "#src/session/model-resolver";
import type { ContextMode, SessionContext, ThinkingLevel } from "#src/types";

/**
 * Plain data snapshot of the parent session state captured at spawn time.
 * Replaces live `ExtensionContext` references so queued agents don't read stale state.
 */
export interface ParentSnapshot {
  /** Parent working directory. */
  cwd: string;
  /** Parent's effective system prompt; a fork sends it unchanged. */
  systemPrompt: string;
  /** Parent's current model instance. */
  model: Model<any> | undefined;
  /** Model registry for resolving config.model strings and creating sessions. */
  modelRegistry: ModelRegistry;
  /** Parent session id; a fork sends it as its provider cache-routing key. */
  sessionId: string;
  /**
   * The parent's live branch, root to leaf, for a fork; empty for a fresh launch.
   * Read from the session manager in memory, not the file, which lags it.
   */
  branch: readonly SessionEntry[];
  /** The tools the parent declares to the model; a fork declares exactly these. */
  toolNames: readonly string[];
  /** Parent's current thinking level. */
  thinking?: ThinkingLevel;
}

/**
 * Build an immutable snapshot of the parent session state.
 *
 * Called once at spawn time so queued agents capture state as it existed
 * when the user requested the agent, not when a queue slot opens.
 */
export function buildParentSnapshot(
  ctx: SessionContext,
  context: ContextMode,
  toolNames: readonly string[],
): ParentSnapshot {
  return {
    cwd: ctx.cwd,
    systemPrompt: ctx.getSystemPrompt(),
    model: ctx.model,
    modelRegistry: ctx.modelRegistry,
    sessionId: ctx.sessionManager.getSessionId(),
    branch: context === "fork" ? [...(ctx.sessionManager.getBranch() as SessionEntry[])] : [],
    toolNames: [...toolNames],
    thinking: ctx.thinkingLevel,
  };
}
