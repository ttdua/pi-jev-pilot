import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { probeReport } from "../report";

// Records, per tool, which package directory registered it (RPC does not expose sourceInfo).
export default function (pi: ExtensionAPI): void {
  const report = probeReport("tools");
  pi.on("session_start", async () => {
    for (const tool of pi.getAllTools()) {
      report("tool", { data: { name: tool.name, path: tool.sourceInfo.path } });
    }
  });
}
