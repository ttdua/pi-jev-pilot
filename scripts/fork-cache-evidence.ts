// Manual evidence run (never part of `bun test`): measures how much of a parent's prompt a fork
// reads from the provider's cache, on real providers.
//
//   bun scripts/fork-cache-evidence.ts --openai <provider/id> [--anthropic-route <provider/id>]
//
// Keys come from the environment and are never printed:
//   FORK_EVIDENCE_OPENAI_API_KEY           the OpenAI-compatible row
//   FORK_EVIDENCE_OPENAI_BASE_URL          its base URL (an OpenAI-style `/v1` root)
//   FORK_EVIDENCE_OPENAI_OVERRIDE          model id for the override row (required for that row)
// `--anthropic-route` adds one optional, unbounded Anthropic-model row through another client
// (for example `claude-code/claude-haiku-5-5`, the pi-claude-code extension at
// FORK_EVIDENCE_ANTHROPIC_ROUTE_EXTENSION, default ~/.pi/agent/git/github.com/earendil-works/pi-claude-code).
// It is not bounded: that route may not expose Pi's request prefix. The Anthropic API is not measured.
// The OpenAI-compatible parent runs through a recording proxy; its last request is then sent again
// unchanged to measure the provider's cache floor.
//
// Each run starts its own real Pi session (the executor package plus `fork-cache-evidence-ext/`,
// which provides `/evidence-spawn` and logs request and launch times), sends one parent turn that
// holds a generated filler document, then starts the fork(s) with `/evidence-spawn` and reads the
// first assistant message of each fork
// transcript.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const MIN_PARENT_TOKENS = 25_000;
const MAX_ELAPSED_S = 60;
const BOUND = 0.9;
const FILLER_CHARS = 90_000;
const RUN_TIMEOUT_MS = 180_000;

const REPO_ROOT = join(import.meta.dir, "..");
const PI_BIN = join(REPO_ROOT, "node_modules", ".bin", "pi");
const POLL_MS = 50;

function tempDir(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

/** Environment with nothing from the operator's shell except PATH and TMPDIR. */
function isolatedEnv(
  agentDir: string,
  home: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  // USER/LOGNAME/SHELL: the Claude Code CLI needs them to find its keychain login.
  for (const key of ["PATH", "TMPDIR", "USER", "LOGNAME", "SHELL"]) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, HOME: home, PI_CODING_AGENT_DIR: agentDir, ...extra };
}

type Rpc = {
  send(message: string): void;
  /** Sends `message` and waits for the agent to settle. */
  prompt(message: string): Promise<void>;
  waitFor(pred: () => boolean, label: string): Promise<void>;
  close(): Promise<void>;
};

async function killGroup(proc: { pid: number; exited: Promise<number> }): Promise<void> {
  try {
    process.kill(-proc.pid, "SIGKILL");
  } catch {
    // group already gone
  }
  await proc.exited;
}

/** A minimal `pi --mode rpc` driver: JSON lines in, events counted on the way out. */
function spawnRpc(opts: {
  agentDir: string;
  home: string;
  cwd: string;
  args: string[];
  env: Record<string, string>;
}): Rpc {
  const proc = Bun.spawn([PI_BIN, "--mode", "rpc", ...opts.args], {
    cwd: opts.cwd,
    env: isolatedEnv(opts.agentDir, opts.home, opts.env),
    detached: true,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  let settled = 0;
  void (async () => {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of proc.stdout) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      settled += lines.filter((l) => l.includes('"type":"agent_settled"')).length;
    }
  })();
  const send = (message: string): void => {
    proc.stdin.write(`${JSON.stringify({ type: "prompt", message })}\n`);
    void proc.stdin.flush();
  };
  const waitFor = async (pred: () => boolean, label: string): Promise<void> => {
    const deadline = Date.now() + RUN_TIMEOUT_MS;
    while (!pred()) {
      if (Date.now() >= deadline) throw new Error(`${label}: timed out after ${RUN_TIMEOUT_MS} ms`);
      await Bun.sleep(POLL_MS);
    }
  };
  const prompt = async (message: string): Promise<void> => {
    const before = settled;
    send(message);
    await waitFor(() => settled > before, "agent_settled");
  };
  return { send, prompt, waitFor, close: () => killGroup(proc) };
}

