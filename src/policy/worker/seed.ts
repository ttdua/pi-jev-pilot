// Seed cut points per mode, computed offline from the 2026-11-07 WG-12 replay answers.
// The values are published in the tier-mix evidence note. Data only.

import type { CutPoints } from "./cutpoints.ts";
import type { ModeName } from "./modes.ts";

export const SEED_CUTPOINTS: Readonly<Record<ModeName, CutPoints>> = {
  budget: { basicMax: 1.42, broadMax: 2.135, frontierMin: Infinity },
  standard: { basicMax: 1.165, broadMax: 1.81, frontierMin: 2.345 },
  premium: { basicMax: -Infinity, broadMax: 1.42, frontierMin: 2.125 },
};
