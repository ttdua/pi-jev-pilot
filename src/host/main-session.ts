import type { TurnRecord } from "../policy/main/index.ts";
import type { DecidedSummary } from "../policy/main/index.ts";
import type { Decision } from "./status.ts";

/** What an aborted start needs to put the status back. Belongs to the current record. */
type Undo<Ctx, Snap> = {
  rec: TurnRecord;
  ctx: Ctx;
  snapshot: Snap;
  previous: Decision | undefined;
  previousOverlay: string | undefined;
  drew: boolean;
};

/**
 * The main session's mutable state and its transitions: the turn in flight, the status line's
 * decision and overlay, and what the last answered turn decided. Holds no Pi references, so the
 * transitions are tested without a host.
 */
export class MainSession<Ctx, Snap> {
  #record: TurnRecord | undefined;
  #undo: Undo<Ctx, Snap> | undefined;
  #current: Decision | undefined;
  /** Tally text shown on every 10th prompt until the next eligible prompt's result. */
  #overlay: string | undefined;
  /** What the last settled, answered turn applied; carried to the next prompt. */
  #lastDecided: DecidedSummary | undefined;
  /** Records that already drew during their own start. */
  readonly #drawn = new WeakSet<TurnRecord>();

  get record(): TurnRecord | undefined {
    return this.#record;
  }

  get current(): Decision | undefined {
    return this.#current;
  }

  get overlay(): string | undefined {
    return this.#overlay;
  }

  get lastDecided(): DecidedSummary | undefined {
    return this.#lastDecided;
  }

  /** Makes `rec` the turn in flight and remembers the status it may have to put back. */
  begin(rec: TurnRecord, ctx: Ctx, snapshot: Snap): void {
    this.#record = rec;
    this.#undo = {
      rec,
      ctx,
      snapshot,
      previous: this.#current,
      previousOverlay: this.#overlay,
      drew: false,
    };
  }

  /** Forgets `rec` unless a newer turn already replaced it. */
  drop(rec: TurnRecord): void {
    if (this.#record !== rec) return;
    this.clearTurn();
  }

  /**
   * Forgets `rec` after a failed start, unless it already applied a level: the applied level
   * stays, so its line must still be written when the run settles.
   */
  dropUnapplied(rec: TurnRecord | undefined): void {
    if (rec === undefined || rec.applied !== undefined) return;
    this.drop(rec);
  }

  /** Records that `rec` drew the status. Call before drawing. */
  markDrawn(rec: TurnRecord): void {
    if (this.#undo?.rec === rec) this.#undo.drew = true;
    this.#drawn.add(rec);
  }

  hasDrawn(rec: TurnRecord): boolean {
    return this.#drawn.has(rec);
  }

  /** Sets the status decision on behalf of `rec`. */
  decide(rec: TurnRecord, decision: Decision): void {
    this.#current = decision;
    this.markDrawn(rec);
  }

  /** Sets the overlay text; returns whether it changed. */
  updateOverlay(next: string | undefined): boolean {
    if (next === this.#overlay) return false;
    this.#overlay = next;
    return true;
  }

  /** Keeps `summary` for the next prompt; an undefined summary keeps the previous one. */
  carry(summary: DecidedSummary | undefined): void {
    this.#lastDecided = summary ?? this.#lastDecided;
  }

  /**
   * For an aborted turn that never reached the provider and drew: puts the decision and overlay
   * back and returns where to redraw them. The turn stays in flight until `clearTurn`, so a
   * redraw sees the same state as before the split.
   */
  restoreBefore(rec: TurnRecord): { ctx: Ctx; snapshot: Snap } | undefined {
    const undo = this.#undo?.rec === rec ? this.#undo : undefined;
    if (undo === undefined || !undo.drew) return undefined;
    this.#current = undo.previous;
    this.#overlay = undo.previousOverlay;
    return { ctx: undo.ctx, snapshot: undo.snapshot };
  }

  /** Hands over the turn in flight with the context it started in, and clears it. */
  settle(): { rec: TurnRecord; ctx: Ctx | undefined } | undefined {
    const rec = this.#record;
    if (rec === undefined) return undefined;
    const ctx = this.#undo?.rec === rec ? this.#undo.ctx : undefined;
    this.clearTurn();
    return { rec, ctx };
  }

  /** Forgets the turn in flight; the status decision and overlay stay. */
  clearTurn(): void {
    this.#record = undefined;
    this.#undo = undefined;
  }

  /** A new session: forget everything, so a run from the replaced session cannot touch it. */
  reset(): void {
    this.clearTurn();
    this.#current = undefined;
    this.#overlay = undefined;
    this.#lastDecided = undefined;
  }
}
