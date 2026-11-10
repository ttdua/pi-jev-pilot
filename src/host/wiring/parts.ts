import type { createMain } from "../main/index.ts";
import type { createSessionLog } from "../status/index.ts";
import type { createToolAssessment } from "../tools/index.ts";
import type { TuningDeps } from "../tuning/index.ts";
import type { CutpointWindow, registerWorkerRouting } from "../worker/index.ts";

/** Test seams of `setup`: the window instance and the ledger reader (default `readLedger`). */
export type SetupDeps = {
  window?: CutpointWindow;
  readLines?: () => readonly unknown[];
};

/** The parts `setup` builds once and the subscribe functions share. */
export type Parts = {
  seams: SetupDeps;
  off: () => void;
  routing: ReturnType<typeof registerWorkerRouting>;
  window: CutpointWindow;
  log: ReturnType<typeof createSessionLog>;
  tools: ReturnType<typeof createToolAssessment>;
  main: ReturnType<typeof createMain>;
  tuningDeps: () => TuningDeps;
};
