import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { validateLedgerEntry, type LedgerEntry } from "../../store/ledger-schema.ts";
import type { Tally } from "./line.ts";

/** In-memory session observer fed by validated ledger lines. */
export type SessionLog = {
  reset(sessionId: string): void;
  record(line: unknown): void;
  tally(): Tally;
  prompts(): number;
};

type Counts = {
  prompts: number;
  workers: number;
  byModel: Map<string, number>;
  unrouted: number;
  workerTokens: number;
  fallbacks: number;
};

function emptyCounts(): Counts {
  return { prompts: 0, workers: 0, byModel: new Map(), unrouted: 0, workerTokens: 0, fallbacks: 0 };
}

function count(c: Counts, entry: LedgerEntry): void {
  if (entry.kind === "main") {
    c.prompts += 1;
    return;
  }
  if (entry.kind !== "worker") return;
  c.workers += 1;
  c.workerTokens += entry.tokens ?? 0;
  if (entry.model === undefined) c.unrouted += 1;
  else c.byModel.set(entry.model, (c.byModel.get(entry.model) ?? 0) + 1);
  if (entry.tier !== undefined && entry.fallback !== undefined && entry.fallback !== entry.tier)
    c.fallbacks += 1;
}

export function createSessionLog(
  pi: Pick<ExtensionAPI, "appendEntry">,
  deps: { verbose: () => boolean },
): SessionLog {
  let sessionId: string | undefined;
  let counts = emptyCounts();

  function appendIfVerbose(data: unknown): void {
    try {
      if (deps.verbose()) pi.appendEntry("jev-log", data);
    } catch {
      // Log failures never affect the turn or the counts.
    }
  }

  return {
    reset(id) {
      sessionId = id;
      counts = emptyCounts();
    },
    record(line) {
      try {
        const v = validateLedgerEntry(line);
        if (!v.ok || sessionId === undefined || v.entry.session !== sessionId) return;
        count(counts, v.entry);
        appendIfVerbose(v.entry);
      } catch {
        // Fail open.
      }
    },
    tally() {
      return {
        prompts: counts.prompts,
        workers: counts.workers,
        byModel: [...counts.byModel.entries()],
        unrouted: counts.unrouted,
        workerTokens: counts.workerTokens,
        fallbacks: counts.fallbacks,
      };
    },
    prompts: () => counts.prompts,
  };
}
