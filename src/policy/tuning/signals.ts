// Observed per-mode signals for tuning. Pure: no I/O, inputs are never mutated.

/** A ledger line read structurally; extra fields are ignored. */
export type SignalLine = {
  kind: string;
  at: number;
  mode?: string;
  turnId?: string;
  tier?: string;
  effort?: string;
  effective?: string;
  status?: string;
  toolCalls?: number;
  failures?: number;
  outcome?: string;
};

export type Signal = { count: number; of: number };

export type ModeSignals = {
  mode: string;
  lowWorkerErrors: Signal;
  corrected: Signal;
  largeAtLow: Signal;
  highSmall: Signal;
};

export const SIGNAL_WINDOW = 200;
export const SIGNAL_MODES = ["budget", "standard", "premium"] as const;

const LOW = ["off", "minimal", "low"];
const LARGE_TURN = 15;
const SMALL_TURN = 2;

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value !== "object" || value === null) return value;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return Object.fromEntries(entries.map(([k, v]) => [k, sortKeys(v)]));
}

/** JSON text with keys sorted at every depth, so equal lines compare equal. */
const stableKey = (line: SignalLine): string => JSON.stringify(sortKeys(line));

function compareLines(a: SignalLine, b: SignalLine): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  const ka = stableKey(a);
  const kb = stableKey(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

const isDecision = (l: SignalLine): boolean => l.kind === "main" || l.kind === "worker";

/** The latest `SIGNAL_WINDOW` decisions of `mode`, oldest first. */
function windowFor(lines: readonly SignalLine[], mode: string): SignalLine[] {
  return lines
    .filter((l) => isDecision(l) && l.mode === mode)
    .sort(compareLines)
    .slice(-SIGNAL_WINDOW);
}

const isLowEffort = (level: string | undefined): boolean =>
  level !== undefined && LOW.includes(level);

const tally = (ds: readonly SignalLine[], counted: (l: SignalLine) => boolean): Signal => ({
  count: ds.filter(counted).length,
  of: ds.length,
});

function lowWorkerErrors(win: readonly SignalLine[]): Signal {
  const low = win.filter(
    (l) => l.kind === "worker" && (l.tier === "fast" || isLowEffort(l.effort)),
  );
  return tally(low, (l) => l.status === "error");
}

function corrected(win: readonly SignalLine[], corrections: ReadonlySet<string>): Signal {
  const mains = win.filter((l) => l.kind === "main");
  return tally(mains, (l) => l.turnId !== undefined && corrections.has(l.turnId));
}

function largeAtLow(win: readonly SignalLine[]): Signal {
  const lowMains = win.filter(
    (l) => l.kind === "main" && isLowEffort(l.effective) && l.toolCalls !== undefined,
  );
  return tally(lowMains, (l) => (l.toolCalls ?? 0) >= LARGE_TURN);
}

function highSmall(win: readonly SignalLine[]): Signal {
  const highMains = win.filter(
    (l) => l.kind === "main" && l.effective === "high" && l.toolCalls !== undefined,
  );
  return tally(
    highMains,
    (l) => (l.toolCalls ?? Infinity) <= SMALL_TURN && l.failures === 0 && l.outcome === "ok",
  );
}

function correctedTurns(lines: readonly SignalLine[]): Set<string> {
  const ids = lines.filter((l) => l.kind === "correction").map((l) => l.turnId);
  return new Set(ids.filter((id): id is string => id !== undefined));
}

/** Observed signals for each mode with at least one decision, in `SIGNAL_MODES` order. */
export function signalsByMode(lines: readonly SignalLine[]): ModeSignals[] {
  const corrections = correctedTurns(lines);
  const out: ModeSignals[] = [];
  for (const mode of SIGNAL_MODES) {
    const win = windowFor(lines, mode);
    if (win.length === 0) continue;
    out.push({
      mode,
      lowWorkerErrors: lowWorkerErrors(win),
      corrected: corrected(win, corrections),
      largeAtLow: largeAtLow(win),
      highSmall: highSmall(win),
    });
  }
  return out;
}
