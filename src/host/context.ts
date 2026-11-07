// Turns Pi session data into the plain inputs of the pure state builder.
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { LEVELS } from "../policy/effort.ts";
import type { HoldAnchor } from "../policy/hold.ts";

export { branchItems } from "../jev/branch.ts";
export { scanPlatforms } from "../jev/workspace.ts";

/** The turn id of the newest `jev-turn` entry on the given branch. */
export function previousTurnId(entries: readonly SessionEntry[]): string | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.type !== "custom" || entry.customType !== "jev-turn") continue;
    const data = entry.data as { turnId?: unknown } | undefined;
    if (typeof data?.turnId === "string") return data.turnId;
  }
  return undefined;
}

/** Newest `decided` anchor after the last compaction, plus that compaction's id. */
export function holdContext(entries: readonly SessionEntry[]): {
  anchor: HoldAnchor | undefined;
  compactionId: string | undefined;
} {
  let anchor: HoldAnchor | undefined;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.type === "compaction") {
      const id: unknown = entry.id;
      return { anchor, compactionId: typeof id === "string" ? id : undefined };
    }
    if (anchor !== undefined || entry?.type !== "custom" || entry.customType !== "jev-turn") {
      continue;
    }
    anchor = readDecided(entry.data);
  }
  return { anchor, compactionId: undefined };
}

function readDecided(data: unknown): HoldAnchor | undefined {
  const decided = (data as { decided?: unknown } | null | undefined)?.decided;
  if (typeof decided !== "object" || decided === null) return undefined;
  const { provider, model, level } = decided as Record<string, unknown>;
  if (typeof provider !== "string" || typeof model !== "string") return undefined;
  const found = LEVELS.find((l) => l === level);
  return found === undefined ? undefined : { provider, model, level: found };
}
