// Decision counting for the tuning rules. Pure: inputs are never mutated.

/** A ledger line read structurally; extra fields are ignored. */
export type DecisionLine = {
  kind: string;
  at: number;
  session?: string;
  answered?: boolean;
  miss?: string;
  ms?: number;
};

export type Counts = { asked: number; timeouts: number };

function compareField<T extends string | number | boolean>(
  a: T | undefined,
  b: T | undefined,
): number {
  if (a === b) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  return a < b ? -1 : 1;
}

function compareLines(a: DecisionLine, b: DecisionLine): number {
  return (
    compareField(a.at, b.at) ||
    compareField(a.kind, b.kind) ||
    compareField(a.session, b.session) ||
    compareField(a.answered, b.answered) ||
    compareField(a.miss, b.miss) ||
    compareField(a.ms, b.ms)
  );
}

/** Main and worker lines in a total order, independent of input order. */
export function decisions(lines: readonly DecisionLine[]): DecisionLine[] {
  return lines.filter((l) => l.kind === "main" || l.kind === "worker").sort(compareLines);
}

/** Lines strictly after `at`. */
export function after(ds: readonly DecisionLine[], at: number): DecisionLine[] {
  return ds.filter((d) => d.at > at);
}

const isAsked = (d: DecisionLine): boolean => d.answered === true || d.miss !== undefined;

export function counts(ds: readonly DecisionLine[]): Counts {
  const asked = ds.filter(isAsked);
  return { asked: asked.length, timeouts: asked.filter((d) => d.miss === "timeout").length };
}

/** Nearest-rank 90th percentile of `ms` over answered lines; integer arithmetic only. */
export function p90(ds: readonly DecisionLine[]): number | undefined {
  const values = ds
    .filter((d) => d.answered === true && typeof d.ms === "number" && Number.isFinite(d.ms))
    .map((d) => d.ms as number)
    .sort((a, b) => a - b);
  if (values.length === 0) return undefined;
  return values[Math.ceil((9 * values.length) / 10) - 1];
}

/** Whether `a` has a strictly larger timeout share than `b`, by cross-multiplying. */
export function shareAbove(a: Counts, b: Counts): boolean {
  return a.timeouts * b.asked > b.timeouts * a.asked;
}
