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
import { LEDGER_MAX_LINE_BYTES, type LedgerEntry, validateLedgerEntry } from "./ledger-schema.ts";
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

export type LedgerRead =
  | { kind: "ok"; entries: LedgerEntry[]; skipped: number }
  | { kind: "unreadable"; issues: Issue[] };

type Segment = { text: string };

function readSegment(file: string): Segment {
  try {
    return { text: readFileSync(file, "utf8") };
  } catch (err) {
    if (codeOf(err) === "ENOENT") return { text: "" };
    throw err;
  }
}

function inodeOf(file: string): number | undefined {
  try {
    return statSync(file).ino;
  } catch {
    return undefined;
  }
}

function parseSegment(text: string, entries: LedgerEntry[]): number {
  if (text === "") return 0;
  const parts = text.split("\n");
  const complete = text.endsWith("\n");
  let skipped = 0;
  for (let i = 0; i < parts.length; i++) {
    const raw = parts[i] as string;
    const last = i === parts.length - 1;
    if (last && complete) break; // trailing empty string after the final newline
    if (last && !complete) {
      skipped++; // torn or unterminated line
      break;
    }
    if (raw === "" || Buffer.byteLength(raw) + 1 > LEDGER_MAX_LINE_BYTES) {
      skipped++;
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      skipped++;
      continue;
    }
    const checked = validateLedgerEntry(value);
    if (checked.ok) entries.push(checked.entry);
    else skipped++;
  }
  return skipped;
}

function readPass(dir: string, hooks?: LedgerHooks): { stable: boolean; texts: string[] } {
  const oldFile = join(dir, OLD);
  const before = inodeOf(oldFile);
  const oldText = readSegment(oldFile).text;
  hooks?.betweenSegments?.();
  const activeText = readSegment(join(dir, ACTIVE)).text;
  return { stable: inodeOf(oldFile) === before, texts: [oldText, activeText] };
}

/** Reads both segments, oldest first, skipping bad lines. Never throws. */
export function readLedger(dir: string, hooks?: LedgerHooks): LedgerRead {
  try {
    let pass = readPass(dir, hooks);
    if (!pass.stable) pass = readPass(dir);
    const entries: LedgerEntry[] = [];
    let skipped = 0;
    for (const text of pass.texts) skipped += parseSegment(text, entries);
    return { kind: "ok", entries: entries.slice(-LEDGER_LINES), skipped };
  } catch (err) {
    return {
      kind: "unreadable",
      issues: [{ path: "", message: `cannot read ledger (${codeOf(err)})` }],
    };
  }
}
