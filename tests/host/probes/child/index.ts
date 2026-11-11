import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { probeReport } from "../report";

const CHILDREN = Symbol.for("jev-probe.children");

function children(): Set<string> {
  const g = globalThis as Record<symbol, Set<string> | undefined>;
  const set = g[CHILDREN] ?? new Set<string>();
  g[CHILDREN] = set;
  return set;
}

// Records child session detection and removes JEV_REMOVE_TOOL from detected children's selected tools.
export default function (pi: ExtensionAPI): void {
  const report = probeReport("child");
  pi.events.on("subagents:child:session-created", (payload) => {
    const sessionId = String((payload as { sessionId?: unknown }).sessionId ?? "");
    children().add(sessionId);
    report("child:session-created", { sessionId });
  });
  pi.events.on("subagents:child:disposed", (payload) => {
    const sessionId = String((payload as { sessionId?: unknown }).sessionId ?? "");
    report("child:disposed", { sessionId });
  });
  pi.on("session_start", async (_event, ctx) => {
    report("session_start", { sessionId: ctx.sessionManager.getSessionId() });
  });
  pi.on("before_agent_start", async (event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const tool = process.env.JEV_REMOVE_TOOL;
    if (!tool || !children().has(sessionId)) return;
    const selected = event.systemPromptOptions.selectedTools;
    if (!selected) return;
    const before = selected.length;
    const kept = selected.filter((t) => t !== tool);
    selected.splice(0, selected.length, ...kept);
    report("tools:removed", { sessionId, data: { before, after: selected.length } });
  });
}
