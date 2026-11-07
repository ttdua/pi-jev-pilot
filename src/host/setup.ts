import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isChild, subscribeChildren } from "./child.ts";
import { runJev } from "./commands.ts";
import { askJev } from "../jev/client.ts";
import { appendLedger } from "../store/ledger.ts";
import { scanPlatforms } from "./context.ts";
import { createMain } from "./main.ts";
import { loadSnapshot } from "./readiness.ts";
import { hideReviewInChild, registerReviewTool } from "./review.ts";
import { compactTally, drawStatus, logLine } from "./status.ts";
import { jevDir } from "./stores.ts";
import { createSessionLog } from "./tally.ts";
import { captureMainService, clearMainService } from "./tool-service.ts";
import { createToolAssessment } from "./tools.ts";
import { registerWorkerRouting } from "./worker.ts";

/** Draw `jev-log` entries as one truncated line; older Pi without the API is skipped. */
function registerLogRenderer(pi: ExtensionAPI): void {
  if (typeof pi.registerEntryRenderer !== "function") return;
  try {
    pi.registerEntryRenderer("jev-log", (entry) => {
      try {
        const t = logLine(entry.data);
        if (t === undefined) return undefined;
        return { render: (w: number) => [t.slice(0, Math.max(0, w))], invalidate() {} };
      } catch {
        return undefined;
      }
    });
  } catch {
    /* swallow: entries stay unrendered */
  }
}

/** Register the status line, the /jev command and the child registry on one extension instance. */
export function setup(pi: ExtensionAPI): void {
  const off = subscribeChildren(pi.events);
  const log = createSessionLog(pi, { verbose: () => loadSnapshot(pi).settings.switches.verbose });
  const append = (e: unknown) => {
    try {
      return appendLedger(jevDir(), e);
    } finally {
      log.record(e);
    }
  };
  const routing = registerWorkerRouting(pi, { append });
  const tools = createToolAssessment(pi);
  const main = createMain(pi, {
    load: () => loadSnapshot(pi),
    ask: askJev,
    append,
    tallyText: () => {
      const n = log.prompts() + 1;
      return n % 10 === 0 ? compactTally(log.tally(), n) : undefined;
    },
    now: Date.now,
    newId: () => crypto.randomUUID(),
    platforms: scanPlatforms,
    env: () => process.env,
    commands: () => pi.getCommands(),
    readFile: (p) => readFileSync(p, "utf8"),
  });

  pi.on("session_start", async (_event, ctx) => {
    try {
      if (isChild(ctx.sessionManager.getSessionId())) return;
      captureMainService();
      main.sessionStart();
      log.reset(ctx.sessionManager.getSessionId());
      drawStatus(ctx, loadSnapshot(pi), main.decision());
    } catch {
      /* swallow: the line stays as it was */
    }
  });

  registerReviewTool(pi);
  registerLogRenderer(pi);

  pi.on("before_agent_start", async (event, ctx) => {
    try {
      const sessionId = ctx.sessionManager.getSessionId();
      if (isChild(sessionId)) {
        hideReviewInChild(event, sessionId);
        await tools.beforeAgentStart(event, ctx);
        return undefined;
      }
      return await main.beforeAgentStart(event, ctx);
    } catch {
      return undefined;
    }
  });

  pi.on("before_provider_request", async (_event, ctx) => {
    try {
      if (isChild(ctx.sessionManager.getSessionId())) return undefined;
      await main.beforeProviderRequest();
    } catch {
      /* swallow: the request goes out unchanged */
    }
    return undefined;
  });

  pi.on("turn_end", async (event, ctx) => {
    try {
      if (isChild(ctx.sessionManager.getSessionId())) return;
      await main.turnEnd(event);
    } catch {
      /* swallow */
    }
  });

  pi.on("agent_settled", async (event, ctx) => {
    try {
      if (isChild(ctx.sessionManager.getSessionId())) return;
      await main.agentSettled(event);
    } catch {
      /* swallow */
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    try {
      if (!isChild(ctx.sessionManager.getSessionId())) clearMainService();
    } catch {
      /* keep shutdown clean */
    }
    try {
      off();
    } catch {
      /* keep shutdown clean */
    }
    try {
      routing.off();
    } catch {
      /* keep shutdown clean */
    }
  });

  pi.registerCommand("jev", {
    description: "Show or change jev-pilot features",
    handler: (args, ctx) => {
      routing.clearWarnings();
      return runJev(args, ctx, {
        dir: jevDir(),
        load: () => loadSnapshot(pi),
        decision: main.decision,
        tally: log.tally,
        overlay: main.overlay,
        exec: (c, a, o) => pi.exec(c, a, o),
      });
    },
  });
}
