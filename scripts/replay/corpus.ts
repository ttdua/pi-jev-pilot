// Builds the replay corpus: main-turn and worker samples from session files, and a seeded stratified sampler.
import { type Dirent, readdirSync } from "node:fs";
import { join } from "node:path";
import { branchTo, readLedgerLines, readSessionFile, type SessionEntry } from "./sessions.ts";

export type MainSample = {
  session: string;
  cwd: string;
  entryId: string;
  prompt: string;
  branch: SessionEntry[];
  startEffort?: string;
};

export type WorkerSample = {
  session: string;
  agent: string;
  brief: string;
  description?: string;
  parentPrompt?: string;
  runInBackground: boolean;
};

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === "object";
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((p): p is Rec => isRec(p) && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("\n");
}

function messageOf(e: SessionEntry): Rec | undefined {
  return e.type === "message" && isRec(e.message) ? e.message : undefined;
}

function userPrompt(e: SessionEntry): string | undefined {
  const m = messageOf(e);
  return m?.role === "user" ? textOf(m.content).trim() : undefined;
}

const isExcludedPrompt = (p: string): boolean =>
  p === "" || p.startsWith("/") || p.startsWith("<skill");

const MAX_SESSION_DEPTH = 6;

/** Session files under `dir`, recursively, sorted by relative path. Skips symlinks and unreadable directories. */
function sessionFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string, rel: string, depth: number): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (depth < MAX_SESSION_DEPTH) walk(join(current, e.name), relPath, depth + 1);
      } else if (e.isFile() && e.name.endsWith(".jsonl") && !e.name.startsWith("ledger")) {
        found.push(relPath);
      }
    }
  };
  walk(dir, "", 0);
  return found.sort().map((r) => join(dir, r));
}

/**
 * Entries on this prompt's branch after `index`, in file order, stopping before the next user
 * message. Return a value from `visit` to end the walk with it.
 */
