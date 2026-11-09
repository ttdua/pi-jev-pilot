import { join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { askJev } from "../../jev/client.ts";
import type { ExecutorOutcome, WindowEntry } from "../../policy/worker/index.ts";
import { appendLedger } from "../../store/ledger.ts";
import { jevDir, loadSnapshot, type Snapshot } from "../platform/index.ts";
import type { LaunchEntry } from "./entry.ts";
import {
  onExecutorEvent,
  onMessageEnd,
  onToolCall,
  onToolResult,
  type WorkerHost,
} from "./handlers.ts";
import { LaunchBook } from "./launches.ts";
import { LaunchWarnings } from "./warnings.ts";

export type WorkerDeps = {
  /** The in-memory cut-point window; default empty (seed cut points). */
  window?: () => readonly WindowEntry[];
  ask?: typeof askJev;
  append?: (entry: unknown) => void;
  snapshot?: () => Snapshot;
  agentDir?: string;
  now?: () => number;
};

export type WorkerRouting = {
  off(): void;
  clearWarnings(): void;
  /** Launches, joined drafts and buffered outcomes still held. */
  pending(): number;
};

const EXECUTOR_EVENTS = ["subagents:completed", "subagents:failed", "subagents:resumed"] as const;

/** The handlers' shared context; dependency defaults resolved once, called detached as before. */
function workerHost(pi: ExtensionAPI, deps: WorkerDeps): WorkerHost {
  const { agentDir } = deps;
  return {
    book: new LaunchBook<LaunchEntry, ExecutorOutcome>(),
    warnings: new LaunchWarnings(() => join(jevDir(), "config.json")),
    classify: {
      ask: deps.ask ?? askJev,
      agentDir: () => agentDir ?? getAgentDir(),
      window: deps.window ?? ((): readonly WindowEntry[] => []),
      apiKey: (keyVar) => process.env[keyVar] ?? "",
    },
    snapshot: deps.snapshot ?? (() => loadSnapshot(pi)),
    append: deps.append ?? ((entry: unknown): void => void appendLedger(jevDir(), entry)),
    now: deps.now ?? Date.now,
  };
}

/** Subscribes the executor events; a missing event bus leaves only the refused-launch lines. */
function subscribeExecutor(pi: ExtensionAPI, host: WorkerHost): (() => void)[] {
  const offs: (() => void)[] = [];
  for (const name of EXECUTOR_EVENTS) {
    try {
      offs.push(
        pi.events.on(name, (data: unknown) => {
          try {
            onExecutorEvent(host, data);
          } catch {
            /* fail open */
          }
        }),
      );
    } catch {
      /* a missing event bus leaves only the refused-launch lines */
    }
  }
  return offs;
}

/** Subscribes the Pi events; every handler fails open. */
function subscribePi(pi: ExtensionAPI, host: WorkerHost): (() => void)[] {
  return [
    pi.on("message_end", async (event, ctx) => {
      try {
        await onMessageEnd(host, event, ctx);
      } catch {
        /* fail open */
      }
    }),
    pi.on("tool_call", async (event, ctx) => {
      try {
        await onToolCall(host, event, ctx);
      } catch {
        /* fail open: the input stays as the caller sent it */
      }
    }),
    pi.on("tool_result", (event) => {
      try {
        onToolResult(host, event);
      } catch {
        /* fail open */
      }
    }),
  ];
}

/**
 * Worker routing: classifies `subagent` launches, writes the model and thinking into the tool
 * input, and records one `worker` ledger line per launch. Every handler fails open.
 */
export function registerWorkerRouting(pi: ExtensionAPI, deps: WorkerDeps = {}): WorkerRouting {
  const host = workerHost(pi, deps);
  const offs = [...subscribePi(pi, host), ...subscribeExecutor(pi, host)];
  return {
    off() {
      host.book.close();
      for (const off of offs.splice(0)) {
        try {
          off();
        } catch {
          /* keep shutdown clean */
        }
      }
    },
    clearWarnings() {
      host.warnings.clear();
    },
    pending: () => host.book.pending(),
  };
}
