import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isTier, parseCodexCatalog, resolveTier, type Exec } from "../../policy/review/index.ts";
import { execOptions } from "./attempt.ts";

const CATALOG_TIMEOUT_MS = 30_000;

/** Newest slug for a tier, or the stored model when the catalog cannot answer. */
export async function resolveModel(
  exec: Exec,
  model: string | undefined,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  if (model === undefined || !isTier(model)) return model;
  try {
    const r = await exec(
      "codex",
      ["debug", "models"],
      execOptions(cwd, CATALOG_TIMEOUT_MS, signal),
    );
    if (r.code !== 0 || r.killed) return model;
    return resolveTier(model, parseCodexCatalog(r.stdout)) ?? model;
  } catch {
    // the catalog is optional: keep the stored model
    return model;
  }
}

/** A private (0700) directory for codex's last-message file. */
export function makeOutDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "jev-review-"));
  try {
    chmodSync(dir, 0o700);
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  return dir;
}
