// Seed cut points per mode. Data only.
// PROVISIONAL: replaced in Task 7 by cut points from the rubric-3 corpus replay (evidence note).
// Until then they are `cutPoints` over tests/fixtures/seed/provisional-scores.json (synthetic).

import type { CutPoints } from "./cutpoints.ts";
import type { ModeName } from "./modes.ts";

export const SEED_CUTPOINTS: Readonly<Record<ModeName, CutPoints>> = {
  budget: { basicMax: 1.2, broadMax: 2.2, frontierMin: Infinity },
  standard: { basicMax: 0.2, broadMax: 1.2, frontierMin: 3 },
  premium: { basicMax: -Infinity, broadMax: 1.2, frontierMin: 2.9 },
};
