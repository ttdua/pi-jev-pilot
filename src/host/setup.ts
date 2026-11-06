import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isChild, subscribeChildren } from "./child.ts";
import { runJev } from "./commands.ts";
import { loadSnapshot } from "./readiness.ts";
import { hideReviewInChild, registerReviewTool } from "./review.ts";
import { drawStatus } from "./status.ts";
import { jevDir } from "./stores.ts";

/** Register the status line, the /jev command and the child registry on one extension instance. */
export function setup(pi: ExtensionAPI): void {
  const off = subscribeChildren(pi.events);

  pi.on("session_start", async (_event, ctx) => {
    try {
      if (isChild(ctx.sessionManager.getSessionId())) return;
      drawStatus(ctx, loadSnapshot(pi));
    } catch {
      /* swallow: the line stays as it was */
    }
  });

  registerReviewTool(pi);

  pi.on("before_agent_start", (event, ctx) => {
    try {
      hideReviewInChild(event, ctx.sessionManager.getSessionId());
    } catch {
      /* keep the turn */
    }
  });

  pi.on("session_shutdown", async () => {
    try {
      off();
    } catch {
      /* keep shutdown clean */
    }
  });

  pi.registerCommand("jev", {
    description: "Show or change jev-pilot features",
    handler: (args, ctx) => runJev(args, ctx, { dir: jevDir(), load: () => loadSnapshot(pi) }),
  });
}
