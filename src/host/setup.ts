import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isChild, subscribeChildren } from "./child.ts";
import { runJev } from "./commands.ts";
import { askJev } from "../jev/client.ts";
import { appendLedger } from "../store/ledger.ts";
import { scanPlatforms } from "./context.ts";
import { createMain } from "./main.ts";
import { loadSnapshot } from "./readiness.ts";
import { drawStatus } from "./status.ts";
import { jevDir } from "./stores.ts";

/** Register the status line, the /jev command and the child registry on one extension instance. */
export function setup(pi: ExtensionAPI): void {
  const off = subscribeChildren(pi.events);
  const main = createMain(pi, {
    load: () => loadSnapshot(pi),
    ask: askJev,
    append: (e) => appendLedger(jevDir(), e),
    now: Date.now,
    newId: () => crypto.randomUUID(),
    platforms: scanPlatforms,
    env: () => process.env,
  });

  pi.on("session_start", async (_event, ctx) => {
    try {
      if (isChild(ctx.sessionManager.getSessionId())) return;
      main.sessionStart();
      drawStatus(ctx, loadSnapshot(pi), main.decision());
    } catch {
      /* swallow: the line stays as it was */
    }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (isChild(ctx.sessionManager.getSessionId())) return undefined;
    return main.beforeAgentStart(event, ctx);
  });

  pi.on("before_provider_request", async (_event, ctx) => {
    if (isChild(ctx.sessionManager.getSessionId())) return undefined;
    await main.beforeProviderRequest();
    return undefined;
  });

  pi.on("turn_end", async (event, ctx) => {
    if (isChild(ctx.sessionManager.getSessionId())) return;
    await main.turnEnd(event);
  });

  pi.on("agent_settled", async (event, ctx) => {
    if (isChild(ctx.sessionManager.getSessionId())) return;
    await main.agentSettled(event);
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
    handler: (args, ctx) =>
      runJev(args, ctx, {
        dir: jevDir(),
        load: () => loadSnapshot(pi),
        decision: main.decision,
      }),
  });
}
