import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SubagentsService } from "@ttdua/pi-subagents";
import { probeReport } from "../report";

// Escalation probe. `/esc-spawn <type> <fg|bg> <wait|nowait>` launches `CHILD-TASK escalate` with
// metadata and optionally holds the run with `wait()`; `/esc-resume <id>` resumes it with a fixed
// answer and waits for the resumed run. Records event names, ids, statuses, booleans and counts
// only: never a prompt, question or answer text.

const SERVICE_KEY = Symbol.for("@gotgenes/pi-subagents:service");
const PROMPT = "CHILD-TASK escalate";
const ANSWER = "ANSWER-TEXT";
const CHANNELS = ["subagents:update", "subagents:asked", "subagents:completed"] as const;

function service(): SubagentsService | undefined {
  const value = (globalThis as Record<symbol, unknown>)[SERVICE_KEY];
  return typeof value === "object" && value !== null ? (value as SubagentsService) : undefined;
}

function isMain(ctx: ExtensionContext): boolean {
  return service()?.sessionId === ctx.sessionManager.getSessionId();
}

type Snapshot = {
  status?: string;
  pendingQuestion?: string;
  resumeRefusal?: unknown;
  result?: string;
};
const facts = (r: Snapshot | undefined) => ({
  status: r?.status ?? "none",
  hasQuestion: r?.pendingQuestion !== undefined,
  hasRefusal: r?.resumeRefusal !== undefined,
});

export default function (pi: ExtensionAPI): void {
  const report = probeReport("escalation");

  for (const ch of CHANNELS) {
    pi.events.on(ch, (payload) => {
      const p = payload as { id?: string; metadata?: unknown };
      report("event", { data: { ch, id: p.id ?? "none", meta: p.metadata !== undefined } });
    });
  }

  pi.events.on("subagents:completed", (payload) => {
    const id = (payload as { id?: string }).id;
    if (id === undefined) return;
    report("snapshot", {
      data: { id, ...facts(service()?.getRecord(id) as Snapshot | undefined) },
    });
  });

  pi.on("message_end", async (event, ctx) => {
    if (!isMain(ctx)) return;
    const customType = (event.message as { customType?: string }).customType;
    if (customType !== undefined) report("main:message", { data: { customType } });
  });

  pi.registerCommand("esc-spawn", {
    description: "Spawn an escalating agent: <type> <fg|bg> <wait|nowait>",
    handler: async (args) => {
      const [type = "general-purpose", mode = "bg", waiting = "nowait"] = args.trim().split(/\s+/);
      const svc = service();
      if (svc === undefined) return;
      const id = svc.spawn(type, PROMPT, {
        description: "escalation probe",
        foreground: mode === "fg",
        metadata: { change: "c1" },
      });
      report("spawn", { data: { id, fg: mode === "fg", wait: waiting === "wait" } });
      if (waiting !== "wait") return;
      svc.wait(id).then(
        (r) => report("wait:resolved", { data: { id, ...facts(r as Snapshot) } }),
        () => report("wait:rejected", { data: { id } }),
      );
    },
  });

  pi.registerCommand("esc-resume", {
    description: "Resume an agent with a fixed answer and wait for the resumed run: <id>",
    handler: async (args) => {
      const svc = service();
      const id = args.trim();
      if (svc === undefined) return;
      void svc.resume(id, ANSWER);
      svc.wait(id).then(
        (r) =>
          report("wait2:resolved", {
            data: { id, status: r.status, resultIsFinal: r.result === "final" },
          }),
        () => report("wait2:rejected", { data: { id } }),
      );
    },
  });
}
