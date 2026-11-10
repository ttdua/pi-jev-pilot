import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export type Notify = (message: string, type: "info" | "warning" | "error") => void;

/** A notifier that does nothing without a UI. */
export function notifier(ctx: ExtensionCommandContext): Notify {
  return (message, type) => {
    if (ctx.hasUI) ctx.ui.notify(message, type);
  };
}
