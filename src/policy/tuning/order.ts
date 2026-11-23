// Total order of ledger lines: by `at`, then by key-sorted JSON text. Pure.

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value !== "object" || value === null) return value;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return Object.fromEntries(entries.map(([k, v]) => [k, sortKeys(v)]));
}

/** JSON text with keys sorted at every depth, so equal lines compare equal. */
export const stableKey = (line: object): string => JSON.stringify(sortKeys(line));

/** Orders by `at`, then by `stableKey`. */
export function compareByAtThenKey(a: { at: number }, b: { at: number }): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  const ka = stableKey(a);
  const kb = stableKey(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}
