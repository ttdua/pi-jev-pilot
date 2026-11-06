/**
 * WG-15 manual script: one real CLI review with Codex and with OpenCode.
 *
 * Operator run (uses the real CLI logins and paid models; never part of `bun test`):
 *   bun tests/host/manual/cli-review-real.ts
 * Optional: JEV_REVIEW_CODEX_MODEL, JEV_REVIEW_OPENCODE_MODEL pick a model (default: the CLI's own).
 *
 * Reviews a throwaway git repository in a temp directory. A CLI that is not on PATH is skipped.
 * Prints per CLI only: outcome, attempts, exitCode, output length. Never the output text.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runReview } from "../../../src/host/review.ts";
import type { Exec, ExecResult, ReviewChoice } from "../../../src/host/review-cli.ts";

/** Mirrors `pi.exec`: no stdin, timeout kill, output cap, ENOENT as code 1. */
const exec: Exec = async (command, args, options) => {
  const max = options.maxBuffer ?? Infinity;
  let killed = false;
  let truncated = false;
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([command, ...args], {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch {
    return {
      stdout: "",
      stderr: `spawn ${command} ENOENT`,
      code: 1,
      killed: false,
      truncated: false,
    };
  }
  const kill = (): void => {
    proc.kill("SIGKILL");
  };
  const timer = options.timeout
    ? setTimeout(() => ((killed = true), kill()), options.timeout)
    : undefined;
  const onAbort = (): void => {
    killed = true;
    kill();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const read = async (stream: ReadableStream<Uint8Array>): Promise<string> => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of stream) {
      if (size >= max) continue;
      const buf = Buffer.from(c);
      chunks.push(size + buf.length > max ? buf.subarray(0, max - size) : buf);
      size += buf.length;
      if (size >= max) {
        truncated = true;
        kill();
      }
    }
    return Buffer.concat(chunks).toString("utf8");
  };
  const [stdout, stderr, code] = await Promise.all([
    read(proc.stdout as ReadableStream<Uint8Array>),
    read(proc.stderr as ReadableStream<Uint8Array>),
    proc.exited,
  ]);
  if (timer) clearTimeout(timer);
  options.signal?.removeEventListener("abort", onAbort);
  const result: ExecResult = { stdout, stderr, code, killed, truncated };
  return result;
};

function git(cwd: string, ...args: string[]): void {
  const r = Bun.spawnSync(
    [
      "git",
      "-c",
      "user.name=jev",
      "-c",
      "user.email=jev@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, stdout: "ignore", stderr: "ignore" },
  );
  if (r.exitCode !== 0) throw new Error(`git ${args[0]} failed`);
}

const repo = mkdtempSync(join(tmpdir(), "jev-review-real-"));
try {
  git(repo, "init", "-q");
  writeFileSync(join(repo, "add.ts"), "export const add = (a: number, b: number) => a + b;\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "add");
  writeFileSync(
    join(repo, "add.ts"),
    "export const add = (a: number, b: number) => a + b;\nexport const sub = (a: number, b: number) => a - b;\n",
  );
  git(repo, "commit", "-aq", "-m", "add sub");

  const choices: { cli: ReviewChoice["cli"]; model: string | undefined }[] = [
    { cli: "codex", model: process.env.JEV_REVIEW_CODEX_MODEL },
    { cli: "opencode", model: process.env.JEV_REVIEW_OPENCODE_MODEL },
  ];
  for (const { cli, model } of choices) {
    if (Bun.which(cli) === null) {
      console.log(`${cli}: skipped (not on PATH)`);
      continue;
    }
    const choice: ReviewChoice = { cli, ...(model ? { model } : {}) };
    const r = await runReview(exec, { choice, brief: "Review the last commit.", cwd: repo });
    console.log(
      `${cli}: outcome=${r.details.outcome} attempts=${r.details.attempts} exitCode=${r.details.exitCode ?? "none"} outputLength=${r.text.length}`,
    );
  }
} finally {
  rmSync(repo, { recursive: true, force: true });
}
