// Manual evidence run (never part of `bun test`): measures how much of a parent's prompt a fork
// reads from the provider's cache, on real providers.
//
//   bun scripts/fork-cache-evidence.ts --anthropic <provider/id> --openai <provider/id>
//
// Keys come from the environment and are never printed:
//   ANTHROPIC_API_KEY                      the Anthropic row
//   FORK_EVIDENCE_OPENAI_API_KEY           the OpenAI-compatible row
//   FORK_EVIDENCE_OPENAI_BASE_URL          its base URL (an OpenAI-style `/v1` root)
//   FORK_EVIDENCE_ANTHROPIC_OVERRIDE       model for the override row (default: claude-haiku-4-5)
//   FORK_EVIDENCE_OPENAI_OVERRIDE          model id for the override row (required for that row)
// A provider whose key is missing is reported as "not run: no credentials".
//
// Each run starts its own real Pi session (executor-only package plus the policy probe, which
// provides `/probe-spawn`), sends one parent turn that holds a generated filler document, then
// starts the fork(s) with `/probe-spawn` and reads the first assistant message of each fork
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
import { tmpdir } from "node:os";
import { join } from "node:path";

const MIN_PARENT_TOKENS = 8000;
const MAX_ELAPSED_S = 60;
const BOUND = 0.9;
const FILLER_CHARS = 36_000;
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
  for (const key of ["PATH", "TMPDIR"]) {
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

type Kind = "one fork" | "parallel forks" | "model override";
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

function anthropicTarget(spec: string): Target {
  const { provider, model } = split(spec);
  const key = process.env.ANTHROPIC_API_KEY;
  const override = process.env.FORK_EVIDENCE_ANTHROPIC_OVERRIDE ?? "claude-haiku-4-5";
  return {
    label: "Anthropic",
    provider,
    model,
    key,
    env: key === undefined ? {} : { ANTHROPIC_API_KEY: key },
    override: `${provider}/${override}`,
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
          compat: { sendSessionAffinityHeaders: true, sessionAffinityFormat: "openai" },
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

type Session = {
  agentDir: string;
  cwd: string;
  rpc: Rpc;
  count: (event: string) => number;
};

/** A real Pi session on `target`, with the executor and the policy probe installed. */
async function openSession(target: Target, spawnModel: string | undefined): Promise<Session> {
  const agentDir = tempDir("fork-evidence-agent-");
  const cwd = tempDir("fork-evidence-cwd-");
  const home = join(agentDir, "home");
  mkdirSync(home, { recursive: true });
  if (target.modelsJson !== undefined)
    writeFileSync(join(agentDir, "models.json"), JSON.stringify(target.modelsJson));
  install(join(REPO_ROOT, "tests", "fixtures", "executor-only"), { agentDir, home, cwd });
  install(join(REPO_ROOT, "tests", "host", "probes", "policy"), { agentDir, home, cwd });
  const reportPath = join(agentDir, "probe-report.jsonl");
  writeFileSync(reportPath, "");
  writeFileSync(join(agentDir, "policy.json"), "{}");
  const rpc = spawnRpc({
    agentDir,
    home,
    cwd,
    args: ["--provider", target.provider, "--model", target.model, "--thinking", "off"],
    env: {
      PI_OFFLINE: "1",
      JEV_PROBE_REPORT: reportPath,
      JEV_POLICY_FILE: join(agentDir, "policy.json"),
      JEV_SPAWN_CONTEXT: "fork",
      ...(spawnModel === undefined ? {} : { JEV_SPAWN_MODEL: spawnModel }),
      ...target.env,
    },
  });
  const count = (event: string): number =>
    readFileSync(reportPath, "utf8")
      .split("\n")
      .filter((l) => l.includes(`"event":"${event}"`)).length;
  await rpc.waitFor(() => count("session_start") >= 1, "session_start");
  return { agentDir, cwd, rpc, count };
}

async function closeSession(s: Session): Promise<void> {
  await s.rpc.close().catch(() => undefined);
  rmSync(s.agentDir, { recursive: true, force: true });
  rmSync(s.cwd, { recursive: true, force: true });
}

/** Why a run does not count toward the bound, or undefined when it does. */
function exclusion(parentTokens: number, elapsedS: number, override: boolean): string | undefined {
  if (parentTokens < MIN_PARENT_TOKENS) return `excluded: P < ${MIN_PARENT_TOKENS}`;
  if (elapsedS > MAX_ELAPSED_S) return `excluded: elapsed > ${MAX_ELAPSED_S}s`;
  return override ? "recorded, no bound (model override)" : undefined;
}

function forkRow(
  base: Pick<Row, "provider" | "kind">,
  t: { entries: Entry[] },
  p: ParentFacts,
  override: boolean,
): Row {
  const at = t.entries.findIndex((e) => JSON.stringify(e).includes("<subagent_instructions>"));
  const cacheRead = assistants(t.entries.slice(at))[0]?.usage?.cacheRead;
  const ratio = cacheRead === undefined ? undefined : cacheRead / p.tokens;
  const excluded = exclusion(p.tokens, p.elapsedS, override);
  const pass = ratio !== undefined && ratio >= BOUND;
  const verdict = excluded ?? (pass ? "included: PASS" : "included: FAIL");
  return { ...base, parentTokens: p.tokens, cacheRead, ratio, elapsedS: p.elapsedS, verdict };
}

type ParentFacts = { tokens: number; elapsedS: number };

/** One parent turn on the filler document, then `forks` forks; one row per fork. */
async function measure(
  s: Session,
  base: Pick<Row, "provider" | "kind">,
  forks: number,
  override: boolean,
): Promise<Row[]> {
  await s.rpc.prompt(
    `Below is a reference document. Read it, then reply with exactly: OK\n\n${filler()}`,
  );
  const sessions = join(s.agentDir, "sessions");
  const parent = transcripts(sessions).find((t) => t.entries.length > 0);
  const last = assistants(parent?.entries ?? []).at(-1);
  if (last?.usage === undefined || last.timestamp === undefined) {
    return [
      {
        ...base,
        parentTokens: undefined,
        cacheRead: undefined,
        ratio: undefined,
        elapsedS: undefined,
        verdict: "excluded: parent made no usage-bearing request",
      },
    ];
  }
  const startedAt = Date.now();
  for (let i = 0; i < forks; i++) {
    s.rpc.send(`/probe-spawn general-purpose CHILD-TASK reply OK ${i}`);
  }
  await s.rpc.waitFor(() => s.count("record:facts") >= forks, "fork completion");
  const facts = { tokens: total(last.usage), elapsedS: (startedAt - last.timestamp) / 1000 };
  return transcripts(sessions)
    .filter((t) => t.file !== parent?.file && t.text.includes("<subagent_instructions>"))
    .slice(0, forks)
    .map((t) => forkRow(base, t, facts, override));
}

async function run(target: Target, kind: Kind): Promise<Row[]> {
  const base = { provider: target.label, kind };
  const override = kind === "model override";
  const skip = (verdict: string): Row[] => [
    {
      ...base,
      parentTokens: undefined,
      cacheRead: undefined,
      ratio: undefined,
      elapsedS: undefined,
      verdict,
    },
  ];
  if (target.key === undefined) return skip("not run: no credentials");
  if (override && target.override === undefined) return skip("not run: no override model");
  const session = await openSession(target, override ? target.override : undefined);
  try {
    return await measure(session, base, kind === "parallel forks" ? 2 : 1, override);
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

async function main(): Promise<void> {
  const anthropic = arg("anthropic");
  const openai = arg("openai");
  if (anthropic === undefined || openai === undefined) {
    console.error(
      "usage: bun scripts/fork-cache-evidence.ts --anthropic <provider/id> --openai <provider/id>",
    );
    process.exit(2);
  }
  const rows: Row[] = [];
  for (const target of [anthropicTarget(anthropic), openaiTarget(openai)]) {
    for (const kind of ["one fork", "parallel forks", "model override"] as const) {
      rows.push(...(await run(target, kind)));
    }
  }
  console.log(render(rows));
  const failed = rows.some((r) => r.verdict === "included: FAIL");
  if (failed) {
    console.error(`bound ${BOUND} failed for at least one included same-model row`);
    process.exit(1);
  }
}

await main();
