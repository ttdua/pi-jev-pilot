import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  subscribeChildren,
  scanPlatforms,
  executorAgents,
  loadSnapshot,
  jevDir,
} from "./platform/index.ts";
import { SHIPPED_MAIN_GROUPS } from "../jev/state.ts";
import { updateTuning } from "../store/tuning-file.ts";
import { askJev } from "../jev/client.ts";
import type { WriteResult } from "../store/validate.ts";
import { appendLedger, readLedger } from "../store/ledger.ts";
import {
  createCutpointWindow,
  type CutpointWindow,
  registerWorkerRouting,
} from "./worker/index.ts";
import { createMain } from "./main/index.ts";
import { registerReviewTool } from "./review/index.ts";
import { compactTally, logLine, createSessionLog } from "./status/index.ts";
import type { TuningDeps } from "./tuning/index.ts";
import { mainService } from "./platform/index.ts";
import {
  registerJevCommand,
  subscribeSessionShutdown,
  subscribeSessionStart,
  subscribeTurn,
  type Parts,
  type SetupDeps,
} from "./wiring/index.ts";

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

export type { SetupDeps };

type Append = (entry: unknown) => WriteResult;
type Log = ReturnType<typeof createSessionLog>;

/** Appends to the ledger, then feeds the session log and the window; neither can fail the append. */
function ledgerAppender(log: Log, window: CutpointWindow): Append {
  return (e) => {
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
}

/** The main handlers, wired to the ledger, the session tally and the Pi readers. */
function buildMain(pi: ExtensionAPI, log: Log, append: Append) {
  return createMain(pi, {
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
      agents: () => executorAgents(mainService()),
    },
  });
}

/** Register the status line, the /jev command and the child registry on one extension instance. */
export function setup(pi: ExtensionAPI, deps: SetupDeps = {}): void {
  const off = subscribeChildren(pi.events);
  const log = createSessionLog(pi, {
    verbose: () => loadSnapshot(pi).settings.switches.verbose,
  });
  const window = deps.window ?? createCutpointWindow();
  const append = ledgerAppender(log, window);
  const routing = registerWorkerRouting(pi, { append, window: () => window.entries() });
  const tuningDeps = (): TuningDeps => ({
    dir: jevDir(),
    now: Date.now,
    load: () => loadSnapshot(pi),
    updateTuning,
    readLedger,
  });
  const main = buildMain(pi, log, append);
  const parts: Parts = { seams: deps, off, routing, window, log, main, tuningDeps };
  subscribeSessionStart(pi, parts);
  registerReviewTool(pi);
  registerLogRenderer(pi);
  subscribeTurn(pi, parts);
  subscribeSessionShutdown(pi, parts);
  registerJevCommand(pi, parts);
}

/** Tools declared to the model: the active names joined with their descriptions. */
function activeTools(pi: ExtensionAPI): { name: string; description: string }[] {
  const active = new Set(pi.getActiveTools());
  return pi
    .getAllTools()
    .filter((t) => active.has(t.name))
    .map((t) => ({ name: t.name, description: t.description }));
}