type Kind = "one fork" | "parallel forks" | "model override" | "route (no bound)";
type Row = {
  provider: string;
  kind: Kind;
  parentTokens: number | undefined;
  cacheRead: number | undefined;
  ratio: number | undefined;
  elapsedS: number | undefined;
  verdict: string;
};

type Target = {
  label: string;
  provider: string;
  model: string;
  key: string | undefined;
  env: Record<string, string>;
  /** Replaces the isolated HOME (a route through another client needs that client's login). */
  home?: string;
  /** Extension to install for this route. */
  extension?: string;
  /** Route through the recording proxy and measure the floor. */
  floor?: boolean;
  /** No bound applies to this target's rows. */
  unbounded?: boolean;
  modelsJson?: object;
  override: string | undefined;
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function split(spec: string): { provider: string; model: string } {
  const i = spec.indexOf("/");
  if (i < 0) throw new Error(`expected <provider/id>, got "${spec}"`);
  return { provider: spec.slice(0, i), model: spec.slice(i + 1) };
}

function anthropicRouteTarget(spec: string): Target {
  const { provider, model } = split(spec);
  return {
    label: `Anthropic model via ${provider}`,
    provider,
    model,
    key: "route",
    env: {},
    home: homedir(),
    extension:
      process.env.FORK_EVIDENCE_ANTHROPIC_ROUTE_EXTENSION ??
      join(homedir(), ".pi", "agent", "git", "github.com", "earendil-works", "pi-claude-code"),
    unbounded: true,
    override: undefined,
  };
}

function openaiTarget(spec: string): Target {
  const { provider, model } = split(spec);
  const key = process.env.FORK_EVIDENCE_OPENAI_API_KEY;
  const baseUrl = process.env.FORK_EVIDENCE_OPENAI_BASE_URL;
  const overrideId = process.env.FORK_EVIDENCE_OPENAI_OVERRIDE;
  const models = [model, ...(overrideId === undefined ? [] : [overrideId])].map((id) => ({
    id,
    reasoning: false,
  }));
  return {
    label: "OpenAI-compatible",
    provider,
    model,
    floor: true,
    key: baseUrl === undefined ? undefined : key,
    env: key === undefined ? {} : { FORK_EVIDENCE_OPENAI_API_KEY: key },
    // Affinity headers are off by default outside OpenRouter; the fork guard sets them itself,
    // but the parent must send them for the router to see one session id.
    modelsJson: {
      providers: {
        [provider]: {
          baseUrl,
          api: "openai-completions",
          apiKey: "$FORK_EVIDENCE_OPENAI_API_KEY",
          compat: {
            sendSessionAffinityHeaders: true,
            sessionAffinityFormat: "openai",
          },
          models,
        },
      },
    },
    override: overrideId === undefined ? undefined : `${provider}/${overrideId}`,
  };
}

/** Deterministic filler: varied sentences so tokenization is not trivially compressible. */
function filler(): string {
  const words =
    "river stone lantern copper orchard signal harbor velvet ledger meadow quartz ember timber anchor prism".split(
      " ",
    );
  let seed = 7;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed;
  };
  let out = "";
  let n = 1;
  while (out.length < FILLER_CHARS) {
    const a = words[next() % words.length];
    const b = words[next() % words.length];
    out += `Entry ${n++}: the ${a} near the ${b} recorded value ${next() % 9973}.\n`;
  }
  return out;
}

type Usage = { input: number; cacheRead: number; cacheWrite: number };
type Message = { role?: string; usage?: Usage; timestamp?: number };
type Entry = { id?: string; type?: string; message?: Message };

function transcripts(dir: string): { file: string; entries: Entry[]; text: string }[] {
  const out: { file: string; entries: Entry[]; text: string }[] = [];
  const walk = (d: string): void => {
    for (const e of existsSync(d) ? readdirSync(d, { withFileTypes: true }) : []) {
      const path = join(d, e.name);
      if (e.isDirectory()) walk(path);
      else if (e.name.endsWith(".jsonl")) {
        const text = readFileSync(path, "utf8");
        const entries = text
          .split("\n")
          .filter((l) => l.trim() !== "")
          .map((l) => JSON.parse(l) as Entry);
        out.push({ file: path, entries, text });
      }
    }
  };
  walk(dir);
  return out;
}

const total = (u: Usage): number => u.input + u.cacheRead + u.cacheWrite;
const assistants = (entries: Entry[]): Message[] =>
  entries.flatMap((e) =>
    e.type === "message" && e.message?.role === "assistant" ? [e.message] : [],
  );

