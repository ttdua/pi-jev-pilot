import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export type AtomicResult = { ok: true } | { ok: false; code: string };

/**
 * Writes `data` to `dir/name` through a temporary file and a rename.
 * The directory is created owner-only (0o700) and the file is 0o600,
 * unless `keepMode` is set and the target already exists.
 * Never throws.
 */
export function writeFileAtomic(
  dir: string,
  name: string,
  data: string,
  opts?: { keepMode?: boolean },
): AtomicResult {
  const target = join(dir, name);
  const tmp = join(dir, `${name}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const fd = openSync(tmp, "wx", 0o600);
    try {
      writeFileSync(fd, data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (opts?.keepMode) {
      let existing: number | undefined;
      try {
        existing = statSync(target).mode & 0o777;
      } catch {
        existing = undefined;
      }
      if (existing !== undefined) chmodSync(tmp, existing);
    }
    renameSync(tmp, target);
    return { ok: true };
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // ignore cleanup errors
    }
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    return { ok: false, code: typeof code === "string" ? code : "EIO" };
  }
}
