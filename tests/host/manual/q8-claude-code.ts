/**
 * WG-02 Q8 manual script: prompt-cache behaviour of pi-claude-code across a thinking-level change.
 *
 * Operator run (uses the real Claude subscription login, needs network; never part of `bun test`):
 *   bun tests/host/manual/q8-claude-code.ts
 * `--preflight-only` runs just the login check (no install, no model call).
 *
 * The real HOME is used so `claude` finds its login; `claude` may therefore write under ~/.claude.
 * Pi's own state stays in a temp agent dir. The reported `level` is read back from Pi (`get_state`).
 *
 * Prints one `turn=...` line per prompt and a final versions line. No prompt or response text,
 * and no account details, are printed.
 */
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PI_BIN, REPO_ROOT, tempDir } from "../../helpers";
import { isolatedEnv, spawnRpc, type RpcEvent } from "../rpc";

const PI_CLAUDE_CODE_SOURCE = "git:github.com/earendil-works/pi-claude-code@47f9e2b";
const PI_CLAUDE_CODE_COMMIT = "47f9e2b";
const PROVIDER = "claude-code";
const MODEL = "claude-haiku-5-5";
const PROMPTS = [
  "Reply with the word one.",
  "Reply with the word two.",
  "Reply with the word three.",
];
const TURN_TIMEOUT_MS = 180_000;

type Usage = { input: number; cacheRead: number; cacheWrite: number };

/**
 * pi-claude-code shells out to the operator's `claude` CLI, which finds its login through the
 * real HOME (credentials / config under ~) and `claude` on PATH (PATH is already in the base
 * allow-list). The throwaway HOME that isolatedEnv would give the child would hide the login, so
 * the real HOME is passed through spawnRpc's `env`. Pi's own state stays isolated because
 * PI_CODING_AGENT_DIR still points at the temp agent dir. The extension's documented overrides
 * (PI_CLAUDE_CODE_COMMAND, PI_CLAUDE_CODE_CONFIG_DIR, CLAUDE_CONFIG_DIR) are forwarded only if
 * the operator set them. ANTHROPIC_API_KEY and other credentials are deliberately not forwarded.
 */
function loginEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of [
    "HOME",
    // The claude CLI on macOS looks its login up in the user keychain, which needs USER
    // (and LOGNAME where set); without them `claude auth status` reports loggedIn=false.
    "USER",
    "LOGNAME",
    "PI_CLAUDE_CODE_COMMAND",
    "PI_CLAUDE_CODE_CONFIG_DIR",
    "CLAUDE_CONFIG_DIR",
  ]) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/**
 * Fail fast when the claude login is not visible with the exact env the RPC child gets.
 * pi-claude-code decides the provider is configured from `claude auth status`. The status
 * payload contains the account email, so it is parsed and never printed.
 */
function claudeLoggedIn(childEnv: Record<string, string>, cwd: string): boolean {
  const result = Bun.spawnSync([childEnv.PI_CLAUDE_CODE_COMMAND ?? "claude", "auth", "status"], {
    cwd,
    env: childEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    const parsed = JSON.parse(result.stdout.toString()) as { loggedIn?: unknown };
    return parsed.loggedIn === true;
  } catch {
    return false;
  }
}

function packageVersion(name: string): string {
  const file = join(REPO_ROOT, "node_modules", name, "package.json");
  return (JSON.parse(readFileSync(file, "utf8")) as { version: string }).version;
}

function num(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function usageOf(message: unknown): Usage | undefined {
  const usage = (message as { usage?: Record<string, unknown> } | undefined)?.usage;
  if (usage === undefined || typeof usage !== "object") return undefined;
  return {
    input: num(usage.input),
    cacheRead: num(usage.cacheRead),
    cacheWrite: num(usage.cacheWrite),
  };
}

/** Thinking-related event type names seen in a turn's events, in first-seen order. */
function thinkingEventNames(events: RpcEvent[]): string[] {
  const names: string[] = [];
  const add = (name: unknown): void => {
    if (typeof name === "string" && name.includes("thinking") && !names.includes(name))
      names.push(name);
  };
  for (const event of events) {
    add(event.type);
    if (event.type === "message_update") {
      add((event.assistantMessageEvent as { type?: unknown } | undefined)?.type);
    }
  }
  return names;
}

/** Usage of the last assistant `message_end` in a turn (authoritative final message). */
function finalAssistantUsage(events: RpcEvent[]): Usage | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.type !== "message_end") continue;
    const message = event.message as { role?: string } | undefined;
    if (message?.role === "assistant") return usageOf(message);
  }
  return undefined;
}

