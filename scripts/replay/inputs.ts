// Rebuilds the rich state inputs of a replayed prompt from local data only.
import { existsSync, readFileSync } from "node:fs";
import { branchItems } from "../../src/jev/branch.ts";
import type { BranchItem, GitCounts, RichGroup, RichInputs } from "../../src/jev/state.ts";
import { scanLanguages, scanPlatforms } from "../../src/jev/workspace.ts";
import type { AgentFacts } from "../../src/policy/launch.ts";
import type { MainSample, WorkerSample } from "./corpus.ts";
import type { readLedgerLines, SessionEntry } from "./sessions.ts";

export type Snapshot = {
  v: 1;
  tools: { name: string; description: string }[];
  agents: AgentFacts[];
};

export type ReplayContext = {
  ledger: ReturnType<typeof readLedgerLines>;
  models: Map<string, number>;
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
  return parsed as Snapshot;
}

export function agentFacts(snapshot: Snapshot | undefined, name: string): AgentFacts | undefined {
  return snapshot?.agents.find((a) => a.name === name);
}

const SCALE: Record<string, number> = { K: 1_000, M: 1_000_000 };

function parseWindow(text: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)([KM])?$/i.exec(text);
  if (!m) return undefined;
  return Math.round(Number(m[1]) * (m[2] ? SCALE[m[2].toUpperCase()]! : 1));
}

/** Context windows by `provider/model` from saved `pi --list-models` text. */
export function parseModels(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of text.split("\n").slice(1)) {
    const [provider, model, context] = line.trim().split(/\s+/);
    const window = context === undefined ? undefined : parseWindow(context);
    if (provider && model && window !== undefined) out.set(`${provider}/${model}`, window);
  }
  return out;
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

/** Percent of the context window used, or undefined when it cannot be known. */
function contextPercent(
  before: readonly SessionEntry[],
  models: ReplayContext["models"],
): number | undefined {
  for (let i = before.length - 1; i >= 0; i--) {
    const e = before[i]!;
    if (e.type === "compaction") return undefined;
    const m = e.type === "message" && isRec(e.message) ? e.message : undefined;
    if (m?.role !== "assistant") continue;
    const tokens = isRec(m.usage) ? m.usage.totalTokens : undefined;
    const window = models.get(`${String(m.provider)}/${String(m.model)}`);
    if (typeof tokens !== "number" || window === undefined || window <= 0) return undefined;
    return (tokens * 100) / window;
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

function languagesOf(cwd: string): string[] | undefined {
  return cwd !== "" && existsSync(cwd) ? scanLanguages(cwd) : undefined;
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
  const percent = contextPercent(before, ctx.models);
  if (percent === undefined) missing.push("context_used_percent");
  else rich.contextPercent = percent;
  const languages = languagesOf(sample.cwd);
  if (languages === undefined) missing.push("languages");
  else rich.languages = languages;
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
