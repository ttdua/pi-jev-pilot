// Loopback fixture for the interactive fleet-list check (docs/evidence). Run with `bun scripts/e2e/fleet-fixture.ts`.
// `bun scripts/e2e/fleet-fixture.ts --check-again <status-file>` exits non-zero unless a `fixture-fast`
// request carrying FLEET-AGAIN is recorded in that file.
// Prints AGENT_DIR=, CWD=, BASE_URL= and STATUS_FILE=, then runs until SIGINT/SIGTERM.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PI_BIN, REPO_ROOT, tempDir } from "../../tests/helpers";
import {
  fixtureModelsJson,
  startFixture,
  type Fixture,
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

/** The first user message, kept only when it is a fixture marker. */
const markerText = (r: RecordedRequest): string => {
  const text = firstUserText(r).slice(0, PREVIEW_CHARS);
  return text.includes("FLEET-") || text.includes("launch") || text.includes("again") ? text : "";
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

/** Epoch ms at which each child reply started streaming, by request seq. */
const repliedAt: Record<number, number> = {};

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
    reply: (r) => {
      repliedAt[r.seq] = Date.now();
      return { text: "done" };
    },
    delayMs: CHILD_DELAY_MS,
  },
  { name: "main-after", match: (r) => r.model === "fixture-main", reply: { text: "ok" } },
];

type StatusRequest = { seq: number; model: string; user: string; repliedAt?: number };

/** Throws unless the status file records a child request for the `again` launch. */
export function assertAgainChildReached(statusPath: string): StatusRequest {
  const { requests } = JSON.parse(readFileSync(statusPath, "utf8")) as {
    requests: StatusRequest[];
  };
  const hit = requests.find((r) => r.model === CHILD_MODEL && r.user.includes("FLEET-AGAIN"));
  if (!hit) throw new Error("no fixture-fast request with FLEET-AGAIN reached the fixture");
  return hit;
}

/** Installs the executor into fresh temp dirs (recorded in `created` first) and returns them. */
function prepareDirs(fixture: Fixture, created: string[]): { agentDir: string; cwd: string } {
  const agentDir = tempDir("fleet-e2e-agent-");
  created.push(agentDir);
  const cwd = tempDir("fleet-e2e-cwd-");
  created.push(cwd);
  const home = join(agentDir, "home");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(agentDir, "models.json"), JSON.stringify(fixtureModelsJson(fixture.baseUrl)));
  const installed = Bun.spawnSync(
    [PI_BIN, "install", join(REPO_ROOT, "tests", "fixtures", "executor-only")],
    { cwd, env: isolatedEnv(agentDir, home, { PI_OFFLINE: "1" }), stdout: "pipe", stderr: "pipe" },
  );
  if (installed.exitCode !== 0) throw new Error(`install failed: ${installed.stderr.toString()}`);
  return { agentDir, cwd };
}

/** Writes the request status file now and every STATUS_INTERVAL_MS; returns the timer. */
function publishStatus(fixture: Fixture, statusFile: string): ReturnType<typeof setInterval> {
  const write = (): void => {
    const requests = fixture.requests.map((r) => ({
      seq: r.seq,
      model: r.model,
      user: markerText(r),
      repliedAt: repliedAt[r.seq],
    }));
    writeFileSync(statusFile, JSON.stringify({ requests }));
  };
  write();
  return setInterval(write, STATUS_INTERVAL_MS);
}

async function serve(): Promise<void> {
  const created: string[] = [];
  const held: { timer?: ReturnType<typeof setInterval>; fixture?: Fixture; done: boolean } = {
    done: false,
  };
  const cleanup = async (): Promise<void> => {
    if (held.done) return;
    held.done = true;
    if (held.timer) clearInterval(held.timer);
    await held.fixture?.stop();
    for (const dir of created) rmSync(dir, { recursive: true, force: true });
  };
  const onSignal = (): void => void cleanup().finally(() => process.exit(0));
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    const fixture = await startFixture(script);
    held.fixture = fixture;
    const { agentDir, cwd } = prepareDirs(fixture, created);
    const statusFile = join(agentDir, "fixture-status.json");
    held.timer = publishStatus(fixture, statusFile);
    console.log(`AGENT_DIR=${agentDir}\nCWD=${cwd}\nBASE_URL=${fixture.baseUrl}`);
    console.log(`STATUS_FILE=${statusFile}`);
    await new Promise<void>(() => undefined);
  } catch (error) {
    console.error(error);
    await cleanup();
    process.exit(1);
  }
}

const checkIndex = process.argv.indexOf("--check-again");
if (checkIndex >= 0) {
  const hit = assertAgainChildReached(process.argv[checkIndex + 1] ?? "");
  console.log(`CHECK-AGAIN OK: seq ${hit.seq} ${hit.model} ${hit.user}`);
} else {
  await serve();
}