async function main(): Promise<void> {
  const root = tempDir("jev-q8-");
  let activeRpc: ReturnType<typeof spawnRpc> | undefined;
  const onSignal = (signal: NodeJS.Signals): void => {
    // The Pi child is detached (own process group), so Ctrl-C does not reach it; kill the group.
    if (activeRpc !== undefined) {
      try {
        process.kill(-activeRpc.pid, "SIGKILL");
      } catch {
        // ESRCH: already gone
      }
    }
    rmSync(root, { recursive: true, force: true });
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    const agentDir = join(root, "agent");
    const cwd = join(root, "cwd");
    Bun.spawnSync(["mkdir", "-p", agentDir, cwd]);

    const env = loginEnv();
    const installEnv = isolatedEnv(agentDir, env.HOME ?? root, env);
    if (!claudeLoggedIn(installEnv, cwd)) {
      console.error('claude-login-missing: run "claude auth login"');
      rmSync(root, { recursive: true, force: true });
      process.exit(1);
    }
    if (process.argv.includes("--preflight-only")) {
      console.log("preflight=logged-in");
      return;
    }
    // Exact env (no process.env spread), identical to the RPC child's.
    const install = Bun.spawnSync([PI_BIN, "install", PI_CLAUDE_CODE_SOURCE], {
      cwd,
      env: installEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (install.exitCode !== 0) {
      throw new Error(
        `pi install failed (exit ${install.exitCode}): ${install.stderr.toString().slice(-500)}`,
      );
    }

    const rpc = spawnRpc({
      agentDir,
      home: env.HOME ?? root,
      cwd,
      args: ["--provider", PROVIDER, "--model", MODEL, "--thinking", "low"],
      env,
      timeoutMs: TURN_TIMEOUT_MS,
    });
    activeRpc = rpc;
    try {
      const stats = async (): Promise<Usage> => {
        const response = await rpc.send({ type: "get_session_stats" });
        const tokens = (response.data?.tokens ?? {}) as Record<string, unknown>;
        return {
          input: num(tokens.input),
          cacheRead: num(tokens.cacheRead),
          cacheWrite: num(tokens.cacheWrite),
        };
      };

      const effectiveLevel = async (requested: string): Promise<string> => {
        const response = await rpc.send({ type: "get_state" });
        const raw = (response.data as { thinkingLevel?: unknown } | undefined)?.thinkingLevel;
        const effective = typeof raw === "string" ? raw : "unknown";
        if (effective !== requested) {
          console.log(`level-mismatch requested=${requested} effective=${effective}`);
        }
        return effective;
      };

      let turn = 0;
      let level = await effectiveLevel("low");
      const runTurn = async (text: string): Promise<void> => {
        turn += 1;
        const startIndex = rpc.events.length;
        const before = await stats();
        await rpc.prompt(text);
        const turnEvents = rpc.events.slice(startIndex);
        // Primary source: usage on the final assistant message_end. Fallback: session-stats delta.
        let usage = finalAssistantUsage(turnEvents);
        if (usage === undefined) {
          const after = await stats();
          usage = {
            input: after.input - before.input,
            cacheRead: after.cacheRead - before.cacheRead,
            cacheWrite: after.cacheWrite - before.cacheWrite,
          };
        }
        const names = thinkingEventNames(turnEvents);
        console.log(
          `turn=${turn} level=${level} events=${names.length > 0 ? names.join(",") : "none"} ` +
            `cacheRead=${usage.cacheRead} cacheWrite=${usage.cacheWrite} input=${usage.input}`,
        );
      };

      for (const text of PROMPTS) await runTurn(text);

      const changed = await rpc.send({ type: "set_thinking_level", level: "high" });
      if (!changed.success) throw new Error(`set_thinking_level rejected: ${changed.error ?? ""}`);
      level = await effectiveLevel("high");

      for (const text of PROMPTS) await runTurn(text);
    } finally {
      await rpc.close();
    }

    console.log(
      `date=${new Date().toISOString()} pi=${packageVersion("@earendil-works/pi-coding-agent")} ` +
        `executor=${packageVersion("@gotgenes/pi-subagents")} pi-claude-code=${PI_CLAUDE_CODE_COMMIT} ` +
        `model=${PROVIDER}/${MODEL}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
