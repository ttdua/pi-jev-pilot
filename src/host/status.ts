import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DECISION_FEATURES } from "../store/defaults.ts";
import type { Snapshot } from "./readiness.ts";

const WIDGET_KEY = "jev";
const PLACEMENT = { placement: "aboveEditor" } as const;

/** First that applies: config error, no key, all decision features off, then the mode. */
export function statusText(s: Snapshot): string {
  if (!s.config.valid) return "Jev · config error";
  if (!s.keySet) return "Jev · no key";
  if (DECISION_FEATURES.every((f) => !s.settings.switches[f])) return "Jev · off";
  return `Jev · ${s.settings.mode}`;
}

/** Left-pads to `width`; text wider than `width` is cut to `width`. */
export function alignRight(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, Math.max(0, width));
  return text.padStart(width, " ");
}

export function drawStatus(
  ctx: Pick<ExtensionContext, "hasUI" | "mode" | "ui">,
  s: Snapshot,
): void {
  if (!ctx.hasUI) return;
  if (!s.settings.switches.status) {
    ctx.ui.setWidget(WIDGET_KEY, undefined, PLACEMENT);
    return;
  }
  const text = statusText(s);
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
