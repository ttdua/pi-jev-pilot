// Loopback fixture for the interactive fleet-list check (docs/evidence). Run with `bun scripts/e2e/fleet-fixture.ts`.
// Prints AGENT_DIR=, CWD=, BASE_URL= and STATUS_FILE=, then runs until SIGINT/SIGTERM.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PI_BIN, REPO_ROOT, tempDir } from "../../tests/helpers";
import {
  fixtureModelsJson,
  startFixture,
  type RecordedRequest,
  type ScriptEntry,
} from "../../tests/host/fixture";
import { isolatedEnv } from "../../tests/host/rpc";

const CHILD_MODEL = "fixture-fast";
const CHILD_DELAY_MS = 20_000;
const STATUS_INTERVAL_MS = 500;
const PREVIEW_CHARS = 40;

type Msg = { role?: string; content?: unknown };
const messages = (r: RecordedRequest): Msg[] =>
  Array.isArray(r.body.messages) ? (r.body.messages as Msg[]) : [];
const lastIsUser = (r: RecordedRequest, text: string): boolean => {
  const last = messages(r).at(-1);
  return last?.role === "user" && JSON.stringify(last).includes(text);
};
const firstUserText = (r: RecordedRequest): string => {
  const content = messages(r).find((m) => m.role === "user")?.content;
  return typeof content === "string" ? content : JSON.stringify(content ?? "");
};

const subagentCall = (background: boolean, brief: string) => ({
  name: "subagent",
  arguments: {
    prompt: brief,
    description: `fleet ${brief}`,
    subagent_type: "general-purpose",
    model: `fixture/${CHILD_MODEL}`,
    run_in_background: background,
  },
});

const script: ScriptEntry[] = [
  {
    name: "main-launch",
    match: (r) => r.model === "fixture-main" && lastIsUser(r, "launch"),
    reply: { toolCalls: [subagentCall(true, "FLEET-BG"), subagentCall(false, "FLEET-FG")] },
    times: 1,
  },
  {
    name: "main-again",
    match: (r) => r.model === "fixture-main" && lastIsUser(r, "again"),
    reply: { toolCalls: [subagentCall(true, "FLEET-AGAIN")] },
  },
  {
    name: "child",
    match: (r) => r.model === CHILD_MODEL,
    reply: { text: "done" },
    delayMs: CHILD_DELAY_MS,
  },
  { name: "main-after", match: (r) => r.model === "fixture-main", reply: { text: "ok" } },
];

const fixture = await startFixture(script);
const agentDir = tempDir("fleet-e2e-agent-");
const cwd = tempDir("fleet-e2e-cwd-");
const home = join(agentDir, "home");
mkdirSync(home, { recursive: true });
writeFileSync(join(agentDir, "models.json"), JSON.stringify(fixtureModelsJson(fixture.baseUrl)));

const installed = Bun.spawnSync(
  [PI_BIN, "install", join(REPO_ROOT, "tests", "fixtures", "executor-only")],
  { cwd, env: isolatedEnv(agentDir, home, { PI_OFFLINE: "1" }), stdout: "pipe", stderr: "pipe" },
);
if (installed.exitCode !== 0) {
  console.error(`install failed: ${installed.stderr.toString()}`);
  await fixture.stop();
  rmSync(agentDir, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
  process.exit(1);
}

const statusFile = join(agentDir, "fixture-status.json");
const writeStatus = (): void => {
  const requests = fixture.requests.map((r) => ({
    seq: r.seq,
    model: r.model,
    user: firstUserText(r)
      .slice(0, PREVIEW_CHARS)
      .replace(/[^\n]*/, (s) => (s.includes("FLEET-") || s.includes("launch") ? s : "")),
  }));
  writeFileSync(statusFile, JSON.stringify({ requests }));
};
writeStatus();
const timer = setInterval(writeStatus, STATUS_INTERVAL_MS);

console.log(`AGENT_DIR=${agentDir}`);
console.log(`CWD=${cwd}`);
console.log(`BASE_URL=${fixture.baseUrl}`);
console.log(`STATUS_FILE=${statusFile}`);

const shutdown = async (): Promise<void> => {
  clearInterval(timer);
  await fixture.stop();
  rmSync(agentDir, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
