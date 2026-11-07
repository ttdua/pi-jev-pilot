import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "../policy/effort.ts";
import type { Strategy } from "../policy/strategy.ts";
import { DECISION_FEATURES } from "../store/defaults.ts";
import { validateLedgerEntry, type EffortLevel, type LedgerEntry } from "../store/ledger-schema.ts";
import type { Snapshot } from "./readiness.ts";

const WIDGET_KEY = "jev";
const PLACEMENT = { placement: "aboveEditor" } as const;

/** The latest main outcome: the effort part and the strategy advice part, each a status suffix. */
export type Decision = {
  effort?: { kind: "level"; level: ThinkingLevel } | { kind: "no-answer" };
  advice?: Strategy;
};

/**
 * Builds a `Decision`; keys whose value is `undefined` are omitted.
 * `_prev` is accepted for call-site symmetry and is not read.
 */
export function withDecision(
  _prev: Decision | undefined,
  effort: Decision["effort"] | undefined,
  advice: Strategy | undefined,
): Decision {
  return {
    ...(effort === undefined ? {} : { effort }),
    ...(advice === undefined ? {} : { advice }),
  };
}

/**
 * First that applies: config error, no key, all decision features off, then the mode.
 * Suffixes go only on the `Jev · <mode>` form: effort when `effort` is on, advice when `strategy` is on.
 * A tally `overlay` replaces both suffixes there.
 */
export function statusText(s: Snapshot, decision?: Decision, overlay?: string): string {
  if (!s.config.valid) return "Jev · config error";
  if (!s.keySet) return "Jev · no key";
  if (DECISION_FEATURES.every((f) => !s.settings.switches[f])) return "Jev · off";
  const marker = s.settings.modeSource === "local" ? " (local)" : "";
  const parts = [`Jev · ${s.settings.mode}${marker}`];
  if (overlay !== undefined) return `${parts[0]} · ${overlay}`;
  const { effort, advice } = decision ?? {};
  if (effort && s.settings.switches.effort) {
    parts.push(effort.kind === "level" ? effort.level : "no answer");
  }
  if (advice && s.settings.switches.strategy) parts.push(advice);
  return parts.join(" · ");
}

/** Left-pads to `width`; text wider than `width` is cut to `width`. */
export function alignRight(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, Math.max(0, width));
  return text.padStart(width, " ");
}

export function drawStatus(
  ctx: Pick<ExtensionContext, "hasUI" | "mode" | "ui">,
  s: Snapshot,
  decision?: Decision,
  overlay?: string,
): void {
  if (!ctx.hasUI) return;
  if (!s.settings.switches.status) {
    ctx.ui.setWidget(WIDGET_KEY, undefined, PLACEMENT);
    return;
  }
  const text = statusText(s, decision, overlay);
  if (ctx.mode === "tui") {
    ctx.ui.setWidget(
      WIDGET_KEY,
      () => ({ render: (width: number) => [alignRight(text, width)], invalidate() {} }),
      PLACEMENT,
    );
    return;
  }
  ctx.ui.setWidget(WIDGET_KEY, [text], PLACEMENT);
}

/** Session counts shown in the status overlay and the `/jev` report. */
export type Tally = {
  prompts: number;
  workers: number;
  byModel: ReadonlyArray<readonly [model: string, count: number]>;
  unrouted: number;
  workerTokens: number;
  fallbacks: number;
};

export const EMPTY_TALLY: Tally = {
  prompts: 0,
  workers: 0,
  byModel: [],
  unrouted: 0,
  workerTokens: 0,
  fallbacks: 0,
};

/** The 10th-prompt status suffix; `prompts` is the count including the current prompt. */
export function compactTally(t: Tally, prompts: number): string {
  return `${prompts} prompts · ${t.workers} workers · ${t.fallbacks} fallbacks`;
}

/** The `session:` block of the `/jev` report. */
export function tallyLines(t: Tally): string[] {
  const parts = t.byModel.map(([m, n]) => `${m} ${n}`);
  if (t.unrouted > 0) parts.push(`unrouted ${t.unrouted}`);
  const detail = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  return [
    "session:",
    `  prompts ${t.prompts}`,
    `  workers ${t.workers}${detail}`,
    `  worker tokens ${t.workerTokens}`,
    `  fallbacks ${t.fallbacks}`,
  ];
}

const EFFORT_ORDER: readonly EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];
const TIER_ORDER: readonly string[] = ["fast", "balanced", "deep", "expert"];

const seconds = (ms: number): string => (ms / 1000).toFixed(1);

function probabilityPairs(keys: readonly string[], p: Readonly<Record<string, number>>): string {
  return keys.map((k) => `${k} ${(p[k] as number).toFixed(2)}`).join(" ");
}

function mainLine(e: Extract<LedgerEntry, { kind: "main" }>): string {
  const segs = [`jev · main · ${e.from ?? "-"} → ${e.effective ?? "-"}`];
  if (e.ms !== undefined) segs.push(`${seconds(e.ms)}s`);
  if (e.effortP) {
    const keys = EFFORT_ORDER.filter((k) => e.effortP?.[k] !== undefined);
    if (keys.length > 0) segs.push(`p ${probabilityPairs(keys, e.effortP)}`);
  }
  if (e.held === true) segs.push("held");
  if (e.miss !== undefined) segs.push(`miss ${e.miss}`);
  return segs.join(" · ");
}

const HIDDEN_WHY: readonly string[] = ["cut", "choice", "untouched"];

function workerLine(e: Extract<LedgerEntry, { kind: "worker" }>): string {
  const target = e.tier ?? (e.reason === "untouched" ? "untouched" : "-");
  const segs = [`jev · ${e.agent} → ${target} · ${e.effort ?? "-"}`];
  if (e.ms !== undefined) segs.push(`${seconds(e.ms)}s`);
  if (e.tierP) {
    const present = Object.keys(e.tierP);
    const keys = [
      ...TIER_ORDER.filter((k) => present.includes(k)),
      ...present.filter((k) => !TIER_ORDER.includes(k)),
    ];
    if (keys.length > 0) segs.push(`p ${probabilityPairs(keys, e.tierP)}`);
  }
  if (!HIDDEN_WHY.includes(e.reason)) segs.push(`why ${e.reason}`);
  if (e.miss !== undefined) segs.push(`miss ${e.miss}`);
  if (e.fallback !== undefined && e.fallback !== e.tier) segs.push(`fallback ${e.fallback}`);
  if (e.locked === true) segs.push("locked");
  if (e.status !== "completed") segs.push(e.status);
  return segs.join(" · ");
}

/** One-line text for a validated ledger line; `undefined` for any other data. */
export function logLine(data: unknown): string | undefined {
  const v = validateLedgerEntry(data);
  if (!v.ok) return undefined;
  const e = v.entry;
  if (e.kind === "main") return mainLine(e);
  if (e.kind === "worker") return workerLine(e);
  return `jev · correction · ${e.corrects.toFixed(2)}`;
}
