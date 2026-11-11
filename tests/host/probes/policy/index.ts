import { readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { LaunchAdjustment, LaunchPolicy, SubagentsService } from "@ttdua/pi-subagents";
import { Type } from "typebox";
import { probeReport } from "../report";

// A test launch policy. Reads a scripted adjustment from the JSON file named by JEV_POLICY_FILE
// and registers it with the executor service at the main session's `session_start`; registers
// `probe_tool`; `/probe-spawn <type> <prompt>` calls the service's `spawn()`; `/probe-reload`
// reloads. Records event names, ids and counters only, never prompt text.

type Script = { adjustment?: LaunchAdjustment; delayMs?: number; timeoutMs?: number };

const SERVICE_KEY = Symbol.for("@gotgenes/pi-subagents:service");
const DEFAULT_TIMEOUT_MS = 10_000;
const PROBE_TOOL_TEXT = "PROBE-TOOL-OK";

function service(): SubagentsService | undefined {
  const value = (globalThis as Record<symbol, unknown>)[SERVICE_KEY];
  return typeof value === "object" && value !== null ? (value as SubagentsService) : undefined;
}

function readScript(): Script {
  const file = process.env.JEV_POLICY_FILE;
  if (!file) return {};
  return JSON.parse(readFileSync(file, "utf8")) as Script;
}

/** True in the session whose executor instance published the service: the main session. */
function isMain(ctx: ExtensionContext): boolean {
  return service()?.sessionId === ctx.sessionManager.getSessionId();
}

/** Resolves after `ms`, or at once when `signal` aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export default function (pi: ExtensionAPI): void {
  const report = probeReport("policy");
  let unregister: (() => void) | undefined;
  report("load", { data: { service: service() !== undefined } });

  const policy = (script: Script): LaunchPolicy => {
    return async (request, signal) => {
      report("policy:call", {
        data: {
          agentId: request.agentId,
          origin: request.origin.kind,
          bg: request.isBackground,
          inherit: request.inheritContext,
        },
      });
      if (script.delayMs !== undefined) await sleep(script.delayMs, signal);
      if (signal.aborted) report("policy:aborted", { data: { agentId: request.agentId } });
      return script.adjustment;
    };
  };

  pi.on("session_start", async (event, ctx) => {
    if (!isMain(ctx)) return;
    const svc = service();
    report("session_start", { data: { reason: event.reason, service: svc !== undefined } });
    if (svc === undefined) return;
    const script = readScript();
    try {
      unregister = svc.registerLaunchPolicy(policy(script), {
        timeoutMs: script.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
      report("policy:registered");
    } catch {
      report("policy:taken");
    }
  });

  pi.on("session_shutdown", async () => {
    unregister?.();
    unregister = undefined;
  });

  pi.events.on("subagents:child:bound", (payload) => {
    const granted = (payload as { grantedTools?: readonly string[] }).grantedTools ?? [];
    report("child:bound", { data: { granted: granted.includes("probe_tool") } });
  });

  pi.registerTool({
    name: "probe_tool",
    label: "probe_tool",
    description: "Returns a fixed string. Test probe.",
    parameters: Type.Object({}),
    execute: async () => {
      report("tool:executed");
      return { content: [{ type: "text", text: PROBE_TOOL_TEXT }], details: {} };
    },
  });

  pi.registerCommand("probe-spawn", {
    description: "Spawn an agent through the executor service: <type> <prompt>",
    handler: async (args) => {
      const [type = "general-purpose", ...rest] = args.trim().split(/\s+/);
      const id = service()?.spawn(type, rest.join(" "), { description: "probe spawn" });
      report("spawn", { data: { agentId: id ?? "none" } });
    },
  });

  pi.registerCommand("probe-reload", {
    description: "Reload extensions",
    handler: async (_args, ctx) => {
      await ctx.reload();
    },
  });
}
