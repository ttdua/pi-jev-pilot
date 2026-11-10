import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isChild, jevDir, loadSnapshot, setMainCwd } from "../platform/index.ts";
import { readLedger } from "../../store/ledger.ts";
import { drawStatus } from "../status/index.ts";
import { showUnseenTuning } from "../tuning/index.ts";
import { captureMainService, clearMainService } from "../tools/index.ts";
import type { Parts } from "./parts.ts";

function ledgerLines(): readonly unknown[] {
  const read = readLedger(jevDir());
  return read.kind === "ok" ? read.entries : [];
}

/** Loads the cut-point window from the ledger; an unreadable ledger leaves it empty. */
function loadWindow(parts: Parts): void {
  try {
    parts.window.load((parts.seams.readLines ?? ledgerLines)());
  } catch {
    parts.window.clear();
  }
}

/** The main-session steps of `session_start`, in order; a throw skips the rest of them. */
function startMain(pi: ExtensionAPI, parts: Parts, ctx: ExtensionContext): void {
  captureMainService();
  parts.main.sessionStart();
  loadWindow(parts);
  parts.log.reset(ctx.sessionManager.getSessionId());
  setMainCwd(ctx.cwd);
  drawStatus(ctx, loadSnapshot(pi), parts.main.decision());
}

/** `session_start`: reset the main parts and draw the status; tuning has its own guard. */
export function subscribeSessionStart(pi: ExtensionAPI, parts: Parts): void {
  pi.on("session_start", async (_event, ctx) => {
    try {
      if (isChild(ctx.sessionManager.getSessionId())) return;
      startMain(pi, parts, ctx);
    } catch {
      /* swallow: the line stays as it was */
    }
    try {
      showUnseenTuning(parts.tuningDeps(), ctx);
    } catch {
      /* swallow */
    }
  });
}

/** Runs one shutdown step; a failure never blocks the next one. */
function quietly(step: () => void): void {
  try {
    step();
  } catch {
    /* keep shutdown clean */
  }
}

/** `session_shutdown`: clear the service (main only), then drop the child and routing subscriptions. */
export function subscribeSessionShutdown(pi: ExtensionAPI, parts: Parts): void {
  pi.on("session_shutdown", async (_event, ctx) => {
    quietly(() => {
      if (!isChild(ctx.sessionManager.getSessionId())) clearMainService();
    });
    quietly(parts.off);
    quietly(() => parts.routing.off());
  });
}
