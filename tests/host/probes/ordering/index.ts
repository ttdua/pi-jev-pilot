import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { probeReport } from "../report";

// Records message_end (with a 300ms async delay) and tool_call ordering for `subagent` calls.
export default function (pi: ExtensionAPI): void {
  const report = probeReport("ordering");
  pi.on("message_end", async (event, ctx) => {
    const message = event.message as { role?: string; content?: unknown };
    if (message.role !== "assistant" || !Array.isArray(message.content)) return;
    const hasSubagent = message.content.some(
      (c: { type?: string; name?: string }) => c?.type === "toolCall" && c.name === "subagent",
    );
    if (!hasSubagent) return;
    const sessionId = ctx.sessionManager.getSessionId();
    report("message_end:start", { sessionId });
    await new Promise((resolve) => setTimeout(resolve, 300));
    report("message_end:end", { sessionId });
  });
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "subagent") return;
    report("tool_call:start", {
      sessionId: ctx.sessionManager.getSessionId(),
      data: { toolCallId: event.toolCallId },
    });
  });
}
