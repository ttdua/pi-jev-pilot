// `/jev tune`: the report and the undo, reset, on and off subcommands. Never throws.
import {
  TUNING,
  activeBlock,
  markSeen,
  resetTuning,
  setTuningOff,
  undoTuning,
  type TuningParameter,
} from "../../policy/tuning/index.ts";
import { signalsByMode, turnSignals } from "../../policy/tuning/index.ts";
import { after, decisions, type DecisionLine } from "../../policy/tuning/index.ts";
import type { LedgerRead } from "../../store/ledger.ts";
import type { TuningDocument } from "../../store/tuning-file.ts";
import type { Issue } from "../../store/validate.ts";
import type { Snapshot } from "../platform/index.ts";
import type { TuningDeps, UiCtx } from "./deps.ts";
import { floorBlockOf, floorPendingOf, floorsView } from "./floor-view.ts";
import {
  NOTHING_TO_UNDO,
  OFF_MESSAGE,
  ON_MESSAGE,
  issueLines,
  resetMessage,
  tuneReport,
  undoneMessage,
  type TuneView,
} from "../../policy/tuning/index.ts";

export type TuneSub = "report" | "undo" | "reset" | "on" | "off";
export type TuneOutcome = { ok: boolean; message: string };

/** Each config problem as `<path or (file)>: <message>`; never includes config values. */
const pathedIssues = (issues: readonly Issue[]): string =>
  issues.map((i) => `${i.path === "" ? "(file)" : i.path}: ${i.message}`).join("; ");

/** The error's code or class name; never its message, which can carry paths. */
function describeError(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string") return code;
  return err instanceof Error ? err.constructor.name : "UnknownError";
}

const refused = (message: string): TuneOutcome => ({ ok: false, message });

/** Whether the tuned timeout is in force: config valid and built on today's untuned value. */
function timeoutApplies(snapshot: Snapshot): boolean {
  const tuned = snapshot.tuning.record.timeoutMs;
  return snapshot.config.valid && tuned !== undefined && tuned.base === snapshot.untunedTimeoutMs;
}

/** Whether any parameter has a tuned value in force. */
function isApplied(snapshot: Snapshot): boolean {
  return timeoutApplies(snapshot) || floorsView(snapshot).some((f) => f.tunedFrom !== undefined);
}

/** Whether the record holds anything reset would remove. */
function hasTuningState(record: TuningDocument): boolean {
  const bands = Object.keys(record.turnFloors ?? {}).length > 0;
  return record.timeoutMs !== undefined || !!record.pending || !!record.block || bands;
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
  untuned: number,
): TuneView["block"] {
  return activeBlock(record, untuned, ds);
}

export function buildTuneView(snapshot: Snapshot, ledger: LedgerRead): TuneView {
  const { record } = snapshot.tuning;
  const ds = ledger.kind === "ok" ? decisions(ledger.entries) : [];
  const pending = pendingOf(record, ds);
  const block = blockOf(record, ds, snapshot.untunedTimeoutMs);
  const tunedFrom = timeoutApplies(snapshot) ? record.timeoutMs?.base : undefined;
  const lines = ledger.kind === "ok" ? ledger.entries : [];
  return {
    off: record.off === true,
    effective: snapshot.settings.classifier.timeoutMs,
    ...(tunedFrom === undefined ? {} : { tunedFrom }),
    configValid: snapshot.config.valid,
    ...(pending ? { pending } : {}),
    ...(block ? { block } : {}),
    history: record.history ?? [],
    signals: ledger.kind === "ok" ? signalsByMode(ledger.entries) : "ledger-unreadable",
    floors: floorsView(snapshot),
    floorPending: floorPendingOf(record, lines),
    floorBlocks: floorBlockOf(record, lines),
    turnSignals:
      ledger.kind === "ok"
        ? turnSignals(ledger.entries, snapshot.settings.turnFloors)
        : "ledger-unreadable",
    problems: issueLines(`tuning (${snapshot.tuning.kind})`, snapshot.tuning.issues),
  };
}

/** The refusal for `undo` and `reset` while the config is invalid. */
function configRefusal(snapshot: Snapshot): TuneOutcome | undefined {
  if (snapshot.config.valid) return undefined;
  return refused(`Jev tune: fix the config first. ${pathedIssues(snapshot.config.issues)}`);
}

/** Runs one write; `message()` is evaluated and shown only after it succeeds. */
function write(
  deps: TuningDeps,
  mutate: (stored: TuningDocument) => TuningDocument,
  message: () => string,
): TuneOutcome {
  const written = deps.updateTuning(deps.dir, mutate);
  return written.ok ? { ok: true, message: message() } : refused(pathedIssues(written.issues));
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
  let undone: { parameter: TuningParameter; from: number; to: number } | undefined;
  return write(
    deps,
    (stored) => {
      const result = undoTuning(stored, now, snapshot.untunedTimeoutMs);
      if (result.kind === "nothing") return stored;
      undone = { parameter: result.parameter, from: result.from, to: result.to };
      return seenIf(ctx, result.record, now);
    },
    () => (undone ? undoneMessage(undone.parameter, undone.from, undone.to) : NOTHING_TO_UNDO),
  );
}

function reset(deps: TuningDeps, ctx: UiCtx): TuneOutcome {
  const snapshot = deps.load();
  const blocked = configRefusal(snapshot);
  if (blocked) return blocked;
  const { record } = snapshot.tuning;
  const message = resetMessage(snapshot.untunedTimeoutMs);
  if (!hasTuningState(record)) return { ok: true, message };
  const now = deps.now();
  return write(
    deps,
    (stored) => seenIf(ctx, resetTuning(stored, snapshot.untunedTimeoutMs, now), now),
    () => message,
  );
}

const switchOff = (deps: TuningDeps, off: boolean): TuneOutcome =>
  write(
    deps,
    (stored) => setTuningOff(stored, off),
    () => (off ? OFF_MESSAGE : ON_MESSAGE),
  );

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
    return refused(`Jev tune: failed (${describeError(err)})`);
  }
}
