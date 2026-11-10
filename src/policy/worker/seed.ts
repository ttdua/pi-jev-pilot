// Seed cut points per mode, computed offline from the 2026-11-07 WG-12 replay answers.
// The values are published in the tier-mix evidence note. Data only.

import type { CutPoints } from "./cutpoints.ts";
import type { ModeName } from "./modes.ts";

export const SEED_CUTPOINTS: Readonly<Record<ModeName, CutPoints>> = {
  budget: { fastMax: 1.42, balancedMax: 2.135, expertMin: Infinity },
  standard: { fastMax: 1.165, balancedMax: 1.81, expertMin: 2.345 },
  premium: { fastMax: -Infinity, balancedMax: 1.42, expertMin: 2.125 },
};
