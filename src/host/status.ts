import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "../policy/effort.ts";
import { DECISION_FEATURES } from "../store/defaults.ts";
import type { Snapshot } from "./readiness.ts";

const WIDGET_KEY = "jev";
const PLACEMENT = { placement: "aboveEditor" } as const;

/** The latest main-effort outcome, shown as a suffix on the status line. */
export type Decision = { kind: "level"; level: ThinkingLevel } | { kind: "no-answer" };

/**
 * First that applies: config error, no key, all decision features off, then the mode.
 * The decision suffix is added only to the `Jev · <mode>` form and only when `effort` is on.
 */
export function statusText(s: Snapshot, decision?: Decision): string {
  if (!s.config.valid) return "Jev · config error";
  if (!s.keySet) return "Jev · no key";
  if (DECISION_FEATURES.every((f) => !s.settings.switches[f])) return "Jev · off";
  const base = `Jev · ${s.settings.mode}`;
  if (!decision || !s.settings.switches.effort) return base;
  return `${base} · ${decision.kind === "level" ? decision.level : "no answer"}`;
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
): void {
  if (!ctx.hasUI) return;
  if (!s.settings.switches.status) {
    ctx.ui.setWidget(WIDGET_KEY, undefined, PLACEMENT);
    return;
  }
  const text = statusText(s, decision);
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
