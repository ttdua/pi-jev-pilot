import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { probeReport } from "../report";

// Rewrites model and thinking of `subagent` tool calls before the executor runs them.
export default function (pi: ExtensionAPI): void {
  const report = probeReport("rewrite");
  pi.on("tool_call", async (event) => {
    if (event.toolName !== "subagent") return;
    const input = event.input as Record<string, unknown>;
    const model = process.env.JEV_REWRITE_MODEL;
    const thinking = process.env.JEV_REWRITE_THINKING;
    if (model) input.model = model;
    if (thinking) input.thinking = thinking;
    report("tool_call", {
      data: { model: String(input.model ?? ""), thinking: String(input.thinking ?? "") },
    });
  });
}
