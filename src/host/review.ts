import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildPrompt,
  classifyAttempt,
  codexArgs,
  formatFailure,
  formatSuccess,
  isTier,
  opencodeArgs,
  parseCodexCatalog,
  resolveTier,
  type Exec,
  type ExecResult,
  type ReviewChoice,
  type ReviewDetails,
} from "./review-cli.ts";

export type ReviewRun = { text: string; isError: boolean; details: ReviewDetails };

const ATTEMPT_TIMEOUT_MS = 600_000;
const CATALOG_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 8 * 1024 * 1024;

/** Newest slug for a tier, or the stored model when the catalog cannot answer. */
async function resolveModel(
  exec: Exec,
  model: string | undefined,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  if (model === undefined || !isTier(model)) return model;
  try {
    const r = await exec("codex", ["debug", "models"], {
      cwd,
      timeout: CATALOG_TIMEOUT_MS,
      ...(signal ? { signal } : {}),
      maxBuffer: MAX_BUFFER,
    });
    if (r.code !== 0 || r.killed) return model;
    return resolveTier(model, parseCodexCatalog(r.stdout)) ?? model;
  } catch {
    return model;
  }
}

function readOut(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** Runs one review. Never throws; the brief and output stay out of `details`. */
export async function runReview(
  exec: Exec,
  input: { choice: ReviewChoice; brief: string; cwd: string; signal?: AbortSignal },
): Promise<ReviewRun> {
  const { choice, brief, cwd, signal } = input;
  const cli = choice.cli;
  const base = (outcome: ReviewDetails["outcome"], attempts: 1 | 2, used: ReviewChoice) => {
    const d: ReviewDetails = { cli, attempts, outcome };
    if (used.model !== undefined) d.model = used.model;
    if (used.effort !== undefined) d.effort = used.effort;
    return d;
  };
  const failed = (
    outcome: ReviewDetails["outcome"],
    attempts: 1 | 2,
    used: ReviewChoice,
    r?: ExecResult,
    errorName?: string,
  ): ReviewRun => {
    const details = base(outcome, attempts, used);
    if (outcome === "exit-error" && r) details.exitCode = r.code;
    return { text: formatFailure(cli, outcome, r, errorName), isError: true, details };
  };

  let dir: string | undefined;
  try {
    if (signal?.aborted) return failed("cancelled", 1, choice);

    let used = choice;
    if (cli === "codex") {
      const model = await resolveModel(exec, choice.model, cwd, signal);
      if (model !== choice.model && model !== undefined) used = { ...choice, model };
      if (signal?.aborted) return failed("cancelled", 1, used);
      dir = mkdtempSync(join(tmpdir(), "jev-review-"));
      chmodSync(dir, 0o700);
    }
    const out = dir === undefined ? undefined : join(dir, "last-message.txt");
    const prompt = buildPrompt(brief);
    const [command, args] =
      cli === "codex"
        ? ["codex", codexArgs({ ...used, cwd, out: out!, prompt })]
        : ["opencode", opencodeArgs({ ...used, prompt })];

    let attempts: 1 | 2 = 1;
    for (;;) {
      if (out !== undefined) rmSync(out, { force: true });
      let r: ExecResult;
      try {
        r = await exec(command!, args as string[], {
          cwd,
          timeout: ATTEMPT_TIMEOUT_MS,
          ...(signal ? { signal } : {}),
          maxBuffer: MAX_BUFFER,
        });
      } catch (e) {
        if (signal?.aborted) return failed("cancelled", attempts, used);
        return failed(
          "exec-error",
          attempts,
          used,
          undefined,
          e instanceof Error ? e.name : "Error",
        );
      }
      const outcome = classifyAttempt(r, signal?.aborted === true);
      if (outcome === "timeout" && attempts === 1) {
        attempts = 2;
        continue;
      }
      if (outcome !== "ok") return failed(outcome, attempts, used, r);
      const fromFile = out === undefined ? "" : readOut(out);
      const output = fromFile.trim() !== "" ? fromFile : r.stdout;
      const details = base("ok", attempts, used);
      details.exitCode = r.code;
      return { text: formatSuccess(used, output), isError: false, details };
    }
  } catch (e) {
    return failed("exec-error", 1, choice, undefined, e instanceof Error ? e.name : "Error");
  } finally {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
}
