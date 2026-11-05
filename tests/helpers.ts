import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const REPO_ROOT: string = join(import.meta.dir, "..");
export const PI_BIN: string = join(REPO_ROOT, "node_modules", ".bin", "pi");
export const OXLINT_BIN: string = join(REPO_ROOT, "node_modules", ".bin", "oxlint");
export const OXFMT_BIN: string = join(REPO_ROOT, "node_modules", ".bin", "oxfmt");

export function tempDir(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

export function run(
  cmd: string[],
  opts: { cwd: string; env?: Record<string, string> },
): { code: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(cmd, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
  });
  return {
    code: result.exitCode ?? -1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}
