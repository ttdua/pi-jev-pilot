import { parseShortstat, type GitCounts } from "../jev/state.ts";

const GIT_TIMEOUT_MS = 500;

export type GitExec = (
  cmd: string,
  args: string[],
  o: { cwd: string; timeout: number },
) => Promise<{ stdout: string; code: number; killed?: boolean; truncated?: boolean }>;

/** Changed files and diff lines against HEAD; undefined on any failure or after 500 ms. */
export async function gitCounts(exec: GitExec, cwd: string): Promise<GitCounts | undefined> {
  const timeout = new Promise<undefined>((resolve) => {
    setTimeout(resolve, GIT_TIMEOUT_MS, undefined).unref();
  });
  const run = async (): Promise<GitCounts | undefined> => {
    try {
      const r = await exec("git", ["diff", "HEAD", "--shortstat"], {
        cwd,
        timeout: GIT_TIMEOUT_MS,
      });
      if (r.code !== 0 || r.killed === true || r.truncated === true) return undefined;
      return parseShortstat(r.stdout);
    } catch {
      return undefined;
    }
  };
  return Promise.race([run(), timeout]);
}
