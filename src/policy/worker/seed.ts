// Seed cut points per mode. Data only.
// From the rubric-3 corpus replay: docs/evidence/2026-11-20-knowledge-tier-mix.md.

import type { CutPoints } from "./cutpoints.ts";
import type { ModeName } from "./modes.ts";

export const SEED_CUTPOINTS: Readonly<Record<ModeName, CutPoints>> = {
  budget: { basicMax: 1.36, broadMax: 1.868, frontierMin: Infinity },
  standard: { basicMax: 1.045, broadMax: 1.636, frontierMin: 2.055 },
  premium: { basicMax: -Infinity, broadMax: 1.36, frontierMin: 1.984 },
};
