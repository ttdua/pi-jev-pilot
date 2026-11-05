import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PI_BIN, REPO_ROOT, run, tempDir } from "../helpers";
import { fixtureModelsJson, type Fixture } from "./fixture";
import { spawnRpc, type RpcProcess } from "./rpc";

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

const EXECUTOR_DIR = join(REPO_ROOT, "node_modules", "@gotgenes", "pi-subagents");

function install(source: string, agentDir: string, cwd: string): { code: number; out: string } {
  const r = run([PI_BIN, "install", source], {
    cwd,
    env: { PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" },
  });
  return { code: r.code, out: `${r.stdout}${r.stderr}` };
}

function installExecutor(agentDir: string, cwd: string): "node_modules" | "tarball" {
  const primary = install(EXECUTOR_DIR, agentDir, cwd);
  if (primary.code === 0) return "node_modules";
  const packDir = tempDir("jev-pack-");
  try {
    const packed = run(["bun", "pm", "pack", "--destination", packDir], { cwd: EXECUTOR_DIR });
    if (packed.code !== 0) throw new Error(`bun pm pack failed: ${packed.stderr}`);
    const tarball = Bun.spawnSync(["ls", packDir]).stdout.toString().trim().split("\n")[0];
    const fallback = install(join(packDir, tarball ?? ""), agentDir, cwd);
    if (fallback.code !== 0) {
      throw new Error(`executor install failed (${primary.out} / ${fallback.out})`);
    }
    return "tarball";
  } finally {
    rmSync(packDir, { recursive: true, force: true });
  }
}

export async function startHostSession(opts: {
  fixture: Fixture;
  probes?: string[];
  executor?: boolean;
  agents?: Record<string, string>;
  persist?: boolean;
  model?: string;
  thinking?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}): Promise<HostSession> {
  const agentDir = tempDir("jev-host-agent-");
  const cwd = tempDir("jev-host-cwd-");
  const cleanDirs = (): void => {
    rmSync(agentDir, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  };
  try {
    writeFileSync(
      join(agentDir, "models.json"),
      JSON.stringify(fixtureModelsJson(opts.fixture.baseUrl)),
    );
    if (opts.agents) {
      mkdirSync(join(agentDir, "agents"), { recursive: true });
      for (const [stem, text] of Object.entries(opts.agents)) {
        writeFileSync(join(agentDir, "agents", `${stem}.md`), text);
      }
    }
    let installPath: HostSession["installPath"] = null;
    if (opts.executor) installPath = installExecutor(agentDir, cwd);
    for (const probe of opts.probes ?? []) {
      const r = install(join(REPO_ROOT, "tests", "host", "probes", probe), agentDir, cwd);
      if (r.code !== 0) throw new Error(`probe install failed (${probe}): ${r.out}`);
    }

    const reportPath = join(agentDir, "probe-report.jsonl");
    writeFileSync(reportPath, "");
    const args = ["--provider", "fixture", "--model", opts.model ?? "fixture-main"];
    if (opts.thinking) args.push("--thinking", opts.thinking);
    if (!opts.persist) args.push("--no-session");

    const rpc = spawnRpc({
      agentDir,
      cwd,
      args,
      env: { PI_OFFLINE: "1", JEV_PROBE_REPORT: reportPath, ...opts.env },
      timeoutMs: opts.timeoutMs,
    });

    return {
      ...rpc,
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
          await rpc.close();
        } finally {
          cleanDirs();
        }
      },
    };
  } catch (error) {
    cleanDirs();
    throw error;
  }
}