function walkBranch<T>(
  entries: readonly SessionEntry[],
  index: number,
  visit: (e: SessionEntry) => T | undefined,
): T | undefined {
  const reach = new Set<string>([entries[index]!.id!]);
  for (let i = index + 1; i < entries.length; i++) {
    const e = entries[i]!;
    if (!e.id || !e.parentId || !reach.has(e.parentId)) continue;
    reach.add(e.id);
    if (userPrompt(e) !== undefined) return undefined;
    const found = visit(e);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Effort at the start of a turn: the entries on this prompt's branch before its next user message. */
function startEffortOf(
  entries: readonly SessionEntry[],
  index: number,
  ledger: ReturnType<typeof readLedgerLines>,
): string | undefined {
  return walkBranch(entries, index, (e) => {
    const data = isRec(e.data) ? e.data : undefined;
    if (e.type !== "custom" || !data) return undefined;
    if (e.customType === "jev-pilot:effort") return str(data.requested) || undefined;
    if (e.customType !== "jev-turn") return undefined;
    const turnId = str(data.turnId);
    return (turnId ? ledger.get(turnId)?.from : undefined) || undefined;
  });
}

export function mainSamples(dir: string): MainSample[] {
  const ledger = readLedgerLines(dir);
  const seen = new Set<string>();
  const out: MainSample[] = [];
  for (const path of sessionFiles(dir)) {
    const session = readSessionFile(path);
    if (!session || session.header.parentSession) continue;
    const { header, entries } = session;
    entries.forEach((entry, index) => {
      const prompt = userPrompt(entry);
      if (prompt === undefined || !entry.id || isExcludedPrompt(prompt) || seen.has(prompt)) return;
      seen.add(prompt);
      const startEffort = startEffortOf(entries, index, ledger);
      out.push({
        session: header.id,
        cwd: header.cwd,
        entryId: entry.id,
        prompt,
        branch: branchTo(entries, entry.id),
        ...(startEffort ? { startEffort } : {}),
      });
    });
  }
  return out;
}

type Launch = { agent: string; brief: string; description?: string; background: boolean };

/** The launch items of a subagent call: `args.tasks` when it is an array, else the call itself. */
function launchItems(args: Rec): unknown[] {
  const nested = isRec(args.args) && Array.isArray(args.args.tasks) ? args.args.tasks : undefined;
  return nested ?? [args];
}

function launchOf(item: unknown): Launch | undefined {
  if (!isRec(item)) return undefined;
  const agent = str(item.agent) ?? str(item.subagent_type);
  const brief = str(item.task) ?? str(item.prompt);
  if (!agent || !brief) return undefined;
  const description = str(item.description);
  return {
    agent,
    brief,
    ...(description ? { description } : {}),
    background: item.async === true || item.run_in_background === true,
  };
}

function launchesOf(args: unknown): Launch[] {
  if (!isRec(args)) return [];
  return launchItems(args).flatMap((item) => launchOf(item) ?? []);
}

function nearestUserPrompt(branch: readonly SessionEntry[]): string | undefined {
  for (let i = branch.length - 2; i >= 0; i--) {
    const p = userPrompt(branch[i]!);
    if (p) return p;
  }
  return undefined;
}

/** The `subagent` tool calls in an assistant message, or none when it is not one. */
function subagentCalls(entry: SessionEntry): Rec[] {
  const m = messageOf(entry);
  if (m?.role !== "assistant" || !Array.isArray(m.content) || !entry.id) return [];
  return m.content.filter(
    (part): part is Rec => isRec(part) && part.type === "toolCall" && part.name === "subagent",
  );
}

function workerSample(session: string, l: Launch, parentPrompt: string | undefined): WorkerSample {
  return {
    session,
    agent: l.agent,
    brief: l.brief,
    ...(l.description ? { description: l.description } : {}),
    ...(parentPrompt ? { parentPrompt } : {}),
    runInBackground: l.background,
  };
}

/** Worker samples of one assistant entry; `branchTo` is pure, so it is only walked when there are calls. */
function entrySamples(
  session: string,
  entries: readonly SessionEntry[],
  entry: SessionEntry,
): WorkerSample[] {
  const calls = subagentCalls(entry);
  if (calls.length === 0) return [];
  const parentPrompt = nearestUserPrompt(branchTo(entries, entry.id!));
  return calls.flatMap((part) =>
    launchesOf(part.arguments).map((l) => workerSample(session, l, parentPrompt)),
  );
}

export function workerSamples(dir: string): WorkerSample[] {
  const out: WorkerSample[] = [];
  for (const path of sessionFiles(dir)) {
    const session = readSessionFile(path);
    if (!session) continue;
    for (const entry of session.entries) {
      out.push(...entrySamples(session.header.id, session.entries, entry));
    }
  }
  return out;
}

/** Worker kind from the agent name or description. */
export function workerKind(w: WorkerSample): "review" | "scout" | "implementation" {
  const text = `${w.agent} ${w.description ?? ""}`;
  if (/review|audit|verif/i.test(text)) return "review";
  if (/scout|explore|research/i.test(text)) return "scout";
  return "implementation";
}

export const mainStratum = (s: MainSample): string => `${s.cwd}|${s.startEffort ?? "unknown"}`;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Proportional allocation by stratum (largest remainder), seeded shuffle within each stratum. */
export function sample<T>(items: T[], n: number, seed: number, stratum: (t: T) => string): T[] {
  if (n >= items.length) return shuffle(items, mulberry32(seed));
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = stratum(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const rand = mulberry32(seed);
  const keys = [...groups.keys()].sort();
  const quotas = keys.map((key) => {
    const exact = (groups.get(key)!.length * n) / items.length;
    return { key, base: Math.floor(exact), rem: exact - Math.floor(exact) };
  });
  let left = n - quotas.reduce((s, q) => s + q.base, 0);
  for (const q of [...quotas].sort((a, b) => b.rem - a.rem || a.key.localeCompare(b.key))) {
    if (left-- <= 0) break;
    q.base += 1;
  }
  return quotas.flatMap((q) => shuffle(groups.get(q.key)!, rand).slice(0, q.base));
}
