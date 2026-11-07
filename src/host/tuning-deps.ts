import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { LedgerRead } from "../store/ledger.ts";
import type { TuningDocument } from "../store/tuning-file.ts";
import type { WriteResult } from "../store/validate.ts";
import type { Snapshot } from "./readiness.ts";

/** The part of the Pi context that tuning uses. */
export type UiCtx = Pick<ExtensionContext, "hasUI" | "ui">;

/** Everything the tuning host reads or writes, injected so tests can fake it. */
export type TuningDeps = {
  dir: string;
  now: () => number;
  load: () => Snapshot;
  updateTuning: (dir: string, mutate: (r: TuningDocument) => TuningDocument) => WriteResult;
  readLedger: (dir: string) => LedgerRead;
};
