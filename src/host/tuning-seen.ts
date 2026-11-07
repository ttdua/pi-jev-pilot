// The session-start tuning line: mark changes seen, then announce them. Never throws.
import { markSeen, unseenEntries } from "../policy/tuning.ts";
import type { TuningDeps, UiCtx } from "./tuning-deps.ts";
import { sessionStartLine } from "./tuning-text.ts";

export function showUnseenTuning(deps: TuningDeps, ctx: UiCtx): void {
  try {
    if (!ctx.hasUI) return;
    const { tuning } = deps.load();
    if (tuning.kind !== "ok") return;
    const unseen = unseenEntries(tuning.record);
    const latest = unseen[unseen.length - 1];
    if (latest === undefined) return;
    const written = deps.updateTuning(deps.dir, (stored) =>
      unseenEntries(stored).length === 0 ? stored : markSeen(stored, latest.at),
    );
    if (written.ok) ctx.ui.notify(sessionStartLine(unseen), "info");
  } catch {
    // Tuning never disturbs the session.
  }
}
