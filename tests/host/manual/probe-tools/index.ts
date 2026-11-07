import { writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Writes the active tools (name and description) of this session to JEV_TOOLS_OUT. */
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
  });
}
