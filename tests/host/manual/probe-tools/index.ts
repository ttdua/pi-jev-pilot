import { writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { executorAgents } from "../../../../src/host/platform/agents.ts";

const SERVICE_KEY = Symbol.for("@gotgenes/pi-subagents:service");

/**
 * Writes the active tools (name and description) of this session to JEV_TOOLS_OUT, then the
 * executor's agents as facts to JEV_AGENTS_OUT (empty without the vendored executor).
 */
export default function (pi: ExtensionAPI): void {
  pi.on("session_start", async () => {
    const out = process.env.JEV_TOOLS_OUT;
    if (!out) return;
    const active = new Set(pi.getActiveTools());
    const tools = pi
      .getAllTools()
      .filter((t) => active.has(t.name))
      .map((t) => ({ name: t.name, description: t.description }));
    writeFileSync(out, JSON.stringify(tools), { mode: 0o600 });
    const agentsOut = process.env.JEV_AGENTS_OUT;
    if (!agentsOut) return;
    const service = (globalThis as Record<symbol, unknown>)[SERVICE_KEY] as never;
    writeFileSync(agentsOut, JSON.stringify(executorAgents(service)), { mode: 0o600 });
  });
}
