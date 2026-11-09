import type { DecisionLine } from "../../../src/policy/tuning/window.ts";

type Opts = Partial<Omit<DecisionLine, "kind" | "at">> & { kind?: string };

/** A `main` line at `at`; answered unless `opts` says otherwise. */
export function line(at: number, opts: Opts = {}): DecisionLine {
  return { kind: "main", at, session: "s", answered: true, ...opts };
}

/** `n` lines at `from`, `from + 1`, ... */
export function lines(n: number, from: number, opts: Opts = {}): DecisionLine[] {
  return Array.from({ length: n }, (_, i) => line(from + i, opts));
}
