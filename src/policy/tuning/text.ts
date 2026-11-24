// Pure texts for tuning: change lines, session-start line, command messages and the report.
import {
  BUILTIN_FLOORS,
  FLOOR_BANDS,
  FLOOR_PARAMETER,
  type FloorBand,
} from "../../shared/turn-floors.ts";
import { FLOOR } from "./floor-rules.ts";
import type { HistoryEntry, TuningEvent, TuningParameter } from "./record.ts";
import type { ModeSignals } from "./signals.ts";
import type { TurnSignal } from "./turn-signals.ts";

/** Structurally equal to the store's `Issue`; declared here so policy stays free of store types. */
type Issue = { path: string; message: string };

export type TuneView = {
  off: boolean;
  effective: number;
  tunedFrom?: number;
  configValid: boolean;
  pending?: { from: number; to: number; since: number };
  block?: { value: number; remaining: number; direction: "raise" | "lower" };
  history: readonly HistoryEntry[];
  signals: readonly ModeSignals[] | "ledger-unreadable";
  floors: { band: FloorBand; value: number; tunedFrom?: number }[];
  floorPending: { band: FloorBand; from: number; to: number; since: number }[];
  floorBlocks: { band: FloorBand; value: number; remaining: number }[];
  turnSignals: readonly TurnSignal[] | "ledger-unreadable";
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

/** Why an event happened, per parameter kind; `kept` shows nothing. */
const REASONS = {
  timeoutMs: {
    applied: " · /jev tune undo",
    reverted: ", reverted: timeouts did not improve · /jev tune",
    superseded: ", your config value replaces the tuned one",
  },
  floor: {
    applied: " · /jev tune undo",
    reverted: ", reverted: more runs ran out of turns · /jev tune",
    superseded: ", the built-in floor changed",
  },
} as const;

/** The band of a floor parameter; undefined for `timeoutMs`. */
const bandOf = (parameter: TuningParameter): FloorBand | undefined =>
  FLOOR_BANDS.find((b) => FLOOR_PARAMETER(b) === parameter);

/** The notification for one event; `undefined` for `kept`, which shows nothing. */
export function changeLine(e: TuningEvent): string | undefined {
  if (e.kind === "kept") return undefined;
  const reasons = e.parameter === "timeoutMs" ? REASONS.timeoutMs : REASONS.floor;
  const reason =
    e.kind === "reverted" && e.parameter === "timeoutMs" && e.to > e.from
      ? ", reverted: timeouts came back · /jev tune"
      : reasons[e.kind];
  return `Jev tune: ${e.parameter} ${arrow(e.from, e.to)}${reason}`;
}

/** Per parameter, in order of first appearance: the earliest `from` and the latest `to`. */
function netChanges(unseen: readonly HistoryEntry[]): string[] {
  const net = new Map<TuningParameter, { from: number; to: number }>();
  for (const h of unseen) {
    const seen = net.get(h.parameter);
    net.set(h.parameter, { from: seen?.from ?? h.from, to: h.to });
  }
  return [...net].map(([parameter, c]) => `${parameter} ${arrow(c.from, c.to)}`);
}

/** The one line shown at session start; `unseen` must not be empty. */
export function sessionStartLine(unseen: readonly HistoryEntry[]): string {
  const noun = unseen.length === 1 ? "change" : "changes";
  return (
    `Jev tune since your last session: ${netChanges(unseen).join(", ")} ` +
    `(${unseen.length} ${noun}) · /jev tune`
  );
}

export function undoneMessage(parameter: TuningParameter, from: number, to: number): string {
  const band = bandOf(parameter);
  const heldBack =
    band === undefined
      ? to > from
        ? "The same lowering is held back for 400 decisions."
        : "The same raise is held back for 200 decisions."
      : `The same change is held back for ${FLOOR.blockRuns} ${band} runs.`;
  return `Jev tune: ${parameter} ${arrow(from, to)} undone. ${heldBack}`;
}

const BUILTIN_FLOORS_TEXT = FLOOR_BANDS.map((b) => BUILTIN_FLOORS[b]).join("/");

export const resetMessage = (untuned: number): string =>
  `Jev tune: back to your settings (timeoutMs ${untuned}, turn floors ${BUILTIN_FLOORS_TEXT}).`;

function timeoutLine(v: TuneView): string {
  return v.tunedFrom === undefined
    ? `timeoutMs: ${v.effective} (not tuned)`
    : `timeoutMs: ${v.effective} (tuned from ${v.tunedFrom})`;
}

function floorsLine(floors: TuneView["floors"]): string {
  const part = (f: TuneView["floors"][number]): string =>
    `${f.band} ${f.value}${f.tunedFrom === undefined ? "" : ` (tuned from ${f.tunedFrom})`}`;
  return `turnFloor: ${floors.map(part).join(" · ")}`;
}

function timeoutStateLines(v: TuneView): string[] {
  const lines: string[] = [];
  if (v.pending) {
    const { from, to, since } = v.pending;
    lines.push(`pending: ${arrow(from, to)}, ${since}/${PENDING_WINDOW} decisions since`);
  }
  if (v.block) {
    const { value, remaining, direction } = v.block;
    const what =
      direction === "raise" ? `raises to ${value} or above` : `lowerings to ${value} or below`;
    lines.push(`block: ${what} held back for ${remaining} more decisions`);
  }
  return lines;
}

function floorStateLines(v: TuneView): string[] {
  const pending = v.floorPending.map(
    (p) =>
      `pending turnFloor.${p.band}: ${arrow(p.from, p.to)}, ${p.since}/${FLOOR.runs} runs since`,
  );
  const blocks = v.floorBlocks.map(
    (b) => `block turnFloor.${b.band}: ${b.value} held back for ${b.remaining} more runs`,
  );
  return [...pending, ...blocks];
}

function stateLines(v: TuneView): string[] {
  const paused = v.configValid ? [] : ["tuning paused: config error"];
  if (v.signals === "ledger-unreadable") return [...paused, "ledger unreadable"];
  return [...paused, ...timeoutStateLines(v), ...floorStateLines(v)];
}

const minute = (at: number): string => `${new Date(at).toISOString().slice(0, 16)}Z`;

function historyLines(history: readonly HistoryEntry[]): string[] {
  if (history.length === 0) return ["history: none"];
  const latest = history.slice(-HISTORY_SHOWN).reverse();
  const name = (h: HistoryEntry): string => (h.parameter === "timeoutMs" ? "" : `${h.parameter} `);
  return [
    "history:",
    ...latest.map((h) => `  ${minute(h.at)} ${h.cause} ${name(h)}${arrow(h.from, h.to)}`),
  ];
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

function turnSignalLine(s: TurnSignal): string {
  if (s.runs === 0) return `  ${s.band}: no runs yet`;
  const ratio = s.usedOverFloor === undefined ? "-" : s.usedOverFloor.toFixed(2);
  const suggest = s.suggested === undefined ? `needs ${FLOOR.runs} runs` : `suggest ${s.suggested}`;
  return (
    `  ${s.band}: runs ${s.runs} · p90 ${s.p90} · p95 ${s.p95} · exhausted ${s.exhausted}` +
    ` · warned ${s.warned} · used/floor ${ratio} · ${suggest}`
  );
}

function turnSignalLines(signals: TuneView["turnSignals"]): string[] {
  if (signals === "ledger-unreadable") return [];
  const head = `turn signals (observed; latest ${FLOOR.runs} runs per band):`;
  return [head, ...signals.map(turnSignalLine)];
}

export function tuneReport(v: TuneView): string {
  return [
    `tuning: ${v.off ? "off" : "on"}`,
    timeoutLine(v),
    floorsLine(v.floors),
    ...stateLines(v),
    ...historyLines(v.history),
    ...signalLines(v.signals),
    ...turnSignalLines(v.turnSignals),
    ...(v.problems.length > 0 ? ["problems:", ...v.problems] : []),
  ].join("\n");
}
