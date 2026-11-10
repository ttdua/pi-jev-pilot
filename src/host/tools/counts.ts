import type { ToolCounts } from "../../policy/tools/index.ts";

/** Process-wide counts keyed by worker agent id, shared by every extension instance. */
export const TOOL_COUNTS_KEY: unique symbol = Symbol.for("pi-jev-pilot.toolCounts") as never;

const COUNTS_MAX = 256;

function counts(): Map<string, ToolCounts> {
  const g = globalThis as Record<symbol, Map<string, ToolCounts> | undefined>;
  return (g[TOOL_COUNTS_KEY] ??= new Map<string, ToolCounts>());
}

export function putToolCounts(agentId: string, c: ToolCounts): void {
  const map = counts();
  map.delete(agentId);
  map.set(agentId, { toolsScored: c.toolsScored, toolsFlagged: c.toolsFlagged });
  while (map.size > COUNTS_MAX) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

export function takeToolCounts(agentId: string): ToolCounts | undefined {
  const map = counts();
  const found = map.get(agentId);
  map.delete(agentId);
  return found;
}
