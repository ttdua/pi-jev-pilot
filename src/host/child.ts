/** Process-wide registry of child (subagent) session ids, shared by every extension instance. */
export const CHILDREN_KEY: unique symbol = Symbol.for("pi-jev-pilot.children") as never;

type Bus = { on(channel: string, handler: (data: unknown) => void): () => void };

const CREATED = "subagents:child:session-created";
const DISPOSED = "subagents:child:disposed";

function registry(): Set<string> {
  const g = globalThis as Record<symbol, Set<string> | undefined>;
  return (g[CHILDREN_KEY] ??= new Set<string>());
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

export function subscribeChildren(events: Bus): () => void {
  const offCreated = events.on(CREATED, (data) => {
    const id = sessionIdOf(data);
    if (id !== undefined) registry().add(id);
  });
  const offDisposed = events.on(DISPOSED, (data) => {
    const id = sessionIdOf(data);
    if (id !== undefined) registry().delete(id);
  });
  return () => {
    offCreated();
    offDisposed();
  };
}
