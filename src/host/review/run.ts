import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  buildPrompt,
  classifyAttempt,
  codexArgs,
  failureDetails,
  formatFailure,
  formatSuccess,
  opencodeArgs,
  reviewDetails,
  type Exec,
  type ReviewChoice,
  type ReviewDetails,
} from "../../policy/review/index.ts";
import { runAttempt } from "./attempt.ts";
import { makeOutDir, resolveModel } from "./codex.ts";

export type ReviewRun = { text: string; isError: boolean; details: ReviewDetails };
type Input = { choice: ReviewChoice; brief: string; cwd: string; signal?: AbortSignal };
type Outcome = ReviewDetails["outcome"];
type Plan = { used: ReviewChoice; command: string; args: string[]; out?: string };

function failed(
  used: ReviewChoice,
  outcome: Outcome,
  attempts: 1 | 2,
  extra: { r?: Parameters<typeof formatFailure>[2]; errorName?: string } = {},
): ReviewRun {
  return {
    text: formatFailure(used.cli, outcome, extra.r, extra.errorName),
    isError: true,
    details: failureDetails(used, outcome, attempts, extra.r),
  };
}

function readOut(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    // no file means the CLI wrote nothing there: stdout is used
    return "";
  }
}

/** Codex: resolve the model and make the output directory; undefined when cancelled meanwhile. */
async function prepareCodex(
  exec: Exec,
  input: Input,
): Promise<{ used: ReviewChoice; dir: string } | { used: ReviewChoice; dir?: undefined }> {
  const { choice, cwd, signal } = input;
  const model = await resolveModel(exec, choice.model, cwd, signal);
  const used = model !== choice.model && model !== undefined ? { ...choice, model } : choice;
  if (signal?.aborted) return { used };
  return { used, dir: makeOutDir() };
}

function planOf(used: ReviewChoice, input: Input, dir: string | undefined): Plan {
  const prompt = buildPrompt(input.brief);
  if (dir === undefined) {
    return { used, command: "opencode", args: opencodeArgs({ ...used, prompt }) };
  }
  const out = join(dir, "last-message.txt");
  return { used, command: "codex", args: codexArgs({ ...used, cwd: input.cwd, out, prompt }), out };
}

function succeeded(plan: Plan, stdout: string, code: number, attempts: 1 | 2): ReviewRun {
  const fromFile = plan.out === undefined ? "" : readOut(plan.out);
  const output = fromFile.trim() !== "" ? fromFile : stdout;
  const details = reviewDetails(plan.used, "ok", attempts);
  details.exitCode = code;
  return { text: formatSuccess(plan.used, output), isError: false, details };
}

/** Runs the CLI, retrying once after the first timeout. */
async function attemptLoop(exec: Exec, plan: Plan, input: Input): Promise<ReviewRun> {
  const { used } = plan;
  const where = { cwd: input.cwd, ...(input.signal ? { signal: input.signal } : {}) };
  let attempts: 1 | 2 = 1;
  for (;;) {
    if (plan.out !== undefined) rmSync(plan.out, { force: true });
    const a = await runAttempt(exec, plan.command, plan.args, where);
    if (!a.ok) {
      return a.cancelled
        ? failed(used, "cancelled", attempts)
        : failed(used, "exec-error", attempts, { errorName: a.errorName });
    }
    const outcome = classifyAttempt(a.r, input.signal?.aborted === true);
    if (outcome === "timeout" && attempts === 1) {
      attempts = 2;
      continue;
    }
    if (outcome !== "ok") return failed(used, outcome, attempts, { r: a.r });
    return succeeded(plan, a.r.stdout, a.r.code, attempts);
  }
}

/** Runs one review. Never throws; the brief and output stay out of `details`. */
export async function runReview(exec: Exec, request: Input): Promise<ReviewRun> {
  const { choice, brief, cwd, signal } = request;
  const input: Input =
    signal === undefined ? { choice, brief, cwd } : { choice, brief, cwd, signal };
  let dir: string | undefined;
  try {
    if (signal?.aborted) return failed(choice, "cancelled", 1);
    let used = choice;
    if (choice.cli === "codex") {
      const prepared = await prepareCodex(exec, input);
      used = prepared.used;
      if (prepared.dir === undefined) return failed(used, "cancelled", 1);
      dir = prepared.dir;
    }
    return await attemptLoop(exec, planOf(used, input, dir), input);
  } catch (e) {
    return failed(choice, "exec-error", 1, { errorName: e instanceof Error ? e.name : "Error" });
  } finally {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
}
