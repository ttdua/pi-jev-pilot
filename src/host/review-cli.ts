// Pure builders for the CLI review. Imports nothing from Pi.

export type ExecResult = {
  stdout: string;
  stderr: string;
  code: number;
  killed: boolean;
  truncated: boolean;
};

export type Exec = (
  command: string,
  args: string[],
  options: { cwd?: string; timeout?: number; signal?: AbortSignal; maxBuffer?: number },
) => Promise<ExecResult>;

export type ReviewChoice = { cli: "codex" | "opencode"; model?: string; effort?: string };

export type ReviewDetails = {
  cli: "codex" | "opencode";
  model?: string;
  effort?: string;
  exitCode?: number;
  attempts: 1 | 2;
  outcome: "ok" | "timeout" | "cancelled" | "not-found" | "exit-error" | "truncated" | "exec-error";
};

export type CodexModel = { slug: string; name: string; efforts: string[] };

export type CheckResult =
  | { ok: true; model?: string; effort?: string }
  | { ok: false; message: string; suggestions: string[] };

export const REVIEW_INSTRUCTIONS: string = [
  "Review a code change in this repository, read-only: don't edit anything.",
  "Read the changed files and `git diff` (or `git diff HEAD~1` when the change is already committed).",
  "Check that it does what the brief says, and look for wrong behavior, input that is not checked, broken edge cases and missing tests.",
  "Report each finding as P1 (wrong behavior or lost data), P2 (a likely bug or a missing check) or P3 (minor), with file:line and a one-line fix.",
  "End with one verdict: PASS, PASS-WITH-FOLLOWUP or NEEDS FIXES. Keep it tight.",
].join("\n");

/** Instructions come first so the prompt can never be read as a flag. */
export function buildPrompt(brief: string): string {
  return `${REVIEW_INSTRUCTIONS}\n\nThe change:\n${brief}`;
}

export function codexArgs(c: {
  model?: string;
  effort?: string;
  cwd: string;
  out: string;
  prompt: string;
}): string[] {
  return [
    "exec",
    ...(c.model ? ["-m", c.model] : []),
    ...(c.effort ? ["-c", `model_reasoning_effort="${c.effort}"`] : []),
    "-s",
    "read-only",
    "--skip-git-repo-check",
    "--ephemeral",
    "-C",
    c.cwd,
    "-o",
    c.out,
    c.prompt,
  ];
}

export function opencodeArgs(c: { model?: string; effort?: string; prompt: string }): string[] {
  const model = c.model ? (c.effort ? `${c.model}#${c.effort}` : c.model) : undefined;
  return ["run", ...(model ? ["-m", model] : []), "--agent", "plan", c.prompt];
}
