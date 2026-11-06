import { randomBytes } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { validateLedgerEntry } from "./ledger-schema.ts";
import type { Issue, WriteResult } from "./validate.ts";

export const LEDGER_LINES = 2000;
export const ROTATE_LOCK_STALE_MS = 60000;

/** Test seams only; production callers pass nothing. */
export type LedgerHooks = {
  beforeRotateLock?: () => void;
  whileRotateLocked?: () => void;
  betweenSegments?: () => void;
};

const ACTIVE = "ledger.jsonl";
const OLD = "ledger.1.jsonl";
const LOCK = "ledger.rotate.lock";

function fail(message: string): WriteResult {
  const issues: Issue[] = [{ path: "", message }];
  return { ok: false, issues };
}

function codeOf(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" ? code : "EIO";
}

function countLines(file: string): number {
  const data = readFileSync(file);
  let n = 0;
  for (let i = 0; i < data.length; i++) if (data[i] === 0x0a) n++;
  return n;
}

function maybeRotate(dir: string, hooks?: LedgerHooks): void {
  const active = join(dir, ACTIVE);
  if (statSync(active).size < LEDGER_LINES * 64) return;
  if (countLines(active) < LEDGER_LINES) return;
  hooks?.beforeRotateLock?.();
  const lock = join(dir, LOCK);
  let fd: number;
  try {
    fd = openSync(lock, "wx", 0o600);
  } catch (err) {
    if (codeOf(err) !== "EEXIST") throw err;
    if (Date.now() - statSync(lock).mtimeMs > ROTATE_LOCK_STALE_MS) {
      const stale = `${lock}.${process.pid}.${randomBytes(4).toString("hex")}.stale`;
      renameSync(lock, stale);
      rmSync(stale, { force: true });
    }
    return;
  }
  try {
    closeSync(fd);
    hooks?.whileRotateLocked?.();
    if (countLines(active) >= LEDGER_LINES) renameSync(active, join(dir, OLD));
  } finally {
    rmSync(lock, { force: true });
  }
}

/** Appends one validated line to `dir/ledger.jsonl`, rotating at 2000 lines. Never throws. */
export function appendLedger(dir: string, entry: unknown, hooks?: LedgerHooks): WriteResult {
  let line: string;
  try {
    const checked = validateLedgerEntry(entry);
    if (!checked.ok) return { ok: false, issues: checked.issues };
    line = checked.line;
  } catch {
    return fail("invalid ledger entry");
  }
  const buf = Buffer.from(line, "utf8");
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const fd = openSync(join(dir, ACTIVE), "a", 0o600);
    try {
      if (writeSync(fd, buf) < buf.length) return fail("cannot append ledger (EIO)");
    } finally {
      closeSync(fd);
    }
  } catch (err) {
    return fail(`cannot append ledger (${codeOf(err)})`);
  }
  try {
    maybeRotate(dir, hooks);
  } catch {
    // rotation is best effort; the append already succeeded
  }
  return { ok: true };
}
