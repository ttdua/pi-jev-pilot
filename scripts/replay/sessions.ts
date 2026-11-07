// Reads Pi session files and Pi-Jev ledger lines for the offline replay tool.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { SessionEntryLike } from "../../src/jev/branch.ts";

export type SessionEntry = SessionEntryLike & { parentId?: string | null };
export type SessionHeader = { id: string; cwd: string; parentSession?: string };
export type LedgerMain = { effective?: string; strategy?: string; from?: string };

function parseLine(line: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Valid JSON-object lines of a JSONL text, in order; corrupt lines are dropped. */
function jsonLines(path: string): Record<string, unknown>[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map(parseLine)
    .filter((v): v is Record<string, unknown> => v !== undefined);
}

/** Keeps only entries with a string `type`; `id` and `parentId` are kept only when well-typed. */
function toEntry(raw: Record<string, unknown>): SessionEntry | undefined {
  if (typeof raw.type !== "string") return undefined;
  return {
    type: raw.type,
    ...(typeof raw.id === "string" ? { id: raw.id } : {}),
    ...(typeof raw.parentId === "string" || raw.parentId === null
      ? { parentId: raw.parentId }
      : {}),
    ...(typeof raw.customType === "string" ? { customType: raw.customType } : {}),
    ...(raw.data !== undefined ? { data: raw.data } : {}),
    ...(raw.message !== undefined ? { message: raw.message } : {}),
  };
}

/** Parses a session file; returns undefined when the header is missing or corrupt. */
export function readSessionFile(
  path: string,
): { header: SessionHeader; entries: SessionEntry[] } | undefined {
  const [head, ...rest] = jsonLines(path);
  if (!head || head.type !== "session") return undefined;
  const header: SessionHeader = {
    id: String(head.id ?? ""),
    cwd: String(head.cwd ?? ""),
    ...(typeof head.parentSession === "string" ? { parentSession: head.parentSession } : {}),
  };
  return { header, entries: rest.flatMap((e) => toEntry(e) ?? []) };
}

/** The entries from the root down to `entryId`, following `parentId`. */
export function branchTo(entries: readonly SessionEntry[], entryId: string): SessionEntry[] {
  const byId = new Map<string, SessionEntry>();
  for (const e of entries) if (e.id) byId.set(e.id, e);
  const path: SessionEntry[] = [];
  const seen = new Set<string>();
  let cur = byId.get(entryId);
  while (cur?.id && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.push(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return path.reverse();
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export function readLedgerLines(dir: string): Map<string, LedgerMain> {
  const out = new Map<string, LedgerMain>();
  for (const name of ["ledger.1.jsonl", "ledger.jsonl"]) {
    const path = join(dir, name);
    if (!existsSync(path)) continue;
    for (const line of jsonLines(path)) {
      const turnId = str(line.turnId);
      if (line.kind !== "main" || !turnId) continue;
      const effective = str(line.effective);
      const strategy = str(line.strategy);
      const from = str(line.from);
      out.set(turnId, {
        ...(effective ? { effective } : {}),
        ...(strategy ? { strategy } : {}),
        ...(from ? { from } : {}),
      });
    }
  }
  return out;
}
