/**
 * fork-session-manager.ts — Create a fork's persisted session holding a copy
 * of the parent's branch.
 *
 * `SessionManager` offers no public way to append raw entries, and
 * `appendMessage` cannot carry compaction or branch-summary entries. So the
 * fork's file is written with its own header followed by the copied entries
 * (ids kept, so a compaction's `firstKeptEntryId` still resolves), then opened.
 */

import { rmSync, writeFileSync } from "node:fs";
import { type SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";

export function createForkSessionManager(
  cwd: string,
  sessionDir: string,
  parentSession: string | undefined,
  entries: readonly SessionEntry[],
): SessionManager {
  const manager = SessionManager.create(cwd, sessionDir);
  manager.newSession({ parentSession });
  const file = manager.getSessionFile();
  const header = manager.getHeader();
  if (!file || !header) throw new Error("Cannot fork: the fork session has no file.");
  const lines = [header, ...entries].map((entry) => `${JSON.stringify(entry)}\n`).join("");
  writeFileSync(file, lines, { flag: "wx" });
  try {
    return SessionManager.open(file, sessionDir);
  } catch (err) {
    rmSync(file, { force: true });
    throw err;
  }
}
