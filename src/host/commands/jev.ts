import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { FEATURES } from "../../store/defaults.ts";
import type { WindowEntry } from "../../policy/worker/index.ts";
import { isChild } from "../platform/index.ts";
import type { Snapshot } from "../platform/index.ts";
import type { TuneOutcome, TuneSub } from "../tuning/index.ts";
import type { UiCtx } from "../tuning/index.ts";
import { drawStatus, type Decision, type Tally } from "../status/index.ts";
import { applyCommand } from "./apply.ts";
import { parseJevArgs, type JevArgs } from "./args.ts";
import { notifier, type Notify } from "./jev-notify.ts";
import { refuseSlotWrite, runSlot } from "./slots.ts";
import { statusReply } from "./status-reply.ts";

export { parseJevArgs, type JevArgs } from "./args.ts";
export { formatStatus } from "./status-format.ts";

export function usageText(): string {
  return [
    "Usage:",
    "  /jev                      show the status",
    "  /jev <feature> on|off     switch one feature",
    `      features: ${FEATURES.join(", ")}`,
    "  /jev all on|off           switch the five decision features",
    "  /jev mode budget|standard|premium [global]  choose the mode for this directory, or for all",
    "  /jev mode clear           drop this directory's mode",
    "  /jev reset                reset switches and mode",
    "  /jev <slot> <provider/model> [when <text>]",
    "  /jev <slot>",
    "  /jev remove <slot>",
    "  /jev tune [undo|reset|on|off]   show or change tuning",
  ].join("\n");
}

function describeError(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string") return code;
  return err instanceof Error ? err.constructor.name : "UnknownError";
}

type Deps = {
  dir: string;
  load: (cwd: string) => Snapshot;
  decision: () => Decision | undefined;
  tally?: () => Tally;
  window?: () => readonly WindowEntry[];
  /** Problems routing reports, such as a launch policy slot held by another extension. */
  problems?: () => readonly string[];
  overlay?: () => string | undefined;
  tune?: (sub: TuneSub, ctx: UiCtx) => TuneOutcome;
};

type Standalone = Extract<JevArgs, { kind: "slot" | "tune" | "usage" }>;

/** The sub-commands that answer on their own, without touching the status. */
function runStandalone(
  parsed: JevArgs,
  ctx: ExtensionCommandContext,
  deps: Deps,
  notify: Notify,
): parsed is Standalone {
  if (parsed.kind === "usage") {
    notify(usageText(), "warning");
  } else if (parsed.kind === "tune") {
    if (deps.tune === undefined) {
      notify(usageText(), "warning");
    } else {
      const out = deps.tune(parsed.sub, ctx);
      notify(out.message, out.ok ? "info" : "error");
    }
  } else if (parsed.kind === "slot") {
    const out = runSlot(parsed.args, ctx.modelRegistry, deps.dir);
    if (out.ok) notify(out.message, "info");
    else notify(out.usage ? `${out.message}\n${usageText()}` : out.message, "error");
  } else {
    return false;
  }
  return true;
}

/** Reload, redraw and report. */
function reportStatus(
  parsed: JevArgs,
  ctx: ExtensionCommandContext,
  deps: Deps,
  partialReset: string | undefined,
): { text: string; level: "info" | "warning" } {
  const snapshot = deps.load(ctx.cwd);
  drawStatus(ctx, snapshot, deps.decision(), deps.overlay?.());
  return statusReply(parsed, snapshot, deps, partialReset);
}

async function dispatch(
  args: string,
  ctx: ExtensionCommandContext,
  deps: Deps,
  notify: Notify,
): Promise<void> {
  const refused = refuseSlotWrite(args, deps.dir);
  if (refused !== undefined) {
    notify(refused.message, "error");
    return;
  }
  const parsed = parseJevArgs(args);
  if (runStandalone(parsed, ctx, deps, notify)) return;
  const applied = applyCommand(parsed, { cwd: ctx.cwd, dir: deps.dir });
  if (!applied.ok) {
    notify(applied.message, applied.level);
    return;
  }
  const reply = reportStatus(parsed, ctx, deps, applied.partialReset);
  notify(reply.text, reply.level);
}

export async function runJev(
  args: string,
  ctx: ExtensionCommandContext,
  deps: Deps,
): Promise<void> {
  try {
    if (isChild(ctx.sessionManager.getSessionId())) return;
    await dispatch(args, ctx, deps, notifier(ctx));
  } catch (err) {
    try {
      if (ctx.hasUI) ctx.ui.notify(`/jev failed: ${describeError(err)}`, "error");
    } catch {
      /* swallow: command failures stay inside the package */
    }
  }
}
