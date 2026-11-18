/** Process-wide registry of child (subagent) session ids, shared by every extension instance. */
export const CHILDREN_KEY: unique symbol = Symbol.for("pi-jev-pilot.children") as never;

import type { ContextMode } from "../../policy/launch.ts";

/** Context of each registered child; absent for a child whose event carried none (a fresh one). */
export const CONTEXTS_KEY: unique symbol = Symbol.for("pi-jev-pilot.child-contexts") as never;

type Bus = { on(channel: string, handler: (data: unknown) => void): () => void };

const CREATED = "subagents:child:session-created";
const DISPOSED = "subagents:child:disposed";

function registry(): Set<string> {
  const g = globalThis as Record<symbol, Set<string> | undefined>;
  return (g[CHILDREN_KEY] ??= new Set<string>());
}

function contexts(): Map<string, ContextMode> {
  const g = globalThis as Record<symbol, Map<string, ContextMode> | undefined>;
  return (g[CONTEXTS_KEY] ??= new Map<string, ContextMode>());
}

function sessionIdOf(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const id = (data as { sessionId?: unknown }).sessionId;
  return typeof id === "string" ? id : undefined;
}

export function isChild(sessionId: string): boolean {
  return (
    (globalThis as Record<symbol, Set<string> | undefined>)[CHILDREN_KEY]?.has(sessionId) ?? false
  );
}

/** The context a child session runs with; undefined for a session that is not a child. */
export function childContext(sessionId: string): ContextMode | undefined {
  if (!isChild(sessionId)) return undefined;
  const g = globalThis as Record<symbol, Map<string, ContextMode> | undefined>;
  return g[CONTEXTS_KEY]?.get(sessionId) ?? "fresh";
}

export function subscribeChildren(events: Bus): () => void {
  const offCreated = events.on(CREATED, (data) => {
    const id = sessionIdOf(data);
    if (id === undefined) return;
    registry().add(id);
    const context = (data as { context?: unknown }).context;
    if (context === "fork") contexts().set(id, "fork");
    else contexts().delete(id);
  });
  const offDisposed = events.on(DISPOSED, (data) => {
    const id = sessionIdOf(data);
    if (id === undefined) return;
    registry().delete(id);
    contexts().delete(id);
  });
  return () => {
    offCreated();
    offDisposed();
  };
}
