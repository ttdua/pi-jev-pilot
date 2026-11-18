// Extension owned by `scripts/fork-cache-evidence.ts`; loaded into the Pi session it drives.
// Registers `/evidence-spawn <type> <prompt>` (a fork through the executor service's `spawn()`)
// and writes JSON lines with wall-clock times to the file named by FORK_EVIDENCE_REPORT:
//   request    a provider request is about to be sent (main session only)
//   launch     a child run starts (`subagents:child:spawning`)
//   session    the child's session id (`subagents:child:session-created`)
//   completed  a child finished
// Never records prompt text.
import { appendFileSync } from "node:fs";

// Minimal local view of the Pi extension API (lint keeps Pi imports in host/).
type Ctx = { sessionManager: { getSessionId(): string } };
type ExtensionAPI = {
  on(event: string, handler: (event: unknown, ctx: Ctx) => Promise<void>): void;
  events: { on(channel: string, handler: (payload: unknown) => void): void };
  registerCommand(
    name: string,
    command: { description: string; handler: (args: string) => Promise<void> },
  ): void;
};

type Spawn = (type: string, prompt: string, options: object) => string | undefined;
type Service = { sessionId?: string; spawn: Spawn };

const SERVICE_KEY = Symbol.for("@gotgenes/pi-subagents:service");

function service(): Service | undefined {
  const value = (globalThis as Record<symbol, unknown>)[SERVICE_KEY];
  return typeof value === "object" && value !== null ? (value as Service) : undefined;
}

function report(event: string, data: Record<string, unknown> = {}): void {
  const path = process.env.FORK_EVIDENCE_REPORT;
  if (path) appendFileSync(path, `${JSON.stringify({ event, t: Date.now(), ...data })}\n`);
}

export default function (pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    if (service()?.sessionId === ctx.sessionManager.getSessionId()) report("session_start");
  });

  pi.on("before_provider_request", async (_event, ctx) => {
    if (service()?.sessionId === ctx.sessionManager.getSessionId()) report("request");
  });

  pi.events.on("subagents:child:spawning", (payload) => {
    report("launch", { agentId: (payload as { agentId?: string }).agentId });
  });

  pi.events.on("subagents:child:session-created", (payload) => {
    const p = payload as { agentId?: string; sessionId?: string };
    report("session", { agentId: p.agentId, sessionId: p.sessionId });
  });

  pi.events.on("subagents:completed", () => report("completed"));

  pi.registerCommand("evidence-spawn", {
    description: "Spawn a fork: <type> <prompt>",
    handler: async (args) => {
      const [type = "general-purpose", ...rest] = args.trim().split(/\s+/);
      const model = process.env.FORK_EVIDENCE_SPAWN_MODEL;
      try {
        service()?.spawn(type, rest.join(" "), {
          description: "fork cache evidence",
          context: "fork",
          ...(model === undefined ? {} : { model }),
        });
      } catch (error) {
        report("spawn:error", { message: error instanceof Error ? error.message : "unknown" });
      }
    },
  });
}
