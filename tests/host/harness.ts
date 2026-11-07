import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PI_BIN, REPO_ROOT, tempDir } from "../helpers";
import { fixtureModelsJson, type Fixture } from "./fixture";
import { isolatedEnv, spawnRpc, type RpcProcess } from "./rpc";

export type ProbeRecord = {
  probe: string;
  event: string;
  seq: number;
  t: number;
  sessionId?: string;
  data?: Record<string, string | number | boolean>;
};

export type HostSession = RpcProcess & {
  agentDir: string;
  cwd: string;
  installPath: "node_modules" | "tarball" | null;
  probeRecords(): ProbeRecord[];
};

/** Throws if a probe report holds a test marker: probes must record counts and ids only. */
export function assertProbeReportClean(reportPath: string): void {
  if (!existsSync(reportPath)) return;
  if (readFileSync(reportPath, "utf8").includes("JEV-MARKER-")) {
    throw new Error("probe report holds a JEV-MARKER- string");
  }
}

const EXECUTOR_DIR = join(REPO_ROOT, "node_modules", "@gotgenes", "pi-subagents");

type Dirs = { agentDir: string; home: string; cwd: string };

const SPAWN_TIMEOUT_MS = 60_000;

/** Bun.spawnSync with a hard timeout; a timeout throws an error naming the command. */
function runSync(
  cmd: string[],
  opts: { cwd: string; env?: Record<string, string> },
): Bun.SyncSubprocess<"pipe", "pipe"> {
  const r = Bun.spawnSync(cmd, {
    ...opts,
    stdout: "pipe",
    stderr: "pipe",
    timeout: SPAWN_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  if (r.exitedDueToTimeout) {
    throw new Error(`command timed out after ${SPAWN_TIMEOUT_MS} ms: ${cmd.join(" ")}`);
  }
  return r;
}

function install(source: string, dirs: Dirs): { code: number; out: string } {
  const r = runSync([PI_BIN, "install", source], {
    cwd: dirs.cwd,
    env: isolatedEnv(dirs.agentDir, dirs.home, { PI_OFFLINE: "1" }),
  });
  return { code: r.exitCode ?? -1, out: `${r.stdout.toString()}${r.stderr.toString()}` };
}

/** True when the agent directory's settings.json lists a package whose resolved path matches. */
function isInstalled(dirs: Dirs, match: (resolved: string) => boolean): boolean {
  const file = join(dirs.agentDir, "settings.json");
  if (!existsSync(file)) return false;
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { packages?: unknown };
  const list = Array.isArray(parsed.packages) ? parsed.packages : [];
  return list.some((p) => typeof p === "string" && match(resolve(dirs.agentDir, p)));
}

function installExecutor(dirs: Dirs): "node_modules" | "tarball" {
  const primary = install(EXECUTOR_DIR, dirs);
  if (primary.code === 0) return "node_modules";
  const packDir = tempDir("jev-pack-");
  try {
    const packed = runSync(["bun", "pm", "pack", "--destination", packDir], {
      cwd: EXECUTOR_DIR,
    });
    if (packed.exitCode !== 0) throw new Error(`bun pm pack failed: ${packed.stderr.toString()}`);
    const tarball = readdirSync(packDir).find((f) => f.endsWith(".tgz"));
    if (!tarball) throw new Error("bun pm pack produced no tarball");
    const fallback = install(join(packDir, tarball), dirs);
    if (fallback.code !== 0) {
      throw new Error(`executor install failed (${primary.out} / ${fallback.out})`);
    }
    return "tarball";
  } finally {
    rmSync(packDir, { recursive: true, force: true });
  }
}

type Prepared = {
  dirs: Dirs;
  installPath: HostSession["installPath"];
  /** Removes the directories this call created; given directories are left to the caller. */
  cleanDirs: () => void;
};

type PrepareOpts = {
  fixture: Fixture;
  probes?: string[];
  executor?: boolean;
  agents?: Record<string, string>;
  /** Install this checkout (`pi install REPO_ROOT`) into the agent directory. */
  self?: boolean;
  /** Reuse an agent directory (left for the caller to remove); packages already listed in its settings.json are not installed again. */
  agentDir?: string;
  /** Reuse a working directory. */
  cwd?: string;
  /** Classifier endpoint written to jev/config.json; defaults to a refused loopback port. */
  jevConfig?: { url: string; timeoutMs: number; holdProviders?: string[] };
};

const DEFAULT_JEV_CONFIG = { url: "http://127.0.0.1:9/v1/systemone", timeoutMs: 300 };

/** Writes jev/config.json so no host test reaches beyond loopback; an existing file is kept. */
function writeJevConfig(agentDir: string, jevConfig: PrepareOpts["jevConfig"]): void {
  const file = join(agentDir, "jev", "config.json");
  if (existsSync(file)) return;
  const { url, timeoutMs, holdProviders } = { ...DEFAULT_JEV_CONFIG, ...jevConfig };
  mkdirSync(join(agentDir, "jev"), { recursive: true });
  const effort = holdProviders === undefined ? {} : { effort: { holdProviders } };
  writeFileSync(file, JSON.stringify({ classifier: { url, timeoutMs }, ...effort }));
}

/** Shared setup: temp dirs, models.json, agents and installs. */
function prepare(opts: PrepareOpts): Prepared {
  const ownAgent = opts.agentDir === undefined;
  const ownCwd = opts.cwd === undefined;
  const agentDir = opts.agentDir ?? tempDir("jev-host-agent-");
  const cwd = opts.cwd ?? tempDir("jev-host-cwd-");
  const home = join(agentDir, "home");
  const dirs: Dirs = { agentDir, home, cwd };
  const cleanDirs = (): void => {
    if (ownAgent) rmSync(agentDir, { recursive: true, force: true });
    if (ownCwd) rmSync(cwd, { recursive: true, force: true });
  };
  try {
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(agentDir, "models.json"),
      JSON.stringify(fixtureModelsJson(opts.fixture.baseUrl)),
    );
    writeJevConfig(agentDir, opts.jevConfig);
    if (opts.agents) {
      mkdirSync(join(agentDir, "agents"), { recursive: true });
      for (const [stem, text] of Object.entries(opts.agents)) {
        writeFileSync(join(agentDir, "agents", `${stem}.md`), text);
      }
    }
    let installPath: HostSession["installPath"] = null;
    if (opts.executor && !isInstalled(dirs, (p) => p.includes("pi-subagents")))
      installPath = installExecutor(dirs);
    if (opts.self && !isInstalled(dirs, (p) => p === REPO_ROOT)) {
      const r = install(REPO_ROOT, dirs);
      if (r.code !== 0) throw new Error(`package install failed: ${r.out}`);
    }
    if (ownAgent) {
      for (const probe of opts.probes ?? []) {
        const r = install(join(REPO_ROOT, "tests", "host", "probes", probe), dirs);
        if (r.code !== 0) throw new Error(`probe install failed (${probe}): ${r.out}`);
      }
    }
    return { dirs, installPath, cleanDirs };
  } catch (error) {
    cleanDirs();
    throw error;
  }
}

export async function startHostSession(
  opts: PrepareOpts & {
    persist?: boolean;
    model?: string;
    thinking?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
  },
): Promise<HostSession> {
  const { dirs, installPath, cleanDirs } = prepare(opts);
  const { agentDir, home, cwd } = dirs;
  let rpc: RpcProcess | undefined;
  try {
    const reportPath = join(agentDir, "probe-report.jsonl");
    writeFileSync(reportPath, "");
    const args = ["--provider", "fixture", "--model", opts.model ?? "fixture-main"];
    if (opts.thinking) args.push("--thinking", opts.thinking);
    if (!opts.persist) args.push("--no-session");

    const spawned = spawnRpc({
      agentDir,
      home,
      cwd,
      args,
      env: { PI_OFFLINE: "1", JEV_PROBE_REPORT: reportPath, ...opts.env },
      timeoutMs: opts.timeoutMs,
    });

    rpc = spawned;

    return {
      ...spawned,
      agentDir,
      cwd,
      installPath,
      probeRecords: () => {
        if (!existsSync(reportPath)) return [];
        return readFileSync(reportPath, "utf8")
          .split("\n")
          .filter((l) => l.trim() !== "")
          .map((l) => JSON.parse(l) as ProbeRecord);
      },
      close: async () => {
        try {
          await spawned.close();
          assertProbeReportClean(reportPath);
        } finally {
          cleanDirs();
        }
      },
    };
  } catch (error) {
    if (rpc) await rpc.close().catch(() => undefined);
    cleanDirs();
    throw error;
  }
}

const RUN_TIMEOUT_MS = 30_000;

/**
 * One non-interactive run (`pi -p` or `pi --mode json`). Directories created here are returned
 * for the caller to remove; given ones are left alone.
 */
export async function runOnce(opts: {
  fixture: Fixture;
  mode: "print" | "json";
  message: string;
  self: boolean;
  agentDir?: string;
  cwd?: string;
  env?: Record<string, string>;
  jevConfig?: { url: string; timeoutMs: number };
}): Promise<{ code: number; stdout: string; stderr: string; agentDir: string; cwd: string }> {
  const { dirs, cleanDirs } = prepare({
    fixture: opts.fixture,
    self: opts.self,
    agentDir: opts.agentDir,
    cwd: opts.cwd,
    jevConfig: opts.jevConfig,
  });
  const created = { agentDir: opts.agentDir === undefined, cwd: opts.cwd === undefined };
  const flags = opts.mode === "print" ? ["-p"] : ["--mode", "json"];
  const proc = Bun.spawn(
    [
      PI_BIN,
      ...flags,
      "--provider",
      "fixture",
      "--model",
      "fixture-main",
      "--no-session",
      opts.message,
    ],
    {
      cwd: dirs.cwd,
      env: isolatedEnv(dirs.agentDir, dirs.home, { PI_OFFLINE: "1", ...opts.env }),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: RUN_TIMEOUT_MS,
      killSignal: "SIGKILL",
    },
  );
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (proc.signalCode !== null) throw new Error(`pi timed out after ${RUN_TIMEOUT_MS} ms`);
    // The caller owns cleanup of the directories this call created (returned below).
    return { code, stdout, stderr, agentDir: dirs.agentDir, cwd: dirs.cwd };
  } catch (error) {
    // Failure path only: remove what this call created.
    if (created.agentDir || created.cwd) cleanDirs();
    throw error;
  }
}
