import { readFileSync } from "node:fs";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isChild, subscribeChildren } from "./child.ts";
import { runJev } from "./commands.ts";
import { SHIPPED_MAIN_GROUPS } from "../jev/state.ts";
import { updateTuning } from "../store/tuning-file.ts";
import { askJev } from "../jev/client.ts";
import { appendLedger, readLedger } from "../store/ledger.ts";
import { createCutpointWindow, type CutpointWindow } from "./cutpoint-window.ts";
import { scanPlatforms } from "./context.ts";
import { listAgents } from "./agents.ts";
import { createMain } from "./main.ts";
import { loadSnapshot } from "./readiness.ts";
import { sessionModes } from "./session-mode.ts";
import { hideReviewInChild, registerReviewTool } from "./review.ts";
import { compactTally, drawStatus, logLine } from "./status.ts";
import { jevDir } from "./stores.ts";
import { runTune } from "./tune-command.ts";
import type { TuningDeps } from "./tuning-deps.ts";
import { showUnseenTuning } from "./tuning-seen.ts";
import { settleTuning } from "./tuning-step.ts";
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
        return {
          render: (w: number) => [t.slice(0, Math.max(0, w))],
          invalidate() {},
        };
      } catch {
        return undefined;
      }
    });
  } catch {
    /* swallow: entries stay unrendered */
  }
}

export type SetupDeps = {
  /** Test seams: the window instance and the ledger reader (default `readLedger`). */
  window?: CutpointWindow;
  readLines?: () => readonly unknown[];
};

function ledgerLines(): readonly unknown[] {
  const read = readLedger(jevDir());
  return read.kind === "ok" ? read.entries : [];
}

/** Register the status line, the /jev command and the child registry on one extension instance. */
export function setup(pi: ExtensionAPI, deps: SetupDeps = {}): void {
  const off = subscribeChildren(pi.events);
  const log = createSessionLog(pi, {
    verbose: () => loadSnapshot(pi).settings.switches.verbose,
  });
  const window = deps.window ?? createCutpointWindow();
  const append = (e: unknown) => {
    try {
      return appendLedger(jevDir(), e);
    } finally {
      log.record(e);
      try {
        window.add(e);
      } catch {
        /* swallow: the window stays as it was */
      }
    }
  };
  const routing = registerWorkerRouting(pi, {
    append,
    window: () => window.entries(),
  });
  const tools = createToolAssessment(pi);
  const tuningDeps = (): TuningDeps => ({
    dir: jevDir(),
    now: Date.now,
    load: () => loadSnapshot(pi),
    updateTuning,
    readLedger,
  });
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
    rich: {
      groups: SHIPPED_MAIN_GROUPS,
      tools: () => activeTools(pi),
      agents: (cwd) => listAgents({ cwd, agentDir: getAgentDir() }),
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    try {
      if (isChild(ctx.sessionManager.getSessionId())) return;
      captureMainService();
      main.sessionStart();
      try {
        window.load((deps.readLines ?? ledgerLines)());
      } catch {
        window.clear();
      }
      log.reset(ctx.sessionManager.getSessionId());
      sessionModes().rebuild(ctx.sessionManager.getSessionId(), ctx.sessionManager.getBranch());
      drawStatus(ctx, loadSnapshot(pi), main.decision());
    } catch {
      /* swallow: the line stays as it was */
    }
    try {
      showUnseenTuning(tuningDeps(), ctx);
    } catch {
      /* swallow */
    }
  });

  pi.on("session_tree", async (_event, ctx) => {
    try {
      if (isChild(ctx.sessionManager.getSessionId())) return;
      sessionModes().rebuild(ctx.sessionManager.getSessionId(), ctx.sessionManager.getBranch());
      drawStatus(ctx, loadSnapshot(pi), main.decision(), main.overlay());
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
    try {
      settleTuning(tuningDeps(), ctx);
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
        load: (sessionId) => loadSnapshot(pi, sessionId),
        appendEntry: (type, data) => pi.appendEntry(type, data),
        sessionModes: sessionModes(),
        decision: main.decision,
        tally: log.tally,
        window: () => window.entries(),
        overlay: main.overlay,
        exec: (c, a, o) => pi.exec(c, a, o),
        tune: (sub, c) => runTune(tuningDeps(), sub, c),
      });
    },
  });
}

/** Tools declared to the model: the active names joined with their descriptions. */
function activeTools(pi: ExtensionAPI): { name: string; description: string }[] {
  const active = new Set(pi.getActiveTools());
  return pi
    .getAllTools()
    .filter((t) => active.has(t.name))
    .map((t) => ({ name: t.name, description: t.description }));
}
