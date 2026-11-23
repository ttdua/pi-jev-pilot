import type { FloorBand } from "../../../src/shared/turn-floors.ts";
import type { TuningLine } from "../../../src/policy/tuning/record.ts";

type Opts = Partial<Omit<TuningLine, "kind" | "at">>;

const PEAK: Record<FloorBand, Record<string, number>> = {
  medium: { short: 0.1, medium: 0.7, long: 0.1, very_long: 0.1 },
  long: { short: 0.1, medium: 0.2, long: 0.6, very_long: 0.1 },
  very_long: { short: 0.1, medium: 0.1, long: 0.1, very_long: 0.7 },
};

/** A completed worker line whose `turnsP` rates `band`. */
export function run(at: number, band: FloorBand, used: number, opts: Opts = {}): TuningLine {
  return {
    kind: "worker",
    at,
    session: "s",
    status: "completed",
    turnsP: PEAK[band],
    turnsUsed: used,
    ...opts,
  };
}

/** `n` runs at `from`, `from + 1`, ...; `used` may depend on the index. */
export function runs(
  n: number,
  from: number,
  band: FloorBand,
  used: number | ((i: number) => number),
  opts: Opts | ((i: number) => Opts) = {},
): TuningLine[] {
  return Array.from({ length: n }, (_, i) =>
    run(
      from + i,
      band,
      typeof used === "number" ? used : used(i),
      typeof opts === "function" ? opts(i) : opts,
    ),
  );
}