function install(source: string, dirs: { agentDir: string; home: string; cwd: string }): void {
  const r = Bun.spawnSync([PI_BIN, "install", source], {
    cwd: dirs.cwd,
    env: isolatedEnv(dirs.agentDir, dirs.home, { PI_OFFLINE: "1" }),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (r.exitCode !== 0) throw new Error(`install failed: ${source}`);
}

type Captured = { body: string; headers: Record<string, string> };

/** A pass-through proxy that records every request, so the parent's last one can be replayed. */
function recordingProxy(upstream: string): {
  url: string;
  requests: Captured[];
  stop(): void;
} {
  const requests: Captured[] = [];
  const base = upstream.replace(/\/$/, "");
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const body = await req.text();
      const headers: Record<string, string> = {};
      req.headers.forEach((v, k) => {
        if (k !== "host" && k !== "content-length") headers[k] = v;
      });
      requests.push({ body, headers });
      const path = new URL(req.url).pathname.replace(/^\/v1/, "");
      return fetch(`${base}${path}`, { method: req.method, headers, body });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}/v1`,
    requests,
    stop: () => void server.stop(true),
  };
}

type Floor = { p: number | undefined; cacheRead: number | undefined };

/** Sends a captured request again, unchanged, and reads usage from its (SSE or JSON) response. */
async function resend(upstream: string, req: Captured): Promise<Floor> {
  const res = await fetch(`${upstream.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: req.headers,
    body: req.body,
  });
  const text = await res.text();
  let usage: {
    prompt_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  } = {};
  for (const line of text.split("\n")) {
    const data = line.startsWith("data:") ? line.slice(5).trim() : undefined;
    if (data === undefined || data === "" || data === "[DONE]") continue;
    try {
      const u = JSON.parse(data).usage;
      if (u) usage = u;
    } catch {
      // not a JSON chunk
    }
  }
  return {
    p: usage.prompt_tokens,
    cacheRead: usage.prompt_tokens_details?.cached_tokens,
  };
}

const floors: Floor[] = [];

type Session = {
  agentDir: string;
  cwd: string;
  rpc: Rpc;
  reportPath: string;
};

function installAll(target: Target, dirs: { agentDir: string; home: string; cwd: string }): void {
  if (target.extension !== undefined) install(target.extension, dirs);
  // The executor's production entry point and this script's own extension; nothing from tests/.
  install(realpathSync(join(REPO_ROOT, "node_modules", "@ttdua", "pi-subagents")), dirs);
  install(join(import.meta.dir, "fork-cache-evidence-ext"), dirs);
}

/** A real Pi session on `target`, with the executor and the evidence extension installed. */
async function openSession(target: Target, spawnModel: string | undefined): Promise<Session> {
  const agentDir = tempDir("fork-evidence-agent-");
  const cwd = tempDir("fork-evidence-cwd-");
  const reportPath = join(agentDir, "evidence-report.jsonl");
  let rpc: Rpc | undefined;
  try {
    const home = target.home ?? join(agentDir, "home");
    mkdirSync(home, { recursive: true });
    if (target.modelsJson !== undefined)
      writeFileSync(join(agentDir, "models.json"), JSON.stringify(target.modelsJson));
    installAll(target, { agentDir, home, cwd });
    writeFileSync(reportPath, "");
    rpc = spawnRpc({
      agentDir,
      home,
      cwd,
      args: ["--provider", target.provider, "--model", target.model, "--thinking", "off"],
      env: {
        PI_OFFLINE: "1",
        FORK_EVIDENCE_REPORT: reportPath,
        ...(spawnModel === undefined ? {} : { FORK_EVIDENCE_SPAWN_MODEL: spawnModel }),
        ...target.env,
      },
    });
    const session = { agentDir, cwd, rpc, reportPath };
    await rpc.waitFor(() => events(session, "session_start").length >= 1, "session_start");
    return session;
  } catch (error) {
    await closeSession({ agentDir, cwd, rpc });
    throw error;
  }
}

type ReportEvent = { event: string; t: number; agentId?: string; sessionId?: string };

function events(s: { reportPath: string }, name: string): ReportEvent[] {
  return readFileSync(s.reportPath, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as ReportEvent)
    .filter((e) => e.event === name);
}

