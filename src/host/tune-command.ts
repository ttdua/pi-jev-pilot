// `/jev tune`: the report and the undo, reset, on and off subcommands. Never throws.
import {
  TUNING,
  blockActive,
  markSeen,
  resetTuning,
  setTuningOff,
  undoTuning,
} from "../policy/tuning.ts";
import { signalsByMode } from "../policy/tuning-signals.ts";
import { after, decisions, type DecisionLine } from "../policy/tuning-window.ts";
import type { LedgerRead } from "../store/ledger.ts";
import type { TuningDocument } from "../store/tuning-file.ts";
import type { Issue } from "../store/validate.ts";
import type { Snapshot } from "./readiness.ts";
import type { TuningDeps, UiCtx } from "./tuning-deps.ts";
import {
  NOTHING_TO_UNDO,
  OFF_MESSAGE,
  ON_MESSAGE,
  issueLines,
  resetMessage,
  tuneReport,
  undoneMessage,
  type TuneView,
} from "./tuning-text.ts";

export type TuneSub = "report" | "undo" | "reset" | "on" | "off";
export type TuneOutcome = { ok: boolean; message: string };

const joinIssues = (issues: readonly Issue[]): string => issues.map((i) => i.message).join("; ");

const refused = (message: string): TuneOutcome => ({ ok: false, message });

/** Whether the tuned value is in force: config valid and the value built on today's untuned one. */
function isApplied(snapshot: Snapshot): boolean {
  const tuned = snapshot.tuning.record.timeoutMs;
  return snapshot.config.valid && tuned !== undefined && tuned.base === snapshot.untunedTimeoutMs;
}

function pendingOf(
  record: TuningDocument,
  ds: readonly DecisionLine[],
): TuneView["pending"] | undefined {
  const p = record.pending;
  if (p === undefined) return undefined;
  const since = Math.min(after(ds, p.at).length, TUNING.window);
  return { from: p.from, to: p.to, since };
}

function blockOf(
  record: TuningDocument,
  ds: readonly DecisionLine[],
): TuneView["block"] | undefined {
  const b = record.block;
  if (b === undefined || !blockActive(b, ds)) return undefined;
  return { value: b.value, remaining: TUNING.blockFor - after(ds, b.at).length };
}

export function buildTuneView(snapshot: Snapshot, ledger: LedgerRead): TuneView {
  const { record } = snapshot.tuning;
  const ds = ledger.kind === "ok" ? decisions(ledger.entries) : [];
  const pending = pendingOf(record, ds);
  const block = blockOf(record, ds);
  const tunedFrom = isApplied(snapshot) ? record.timeoutMs?.base : undefined;
  return {
    off: record.off === true,
    effective: snapshot.settings.classifier.timeoutMs,
    ...(tunedFrom === undefined ? {} : { tunedFrom }),
    configValid: snapshot.config.valid,
    ...(pending ? { pending } : {}),
    ...(block ? { block } : {}),
    history: record.history ?? [],
    signals: ledger.kind === "ok" ? signalsByMode(ledger.entries) : "ledger-unreadable",
    problems: issueLines(`tuning (${snapshot.tuning.kind})`, snapshot.tuning.issues),
  };
}

/** The refusal for `undo` and `reset` while the config is invalid. */
function configRefusal(snapshot: Snapshot): TuneOutcome | undefined {
  if (snapshot.config.valid) return undefined;
  return refused(`Jev tune: fix the config first. ${joinIssues(snapshot.config.issues)}`);
}

/** Runs one write; `message` is shown when it succeeds. */
function write(
  deps: TuningDeps,
  mutate: (stored: TuningDocument) => TuningDocument,
  message: string,
): TuneOutcome {
  const written = deps.updateTuning(deps.dir, mutate);
  return written.ok ? { ok: true, message } : refused(joinIssues(written.issues));
}

const seenIf = (ctx: UiCtx, record: TuningDocument, now: number): TuningDocument =>
  ctx.hasUI ? markSeen(record, now) : record;

function report(deps: TuningDeps): TuneOutcome {
  const view = buildTuneView(deps.load(), deps.readLedger(deps.dir));
  return { ok: true, message: tuneReport(view) };
}

function undo(deps: TuningDeps, ctx: UiCtx): TuneOutcome {
  const snapshot = deps.load();
  const blocked = configRefusal(snapshot);
  if (blocked) return blocked;
  if (!isApplied(snapshot)) return { ok: true, message: NOTHING_TO_UNDO };
  const now = deps.now();
  let undone: { from: number; to: number } | undefined;
  const outcome = write(
    deps,
    (stored) => {
      const result = undoTuning(stored, now);
      if (result.kind === "nothing") return stored;
      undone = { from: result.from, to: result.to };
      return seenIf(ctx, result.record, now);
    },
    "",
  );
  if (!outcome.ok) return outcome;
  return { ok: true, message: undone ? undoneMessage(undone.from, undone.to) : NOTHING_TO_UNDO };
}

function reset(deps: TuningDeps, ctx: UiCtx): TuneOutcome {
  const snapshot = deps.load();
  const blocked = configRefusal(snapshot);
  if (blocked) return blocked;
  const { record } = snapshot.tuning;
  const message = resetMessage(snapshot.untunedTimeoutMs);
  if (!record.timeoutMs && !record.pending && !record.block) return { ok: true, message };
  const now = deps.now();
  return write(
    deps,
    (stored) => seenIf(ctx, resetTuning(stored, snapshot.untunedTimeoutMs, now), now),
    message,
  );
}

const switchOff = (deps: TuningDeps, off: boolean): TuneOutcome =>
  write(deps, (stored) => setTuningOff(stored, off), off ? OFF_MESSAGE : ON_MESSAGE);

function dispatch(deps: TuningDeps, sub: TuneSub, ctx: UiCtx): TuneOutcome {
  switch (sub) {
    case "report":
      return report(deps);
    case "undo":
      return undo(deps, ctx);
    case "reset":
      return reset(deps, ctx);
    case "on":
      return switchOff(deps, false);
    case "off":
      return switchOff(deps, true);
  }
}

export function runTune(deps: TuningDeps, sub: TuneSub, ctx: UiCtx): TuneOutcome {
  try {
    return dispatch(deps, sub, ctx);
  } catch (err) {
    return refused(`Jev tune: failed (${err instanceof Error ? err.message : String(err)})`);
  }
}
