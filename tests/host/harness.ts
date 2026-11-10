import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  probeRecords(): ProbeRecord[];
};

/** Throws if a probe report holds a test marker: probes must record counts and ids only. */
export function assertProbeReportClean(reportPath: string): void {
  if (!existsSync(reportPath)) return;
  if (readFileSync(reportPath, "utf8").includes("JEV-MARKER-")) {
    throw new Error("probe report holds a JEV-MARKER- string");
  }
}

const EXECUTOR_ONLY_DIR = join(REPO_ROOT, "tests", "fixtures", "executor-only");
const JEV_ONLY_DIR = join(REPO_ROOT, "tests", "fixtures", "jev-only");

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

type Prepared = {
  dirs: Dirs;
  /** Removes the directories this call created; given directories are left to the caller. */
  cleanDirs: () => void;
};

/** `jev-only` installs jev-pilot alone, to layer it over an already installed executor or to test its absence. */
export type InstallMode = "checkout" | "executor-only" | "jev-only";

const INSTALL_SOURCES: Record<InstallMode, string> = {
  checkout: REPO_ROOT,
  "executor-only": EXECUTOR_ONLY_DIR,
  "jev-only": JEV_ONLY_DIR,
};

type PrepareOpts = {
  fixture: Fixture;
  probes?: string[];
  /** Needs the vendored executor; installs the checkout when `self` is set, else the executor-only fixture. */
  executor?: boolean;
  /** Which package to install: the whole checkout (executor and jev-pilot) or only the vendored executor. */
  install?: InstallMode;
  /** Adds provider `fixture2` (no credentials) to models.json. */
  keyless?: boolean;
  agents?: Record<string, string>;
  /** Install this checkout (`pi install REPO_ROOT`) into the agent directory; same as `install: "checkout"`. */
  self?: boolean;
  /** Reuse an agent directory (left for the caller to remove); packages already listed in its settings.json are not installed again. */
  agentDir?: string;
  /** Reuse a working directory. */
  cwd?: string;
  /** Classifier endpoint written to jev/config.json; defaults to a refused loopback port. */
  jevConfig?: {
    url: string;
    timeoutMs: number;
    holdProviders?: string[];
    /** Written as `skills.inject` in config.json. */
    skillsInject?: "content" | "suggest";
    /** Written as `review.enabled` in config.json. */
    reviewEnabled?: boolean;
  };
  /** Skills written to `<agentDir>/skills/<name>/SKILL.md`: name to the full file text (frontmatter included). */
  skills?: Record<string, string>;
};

export const DEFAULT_JEV_CONFIG = { url: "http://127.0.0.1:9/v1/systemone", timeoutMs: 300 };

/** Writes jev/config.json so no host test reaches beyond loopback; an existing file is kept. */
function writeJevConfig(agentDir: string, jevConfig: PrepareOpts["jevConfig"]): void {
  const file = join(agentDir, "jev", "config.json");
  if (existsSync(file)) return;
  const { url, timeoutMs, holdProviders, skillsInject, reviewEnabled } = {
    ...DEFAULT_JEV_CONFIG,
    ...jevConfig,
  };
  mkdirSync(join(agentDir, "jev"), { recursive: true });
  const effort = holdProviders === undefined ? {} : { effort: { holdProviders } };
  const skills = skillsInject === undefined ? {} : { skills: { inject: skillsInject } };
  const review = reviewEnabled === undefined ? {} : { review: { enabled: reviewEnabled } };
  writeFileSync(
    file,
    JSON.stringify({ classifier: { url, timeoutMs }, ...effort, ...skills, ...review }),
  );
}

/** Installs the checkout or the executor-only fixture, unless the agent directory already lists it. */
function installMode(opts: PrepareOpts, dirs: Dirs): void {
  const mode =
    opts.install ?? (opts.self ? "checkout" : opts.executor ? "executor-only" : undefined);
  if (mode === undefined) return;
  const source = INSTALL_SOURCES[mode];
  if (isInstalled(dirs, (p) => p === source)) return;
  const r = install(source, dirs);
  if (r.code !== 0) throw new Error(`package install failed: ${r.out}`);
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
      JSON.stringify(fixtureModelsJson(opts.fixture.baseUrl, { keyless: opts.keyless === true })),
    );
    writeJevConfig(agentDir, opts.jevConfig);
    for (const [name, text] of Object.entries(opts.skills ?? {})) {
      mkdirSync(join(agentDir, "skills", name), { recursive: true });
      writeFileSync(join(agentDir, "skills", name, "SKILL.md"), text);
    }
    if (opts.agents) {
      mkdirSync(join(agentDir, "agents"), { recursive: true });
      for (const [stem, text] of Object.entries(opts.agents)) {
        writeFileSync(join(agentDir, "agents", `${stem}.md`), text);
      }
    }
    installMode(opts, dirs);
    if (ownAgent) {
      for (const probe of opts.probes ?? []) {
        const r = install(join(REPO_ROOT, "tests", "host", "probes", probe), dirs);
        if (r.code !== 0) throw new Error(`probe install failed (${probe}): ${r.out}`);
      }
    }
    return { dirs, cleanDirs };
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
    /** Extra CLI arguments appended after the defaults (for example `--continue`). */
    args?: string[];
  },
): Promise<HostSession> {
  const { dirs, cleanDirs } = prepare(opts);
  const { agentDir, home, cwd } = dirs;
  let rpc: RpcProcess | undefined;
  try {
    const reportPath = join(agentDir, "probe-report.jsonl");
    writeFileSync(reportPath, "");
    const args = ["--provider", "fixture", "--model", opts.model ?? "fixture-main"];
    if (opts.thinking) args.push("--thinking", opts.thinking);
    if (!opts.persist) args.push("--no-session");
    if (opts.args) args.push(...opts.args);

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
  install?: InstallMode;
  agentDir?: string;
  cwd?: string;
  env?: Record<string, string>;
  jevConfig?: { url: string; timeoutMs: number };
}): Promise<{ code: number; stdout: string; stderr: string; agentDir: string; cwd: string }> {
  const { dirs, cleanDirs } = prepare({
    fixture: opts.fixture,
    self: opts.self,
    install: opts.install,
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