async function closeSession(s: {
  agentDir: string;
  cwd: string;
  rpc: Rpc | undefined;
}): Promise<void> {
  await s.rpc?.close().catch(() => undefined);
  rmSync(s.agentDir, { recursive: true, force: true });
  rmSync(s.cwd, { recursive: true, force: true });
}

/** Why a run does not count toward the bound, or undefined when it does. */
function exclusion(
  parentTokens: number,
  elapsedS: number | undefined,
  override: boolean,
  unbounded: boolean,
): string | undefined {
  if (parentTokens < MIN_PARENT_TOKENS) return `excluded: P < ${MIN_PARENT_TOKENS}`;
  if (elapsedS === undefined)
    return unbounded
      ? "recorded, no bound (other route; no request hook, elapsed not observable)"
      : "excluded: no parent request time";
  if (elapsedS > MAX_ELAPSED_S) return `excluded: elapsed > ${MAX_ELAPSED_S}s`;
  if (unbounded) return "recorded, no bound (other route)";
  return override ? "recorded, no bound (model override)" : undefined;
}

type ParentFacts = { tokens: number; elapsedS: number | undefined };
type Shape = {
  base: Pick<Row, "provider" | "kind">;
  forks: number;
  override: boolean;
  unbounded: boolean;
};

function emptyRow(base: Shape["base"], verdict: string): Row {
  return {
    ...base,
    parentTokens: undefined,
    cacheRead: undefined,
    ratio: undefined,
    elapsedS: undefined,
    verdict,
  };
}

function forkRow(shape: Shape, t: { entries: Entry[] }, p: ParentFacts): Row {
  const at = t.entries.findIndex((e) => JSON.stringify(e).includes("<subagent_instructions>"));
  const cacheRead = assistants(t.entries.slice(at))[0]?.usage?.cacheRead;
  const ratio = cacheRead === undefined ? undefined : cacheRead / p.tokens;
  const excluded = exclusion(p.tokens, p.elapsedS, shape.override, shape.unbounded);
  const pass = ratio !== undefined && ratio >= BOUND;
  const verdict = excluded ?? (pass ? "included: PASS" : "included: FAIL");
  return {
    ...shape.base,
    parentTokens: p.tokens,
    cacheRead,
    ratio,
    elapsedS: p.elapsedS,
    verdict,
  };
}

/** Seconds from the parent's last request before `launchAt` to `launchAt`; undefined if none. */
function elapsedBefore(s: Session, launchAt: number): number | undefined {
  const sent = events(s, "request")
    .map((e) => e.t)
    .filter((t) => t <= launchAt)
    .at(-1);
  return sent === undefined ? undefined : (launchAt - sent) / 1000;
}

/** The fork transcript whose session id the launch event for `agentId` reported. */
function forkTranscript(
  s: Session,
  all: ReturnType<typeof transcripts>,
  agentId: string | undefined,
): { entries: Entry[] } | undefined {
  const sessionId = events(s, "session").find((e) => e.agentId === agentId)?.sessionId;
  return all.find((t) => sessionId !== undefined && t.text.includes(`"id":"${sessionId}"`));
}

/** One parent turn on the filler document, then `forks` forks; one row per fork. */
async function measure(s: Session, shape: Shape): Promise<Row[]> {
  await s.rpc.prompt(
    `Below is a reference document. Read it, then reply with exactly: OK\n\n${filler()}`,
  );
  const sessions = join(s.agentDir, "sessions");
  const last = assistants(
    transcripts(sessions).find((t) => t.entries.length > 0)?.entries ?? [],
  ).at(-1);
  if (last?.usage === undefined) {
    return [emptyRow(shape.base, "excluded: parent made no usage-bearing request")];
  }
  const tokens = total(last.usage);
  for (let i = 0; i < shape.forks; i++) {
    s.rpc.send(`/evidence-spawn general-purpose CHILD-TASK reply OK ${i}`);
  }
  await s.rpc.waitFor(() => events(s, "completed").length >= shape.forks, "fork completion");
  const all = transcripts(sessions);
  return events(s, "launch")
    .slice(0, shape.forks)
    .map((launch) => {
      const t = forkTranscript(s, all, launch.agentId);
      const facts = { tokens, elapsedS: elapsedBefore(s, launch.t) };
      return t === undefined
        ? emptyRow(shape.base, "excluded: fork transcript not found")
        : forkRow(shape, t, facts);
    });
}

