import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "../policy/effort.ts";
import type { Strategy } from "../policy/strategy.ts";
import { DECISION_FEATURES } from "../store/defaults.ts";
import type { Snapshot } from "./readiness.ts";

const WIDGET_KEY = "jev";
const PLACEMENT = { placement: "aboveEditor" } as const;

/** The latest main outcome: the effort part and the strategy advice part, each a status suffix. */
export type Decision = {
  effort?: { kind: "level"; level: ThinkingLevel } | { kind: "no-answer" };
  advice?: Strategy;
};

/** Builds a `Decision`; keys whose value is `undefined` are omitted. */
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
 */
export function statusText(s: Snapshot, decision?: Decision): string {
  if (!s.config.valid) return "Jev · config error";
  if (!s.keySet) return "Jev · no key";
  if (DECISION_FEATURES.every((f) => !s.settings.switches[f])) return "Jev · off";
  const parts = [`Jev · ${s.settings.mode}`];
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
