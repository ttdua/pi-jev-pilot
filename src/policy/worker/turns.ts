// Pure turn bands for the worker `turns` question. Imports nothing outside src/policy/.

/** Turn bands in the order Jev is asked to choose from. */
export const TURN_BANDS = ["short", "medium", "long", "very_long"] as const;

export type TurnBand = (typeof TURN_BANDS)[number];
