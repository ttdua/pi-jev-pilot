import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { probeReport } from "../report";

// Records child session detection.
export default function (pi: ExtensionAPI): void {
  const report = probeReport("child");
  pi.events.on("subagents:child:session-created", (payload) => {
    const sessionId = String((payload as { sessionId?: unknown }).sessionId ?? "");
    report("child:session-created", { sessionId });
  });
  pi.events.on("subagents:child:disposed", (payload) => {
    const sessionId = String((payload as { sessionId?: unknown }).sessionId ?? "");
    report("child:disposed", { sessionId });
  });
  pi.on("session_start", async (_event, ctx) => {
    report("session_start", { sessionId: ctx.sessionManager.getSessionId() });
  });
}
