// Rebuilds the rich state inputs of a replayed prompt from local data only.
import { readFileSync } from "node:fs";
import { branchItems } from "../../src/jev/branch.ts";
import type { BranchItem, GitCounts, RichGroup, RichInputs } from "../../src/jev/state.ts";
import { scanPlatforms } from "../../src/jev/workspace.ts";
import { type AgentFacts, LOCKABLE_FIELDS } from "../../src/policy/launch.ts";
import type { MainSample, WorkerSample } from "./corpus.ts";
import type { readLedgerLines, SessionEntry } from "./sessions.ts";

export type Snapshot = {
  v: 1;
  tools: { name: string; description: string }[];
  agents: AgentFacts[];
};

export type ReplayContext = {
  ledger: ReturnType<typeof readLedgerLines>;
  capabilities?: Snapshot;
  git?: Map<string, GitCounts>;
};

export type RebuiltMain = {
  sample: MainSample;
  rich: RichInputs;
  missing: RichGroup[];
  items: BranchItem[];
  platforms: string[];
};

export type RebuiltWorker = { sample: WorkerSample; agent?: AgentFacts };

export class SnapshotError extends Error {}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === "object";
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");
const optionalBool = (v: unknown): boolean => v === undefined || typeof v === "boolean";

function isTool(v: unknown): v is Snapshot["tools"][number] {
  return isRec(v) && typeof v.name === "string" && typeof v.description === "string";
}

function isLocked(v: unknown): boolean {
  if (v === undefined || v === true) return true;
  return Array.isArray(v) && v.every((f) => (LOCKABLE_FIELDS as readonly unknown[]).includes(f));
}

function isAgent(v: unknown): v is AgentFacts {
  if (!isRec(v)) return false;
  const sets = v.sets;
  return (
    typeof v.name === "string" &&
    (v.source === "project" || v.source === "global" || v.source === "builtin") &&
    typeof v.description === "string" &&
    typeof v.instructionsExcerpt === "string" &&
    (v.declaredTools === null || isStrings(v.declaredTools)) &&
    (v.maxTurns === null || typeof v.maxTurns === "number") &&
    optionalBool(v.runInBackground) &&
    optionalBool(v.inheritContext) &&
    isLocked(v.locked) &&
    isRec(sets) &&
    typeof sets.model === "boolean" &&
    typeof sets.thinking === "boolean"
  );
}

export function readSnapshot(path: string): Snapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new SnapshotError(`cannot read capabilities snapshot ${path}: ${String(error)}`);
  }
  if (
    !isRec(parsed) ||
    parsed.v !== 1 ||
    !Array.isArray(parsed.tools) ||
    !Array.isArray(parsed.agents)
  ) {
    throw new SnapshotError(`capabilities snapshot ${path} is not version 1`);
  }
  const { tools, agents } = parsed;
  if (!tools.every(isTool) || !agents.every(isAgent)) {
    throw new SnapshotError(`capabilities snapshot ${path} has a malformed tool or agent`);
  }
  return { v: 1, tools, agents };
}

export function agentFacts(snapshot: Snapshot | undefined, name: string): AgentFacts | undefined {
  return snapshot?.agents.find((a) => a.name === name);
}

const dataOf = (e: SessionEntry): Rec | undefined => (isRec(e.data) ? e.data : undefined);

function lastDecision(
  before: readonly SessionEntry[],
  ledger: ReplayContext["ledger"],
): RichInputs["lastDecision"] {
  for (let i = before.length - 1; i >= 0; i--) {
    const e = before[i]!;
    const data = dataOf(e);
    if (e.type !== "custom" || !data) continue;
    if (e.customType === "jev-pilot:effort") {
      const effort = str(data.requested);
      const strategy = isRec(data.decision) ? str(data.decision.strategy) : undefined;
      return { ...(effort ? { effort } : {}), ...(strategy ? { strategy } : {}) };
    }
    if (e.customType === "jev-turn") {
      const turnId = str(data.turnId);
      const joined = turnId ? ledger.get(turnId) : undefined;
      if (!joined) continue;
      return {
        ...(joined.effective ? { effort: joined.effective } : {}),
        ...(joined.strategy ? { strategy: joined.strategy } : {}),
      };
    }
  }
  return undefined;
}

function capabilitiesOf(snapshot: Snapshot): NonNullable<RichInputs["capabilities"]> {
  return {
    tools: snapshot.tools.map((t) => ({ name: t.name, description: t.description })),
    agents: snapshot.agents.map((a) => ({
      name: a.name,
      description: a.description,
      tools: a.declaredTools,
    })),
  };
}

export function rebuildRich(
  sample: MainSample,
  ctx: ReplayContext,
): { rich: RichInputs; missing: RichGroup[] } {
  const before = sample.branch.slice(0, -1);
  const rich: RichInputs = {};
  const missing: RichGroup[] = [];
  const decision = lastDecision(before, ctx.ledger);
  if (decision !== undefined) rich.lastDecision = decision;
  if (ctx.capabilities === undefined) missing.push("capabilities");
  else rich.capabilities = capabilitiesOf(ctx.capabilities);
  const git = sample.turnId === undefined ? undefined : ctx.git?.get(sample.turnId);
  if (git === undefined) missing.push("git");
  else rich.git = git;
  return { rich, missing };
}

export function rebuildMain(sample: MainSample, ctx: ReplayContext): RebuiltMain {
  return {
    sample,
    ...rebuildRich(sample, ctx),
    items: branchItems(sample.branch.slice(0, -1)),
    platforms: scanPlatforms(sample.cwd),
  };
}
