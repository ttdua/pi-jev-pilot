import { appendFileSync, mkdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GitCounts } from "../jev/state.ts";

const FILE = "replay-git.jsonl";
const MAX_LINES = 5000;
/** Lines are short, so a file this large is treated as full without reading it. */
const MAX_BYTES = MAX_LINES * 512;

export type RecordInput = {
  dir: string;
  at: number;
  session: string;
  turnId: string;
  counts: Promise<GitCounts | undefined>;
};

/** True when the file already holds the line cap. A missing file is not full. */
function isFull(path: string): boolean {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return false;
  }
  if (size >= MAX_BYTES) return true;
  const text = readFileSync(path, "utf8");
  let lines = 0;
  for (const ch of text) if (ch === "\n") lines++;
  return lines >= MAX_LINES;
}

/** Appends one numbers-only line to `<dir>/replay-git.jsonl`. Never rejects; any failure writes nothing. */
export async function recordGitCounts(i: RecordInput): Promise<void> {
  try {
    const counts = await i.counts;
    if (counts === undefined) return;
    const path = join(i.dir, FILE);
    mkdirSync(i.dir, { recursive: true, mode: 0o700 });
    if (isFull(path)) return;
    const line = JSON.stringify({
      v: 1,
      at: i.at,
      session: i.session,
      turnId: i.turnId,
      changedFiles: counts.changed_files,
      diffLines: counts.diff_lines,
    });
    appendFileSync(path, `${line}\n`, { mode: 0o600, flag: "a" });
  } catch {
    /* fail open: the recorder never affects a turn */
  }
}
