/**
 * WG-16 manual script: saves the capabilities snapshot used by the rich state replay.
 *
 * Operator run (never part of `bun test`; no model call, no network beyond what Pi needs to start):
 *   bun tests/host/manual/capabilities-snapshot.ts <output-file>
 *
 * Starts Pi in RPC mode with your real agent directory (PI_CODING_AGENT_DIR or ~/.pi/agent) and the
 * current directory, plus a small probe extension that writes the active tools and the executor's
 * agents (its registry, mapped with `agentFacts`; empty without the executor). The file
 * `{ v: 1, tools, agents }` is written owner-only. Prints counts only.
 */
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { tempDir } from "../../helpers.ts";
import { spawnRpc } from "../rpc.ts";

const WAIT_MS = 30_000;
const PROBE = join(import.meta.dir, "probe-tools", "index.ts");

const out = process.argv[2];
if (out === undefined) {
  console.error("usage: bun tests/host/manual/capabilities-snapshot.ts <output-file>");
  process.exit(2);
}

const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
const scratch = tempDir("jev-snapshot-");
const toolsFile = join(scratch, "tools.json");
const agentsFile = join(scratch, "agents.json");
// spawnRpc keeps the child env allow-listed; the real HOME is passed so Pi finds its own login-free config.
const rpc = spawnRpc({
  agentDir,
  home: process.env.HOME ?? homedir(),
  cwd: process.cwd(),
  args: ["--no-session", "-e", PROBE],
  env: { JEV_TOOLS_OUT: toolsFile, JEV_AGENTS_OUT: agentsFile, PI_OFFLINE: "1" },
  timeoutMs: WAIT_MS,
});
try {
  await rpc.waitFor(() => existsSync(agentsFile), "active tools and agents files");
  const tools = JSON.parse(readFileSync(toolsFile, "utf8")) as unknown[];
  const agents = JSON.parse(readFileSync(agentsFile, "utf8")) as unknown[];
  writeFileSync(out, `${JSON.stringify({ v: 1, tools, agents }, null, 2)}\n`, { mode: 0o600 });
  chmodSync(out, 0o600);
  console.log(`tools=${tools.length} agents=${agents.length}`);
} finally {
  await rpc.close();
  rmSync(scratch, { recursive: true, force: true });
}
