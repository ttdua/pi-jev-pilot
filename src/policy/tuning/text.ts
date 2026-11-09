// Pure texts for tuning: change lines, session-start line, command messages and the report.
import type { HistoryEntry, TuningEvent } from "../policy/tuning.ts";
import type { ModeSignals } from "../policy/tuning-signals.ts";
import type { Issue } from "../store/validate.ts";

export type TuneView = {
  off: boolean;
  effective: number;
  tunedFrom?: number;
  configValid: boolean;
  pending?: { from: number; to: number; since: number };
  block?: { value: number; remaining: number };
  history: readonly HistoryEntry[];
  signals: readonly ModeSignals[] | "ledger-unreadable";
  problems: readonly string[];
};

export const NOTHING_TO_UNDO = "Jev tune: nothing to undo.";
export const OFF_MESSAGE = "Jev tune: off. A tuned value stays until /jev tune undo or reset.";
export const ON_MESSAGE = "Jev tune: on.";

const PENDING_WINDOW = 40;
const HISTORY_SHOWN = 5;

export function issueLines(label: string, issues: readonly Issue[]): string[] {
  return issues.map((i) => `  ${label} ${i.path === "" ? "(file)" : i.path}: ${i.message}`);
}

const arrow = (from: number, to: number): string => `${from}→${to}`;

/** The notification for one event; `undefined` for `kept`, which shows nothing. */
export function changeLine(e: TuningEvent): string | undefined {
  const change = `Jev tune: timeoutMs ${arrow(e.from, e.to)}`;
  switch (e.kind) {
    case "applied":
      return `${change} · /jev tune undo`;
    case "reverted":
      return `${change}, reverted: timeouts did not improve · /jev tune`;
    case "superseded":
      return `${change}, your config value replaces the tuned one`;
    case "kept":
      return undefined;
  }
}

/** The one line shown at session start; `unseen` must not be empty. */
export function sessionStartLine(unseen: readonly HistoryEntry[]): string {
  const first = unseen[0];
  const last = unseen[unseen.length - 1];
  const noun = unseen.length === 1 ? "change" : "changes";
  return (
    `Jev tune since your last session: timeoutMs ${arrow(first?.from ?? 0, last?.to ?? 0)} ` +
    `(${unseen.length} ${noun}) · /jev tune`
  );
}

export const undoneMessage = (from: number, to: number): string =>
  `Jev tune: timeoutMs ${arrow(from, to)} undone. The same raise is held back for 200 decisions.`;

export const resetMessage = (untuned: number): string =>
  `Jev tune: back to your settings (timeoutMs ${untuned}).`;

function timeoutLine(v: TuneView): string {
  return v.tunedFrom === undefined
    ? `timeoutMs: ${v.effective} (not tuned)`
    : `timeoutMs: ${v.effective} (tuned from ${v.tunedFrom})`;
}

function stateLines(v: TuneView): string[] {
  const lines: string[] = [];
  if (!v.configValid) lines.push("tuning paused: config error");
  if (v.signals === "ledger-unreadable") return [...lines, "ledger unreadable"];
  if (v.pending) {
    const { from, to, since } = v.pending;
    lines.push(`pending: ${arrow(from, to)}, ${since}/${PENDING_WINDOW} decisions since`);
  }
  if (v.block) {
    lines.push(
      `block: raises to ${v.block.value} or above held back for ${v.block.remaining} more decisions`,
    );
  }
  return lines;
}

const minute = (at: number): string => `${new Date(at).toISOString().slice(0, 16)}Z`;

function historyLines(history: readonly HistoryEntry[]): string[] {
  if (history.length === 0) return ["history: none"];
  const latest = history.slice(-HISTORY_SHOWN).reverse();
  return ["history:", ...latest.map((h) => `  ${minute(h.at)} ${h.cause} ${arrow(h.from, h.to)}`)];
}

function signalLine(s: ModeSignals): string {
  const part = (name: string, x: { count: number; of: number }): string =>
    `${name} ${x.count}/${x.of}`;
  return (
    `  ${s.mode}: ${part("lowWorkerErrors", s.lowWorkerErrors)} · ${part("corrected", s.corrected)}` +
    ` · ${part("largeAtLow", s.largeAtLow)} · ${part("highSmall", s.highSmall)}`
  );
}

function signalLines(signals: TuneView["signals"]): string[] {
  if (signals === "ledger-unreadable") return [];
  if (signals.length === 0) return ["signals: no decisions yet"];
  return [
    "signals (observed, not applied; latest 200 decisions per mode):",
    ...signals.map(signalLine),
  ];
}

export function tuneReport(v: TuneView): string {
  return [
    `tuning: ${v.off ? "off" : "on"}`,
    timeoutLine(v),
    ...stateLines(v),
    ...historyLines(v.history),
    ...signalLines(v.signals),
    ...(v.problems.length > 0 ? ["problems:", ...v.problems] : []),
  ].join("\n");
}
