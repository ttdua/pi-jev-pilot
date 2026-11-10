// The tuning step at agent_settled: read, step, store, announce. Never throws.
import { markSeen, stepTuning, type TuningEvent } from "../../policy/tuning/index.ts";
import type { DecisionLine } from "../../policy/tuning/index.ts";
import type { TuningDocument } from "../../store/tuning-file.ts";
import type { Snapshot } from "../platform/index.ts";
import type { TuningDeps, UiCtx } from "./deps.ts";
import { changeLine } from "../../policy/tuning/index.ts";

const VISIBLE: ReadonlySet<TuningEvent["kind"]> = new Set(["applied", "reverted", "superseded"]);

const isVisible = (e: TuningEvent): boolean => VISIBLE.has(e.kind);

/** Tuning pauses on an invalid config or an unreadable tuning file. */
function shouldSkip(snapshot: Snapshot): boolean {
  return !snapshot.config.valid || snapshot.tuning.kind === "unreadable";
}

function stepOnce(
  record: TuningDocument,
  snapshot: Snapshot,
  lines: readonly DecisionLine[],
  now: number,
): { record: TuningDocument; events: TuningEvent[] } {
  return stepTuning({ record, untuned: snapshot.untunedTimeoutMs, lines, now });
}

/** Writes the step recomputed on the stored record; returns its events, or undefined if refused. */
function persist(
  deps: TuningDeps,
  ctx: UiCtx,
  input: { snapshot: Snapshot; lines: readonly DecisionLine[]; now: number },
): TuningEvent[] | undefined {
  const { snapshot, lines, now } = input;
  let events: TuningEvent[] = [];
  const written = deps.updateTuning(deps.dir, (stored) => {
    const stepped = stepOnce(stored, snapshot, lines, now);
    events = stepped.events;
    const shown = ctx.hasUI && events.some(isVisible);
    return shown ? markSeen(stepped.record, now) : stepped.record;
  });
  return written.ok ? events : undefined;
}

function announce(ctx: UiCtx, events: readonly TuningEvent[]): void {
  if (!ctx.hasUI) return;
  for (const event of events) {
    const line = changeLine(event);
    if (line !== undefined) ctx.ui.notify(line, "info");
  }
}

export function settleTuning(deps: TuningDeps, ctx: UiCtx): void {
  try {
    const snapshot = deps.load();
    if (shouldSkip(snapshot)) return;
    const ledger = deps.readLedger(deps.dir);
    if (ledger.kind !== "ok") return;
    const now = deps.now();
    const first = stepOnce(snapshot.tuning.record, snapshot, ledger.entries, now);
    if (first.events.length === 0) return;
    const events = persist(deps, ctx, { snapshot, lines: ledger.entries, now });
    if (events !== undefined) announce(ctx, events);
  } catch {
    // Tuning never disturbs the run.
  }
}
