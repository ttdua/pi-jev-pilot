import type { Exec, ExecResult } from "../../policy/review/index.ts";

const ATTEMPT_TIMEOUT_MS = 600_000;
const MAX_BUFFER = 8 * 1024 * 1024;

/** Exec options; `signal` is present only when given. */
export function execOptions(
  cwd: string,
  timeout: number,
  signal?: AbortSignal,
): Parameters<Exec>[2] {
  return { cwd, timeout, ...(signal ? { signal } : {}), maxBuffer: MAX_BUFFER };
}

export type Attempt =
  | { ok: true; r: ExecResult }
  | { ok: false; cancelled: boolean; errorName: string };

/** One exec of the reviewer CLI; a throw becomes `cancelled` (when aborted) or an error name. */
export async function runAttempt(
  exec: Exec,
  command: string,
  args: string[],
  where: { cwd: string; signal?: AbortSignal },
): Promise<Attempt> {
  try {
    return {
      ok: true,
      r: await exec(command, args, execOptions(where.cwd, ATTEMPT_TIMEOUT_MS, where.signal)),
    };
  } catch (e) {
    return {
      ok: false,
      cancelled: where.signal?.aborted === true,
      errorName: e instanceof Error ? e.name : "Error",
    };
  }
}
