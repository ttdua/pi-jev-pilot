import { holdContext } from "./context.ts";
import type { Ctx, MainHost } from "./main-host.ts";
import {
  correctionLine,
  decidedAnchor,
  decidedSummary,
  lastAssistantStop,
  mainLine,
} from "./main-line.ts";
import type { TurnRecord } from "./main-record.ts";
import { drawStatus } from "./status.ts";

function branchStop(ctx: Ctx | undefined): string | undefined {
  try {
    return lastAssistantStop(ctx?.sessionManager.getBranch() ?? []);
  } catch {
    return undefined; // no fallback: the line reports `ok`
  }
}

/** `jev-turn` data: the hold anchor rides along only for a decided turn on an unchanged compaction. */
function turnData(rec: TurnRecord, ctx: Ctx | undefined): Record<string, unknown> {
  const plain = { turnId: rec.turnId };
  if (ctx === undefined) return plain;
  try {
    const { compactionId } = holdContext(ctx.sessionManager.getBranch());
    const decided = decidedAnchor(rec, compactionId);
    return decided === undefined ? plain : { ...plain, decided };
  } catch {
    return plain; // a branch read failure drops only the anchor
  }
}

/** Builds and appends one ledger line; a failure never affects the turn or the next line. */
function appendSafely(host: MainHost, build: () => Record<string, unknown> | undefined): void {
  try {
    const line = build();
    if (line !== undefined) host.deps.append(line);
  } catch {
    /* ledger failure never affects the turn */
  }
}

/** Correction line, `main` line, then the `jev-turn` entry. A failed ledger write never skips the entry. */
function writeTurn(host: MainHost, rec: TurnRecord, aborted: boolean, ctx: Ctx | undefined): void {
  host.session.carry(decidedSummary(rec));
  appendSafely(host, () => correctionLine(rec));
  appendSafely(host, () =>
    mainLine(rec, { stop: rec.lastStop ?? branchStop(ctx), aborted, now: host.deps.now() }),
  );
  try {
    host.pi.appendEntry("jev-turn", turnData(rec, ctx));
  } catch {
    /* the session entry is best effort */
  }
}

/** Esc during classification: undo what the start applied, as if the turn never happened. */
function undoAbortedStart(host: MainHost, rec: TurnRecord): void {
  const { pi, session } = host;
  // Restore the level the package applied, unless the operator moved it.
  if (
    rec.applied !== undefined &&
    rec.applied !== rec.from &&
    pi.getThinkingLevel() === rec.applied
  ) {
    pi.setThinkingLevel(rec.from as never);
  }
  // Nothing ran: put the status back as it was before this turn.
  const redraw = session.restoreBefore(rec);
  if (redraw !== undefined) {
    drawStatus(redraw.ctx, redraw.snapshot, session.current, session.overlay);
  }
}

/** `agent_settled`: write the turn's lines, or undo a start that never reached the provider. */
export function settleRun(host: MainHost, aborted: boolean): void {
  const rec = host.session.record;
  if (rec === undefined) return;
  if (aborted && !rec.sawRequest) return undoAbortedStart(host, rec);
  const settled = host.session.settle();
  if (settled !== undefined) writeTurn(host, settled.rec, aborted, settled.ctx);
}
