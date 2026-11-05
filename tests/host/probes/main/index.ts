import { existsSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { probeReport } from "../report";

type ThinkingLevel = Parameters<ExtensionAPI["setThinkingLevel"]>[0];

// Injects a hidden custom message while the flag file exists and sets the thinking level in the same turn.
export default function (pi: ExtensionAPI): void {
  const report = probeReport("main");
  pi.on("before_agent_start", async () => {
    const level = process.env.JEV_SET_THINKING;
    if (level) {
      pi.setThinkingLevel(level as ThinkingLevel);
      report("thinking:set");
    }
    const flag = process.env.JEV_HIDDEN_FLAG;
    if (flag && existsSync(flag)) {
      report("hidden:sent");
      return { message: { customType: "jev-probe", content: "JEV-MARKER-5c1e", display: false } };
    }
    return undefined;
  });
}
