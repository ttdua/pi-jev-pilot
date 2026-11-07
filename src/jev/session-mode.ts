import { MODE_NAMES, type ModeName } from "../policy/modes.ts";
import type { SessionEntryLike } from "./branch.ts";

export const SESSION_MODE_TYPE = "jev-mode";

type ParsedMode = { mode: ModeName | undefined };

function parseModeData(data: unknown): ParsedMode | undefined {
  if (typeof data !== "object" || data === null || !("mode" in data)) return undefined;
  const { mode } = data;
  if (mode === null) return { mode: undefined };
  const known = MODE_NAMES.find((name) => name === mode);
  return known === undefined ? undefined : { mode: known };
}

/**
 * Returns the session's worker mode: the newest valid `jev-mode` custom entry
 * wins; `{ mode: null }` clears it. Malformed entries are skipped.
 */
export function readSessionMode(entries: readonly SessionEntryLike[]): ModeName | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.type !== "custom" || entry.customType !== SESSION_MODE_TYPE) continue;
    const parsed = parseModeData(entry.data);
    if (parsed) return parsed.mode;
  }
  return undefined;
}
