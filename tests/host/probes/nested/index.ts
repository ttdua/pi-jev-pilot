import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { probeReport } from "../report";

// Tool `nest` runs `subagent` through ctx.executeTool, so the launch carries parentToolCallId.
export default function (pi: ExtensionAPI): void {
  const report = probeReport("nested");
  pi.on("tool_call", async (event) => {
    if (event.toolName !== "subagent") return;
    const parent = (event as { parentToolCallId?: string }).parentToolCallId;
    report("tool_call", { data: { hasParent: parent !== undefined && parent !== "" } });
  });
  pi.registerTool({
    name: "nest",
    label: "Nest",
    description: "Runs the subagent tool from inside another tool.",
    parameters: Type.Object({ args: Type.Record(Type.String(), Type.Unknown()) }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const outcome = await ctx.executeTool("subagent", params.args);
      const text = outcome.result.content
        .map((c: { type: string; text?: string }) => (c.type === "text" ? (c.text ?? "") : ""))
        .join("\n");
      return { content: [{ type: "text", text }], details: {} };
    },
  });
}
