import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { probeReport } from "../report";

// Records what the child can see of its environment, as data only (never secret values).
export default function (pi: ExtensionAPI): void {
  const report = probeReport("envcheck");
  pi.on("session_start", async () => {
    report("env", {
      data: {
        home: process.env.HOME ?? "",
        agentDir: process.env.PI_CODING_AGENT_DIR ?? "",
        hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
        hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
      },
    });
  });
}