/** The target with its upstream base URL replaced by the recording proxy's. */
function viaProxy(target: Target, upstream: string, proxyUrl: string): Target {
  const json = JSON.stringify(target.modelsJson).replace(
    JSON.stringify(upstream),
    JSON.stringify(proxyUrl),
  );
  return { ...target, modelsJson: JSON.parse(json) };
}

function wantsFloor(target: Target, kind: Kind, upstream: string | undefined): boolean {
  return target.floor === true && upstream !== undefined && kind === "one fork";
}

function skipReason(target: Target, shape: Shape): string | undefined {
  if (target.key === undefined) return "not run: no credentials";
  if (shape.override && target.override === undefined) return "not run: no override model";
  return undefined;
}

async function run(target: Target, kind: Kind): Promise<Row[]> {
  const shape: Shape = {
    base: { provider: target.label, kind },
    forks: kind === "parallel forks" ? 2 : 1,
    override: kind === "model override",
    unbounded: target.unbounded === true,
  };
  const skipped = skipReason(target, shape);
  if (skipped !== undefined) return [emptyRow(shape.base, skipped)];
  const upstream = process.env.FORK_EVIDENCE_OPENAI_BASE_URL;
  const proxy = wantsFloor(target, kind, upstream) ? recordingProxy(upstream ?? "") : undefined;
  try {
    const effective =
      proxy === undefined || upstream === undefined
        ? target
        : viaProxy(target, upstream, proxy.url);
    return await runSession(effective, shape, proxy, upstream);
  } finally {
    proxy?.stop();
  }
}

async function runSession(
  target: Target,
  shape: Shape,
  proxy: { requests: Captured[] } | undefined,
  upstream: string | undefined,
): Promise<Row[]> {
  const session = await openSession(target, shape.override ? target.override : undefined);
  try {
    const rows = await measure(session, shape);
    const parentRequest = proxy?.requests.find((r) =>
      r.body.includes("Below is a reference document"),
    );
    if (parentRequest !== undefined && upstream !== undefined)
      floors.push(await resend(upstream, parentRequest));
    return rows;
  } finally {
    await closeSession(session);
  }
}

function render(rows: Row[]): string {
  const cell = (n: number | undefined, digits = 0): string =>
    n === undefined ? "-" : n.toFixed(digits);
  const lines = [
    "| provider | kind | P | cacheRead | ratio | elapsed s | result |",
    "| --- | --- | ---: | ---: | ---: | ---: | --- |",
    ...rows.map(
      (r) =>
        `| ${r.provider} | ${r.kind} | ${cell(r.parentTokens)} | ${cell(r.cacheRead)} | ${cell(r.ratio, 3)} | ${cell(r.elapsedS, 1)} | ${r.verdict} |`,
    ),
  ];
  return lines.join("\n");
}

async function runGuarded(target: Target, kind: Kind): Promise<Row[]> {
  try {
    return await run(target, kind);
  } catch (e) {
    if (!target.unbounded) throw e;
    const why = e instanceof Error ? e.message.slice(0, 120) : "failed";
    return [emptyRow({ provider: target.label, kind }, `not run: ${why}`)];
  }
}

function printFloors(): void {
  for (const f of floors) {
    const gap = f.p === undefined || f.cacheRead === undefined ? "-" : f.p - f.cacheRead;
    console.log(
      `cache floor (parent's last request sent again unchanged): P=${f.p ?? "-"} cacheRead=${f.cacheRead ?? "-"} P-cacheRead=${gap}`,
    );
  }
}

async function main(): Promise<void> {
  const openai = arg("openai");
  const route = arg("anthropic-route");
  if (openai === undefined) {
    console.error(
      "usage: bun scripts/fork-cache-evidence.ts --openai <provider/id> [--anthropic-route <provider/id>]",
    );
    process.exit(2);
  }
  const rows: Row[] = [];
  const targets = [
    openaiTarget(openai),
    ...(route === undefined ? [] : [anthropicRouteTarget(route)]),
  ];
  for (const target of targets) {
    const kinds: Kind[] = target.unbounded
      ? ["route (no bound)"]
      : ["one fork", "parallel forks", "model override"];
    for (const kind of kinds) rows.push(...(await runGuarded(target, kind)));
  }
  console.log(render(rows));
  printFloors();
  if (rows.some((r) => r.verdict === "included: FAIL")) {
    console.error(`bound ${BOUND} failed for at least one included same-model row`);
    process.exit(1);
  }
}

await main();
