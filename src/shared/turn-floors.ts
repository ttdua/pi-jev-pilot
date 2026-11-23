// Turn floor table shared by store validation, settings and policy. Imports nothing.

/** Turn bands that raise `maxTurns`; `short` raises nothing. */
export type FloorBand = "medium" | "long" | "very_long";

export const FLOOR_BANDS: readonly FloorBand[] = ["medium", "long", "very_long"];

export type BandFloors = Readonly<Record<FloorBand, number>>;

/** The smallest turn limit each band asks for, before any tuning. */
export const BUILTIN_FLOORS: BandFloors = { medium: 40, long: 100, very_long: 200 };

/** Allowed range of a tuned floor per band. */
export const FLOOR_RANGES: Readonly<Record<FloorBand, { min: number; max: number }>> = {
  medium: { min: 20, max: 80 },
  long: { min: 50, max: 200 },
  very_long: { min: 100, max: 400 },
};

/** History parameter name of a band floor. */
export const FLOOR_PARAMETER = (band: FloorBand): `turnFloor.${FloorBand}` => `turnFloor.${band}`;
