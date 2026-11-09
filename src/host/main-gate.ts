import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { mainQuestions, type SkillQuestions } from "../jev/questions.ts";
import { canAskEffort, supportedLevels, type ThinkingLevel } from "../policy/effort.ts";
import { isHeld } from "../policy/hold.ts";
import { holdContext, previousTurnId } from "./context.ts";
import type { TurnRecord } from "./main-record.ts";
import type { Snapshot } from "./readiness.ts";
import type { CatalogSkill } from "./skills.ts";

/** The model fields the gate reads; Pi's model object is wider. */
export type GateModel = {
  provider?: unknown;
  id?: unknown;
  reasoning: boolean;
  thinkingLevelMap?: unknown;
};

/**
 * Everything the gate reads. The thunks run in gate order and only when every earlier gate
 * passed, so an untouched turn reads no files and no environment.
 */
export type GateInput = {
  /** The user prompt; undefined for a run started by a custom message. */
  prompt: string | undefined;
  isChildSession: boolean;
  load: () => Snapshot;
  model: GateModel | undefined;
  /** The API key value for the snapshot's key variable. */
  apiKey: (keyVar: string) => string | undefined;
  /** The session branch; read once, after the eligibility gates. */
  branch: () => readonly SessionEntry[];
  /** Skill batches for the prompt; called only after every other gate passed. */
  planSkills: (skillsOn: boolean) => CatalogSkill[][] | undefined;
};

/** A turn the package decides: what it asks and the context its record carries. */
export type TurnPlan = {
  snapshot: Snapshot;
  branch: readonly SessionEntry[];
  apiKey: string;
  effortOn: boolean;
  askEffort: boolean;
  askStrategy: boolean;
  held: boolean;
  supported: ThinkingLevel[];
  batches: CatalogSkill[][];
  questions: SkillQuestions;
  provider: string | undefined;
  modelId: string | undefined;
  compactionId: string | undefined;
  previousTurnId: string | undefined;
};

const stringOrUndefined = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

type Eligible = { snapshot: Snapshot; model: GateModel; apiKey: string };

/** Whether the prompt, session, config and key allow a decision at all. */
function eligible(input: GateInput): Eligible | undefined {
  const { prompt, model } = input;
  if (prompt === undefined || prompt.trim() === "") return undefined;
  if (input.isChildSession) return undefined;
  const snapshot = input.load();
  if (!snapshot.config.valid || !snapshot.keySet) return undefined;
  if (model === undefined) return undefined;
  const apiKey = input.apiKey(snapshot.keyVar);
  if (apiKey === undefined || apiKey === "") return undefined;
  return { snapshot, model, apiKey };
}

function questionsFor(o: {
  askEffort: boolean;
  askStrategy: boolean;
  first: CatalogSkill[] | undefined;
}): SkillQuestions {
  const { askEffort, askStrategy, first } = o;
  return first === undefined
    ? mainQuestions({ askEffort, askStrategy })
    : mainQuestions({ askEffort, askStrategy, skills: first });
}

/**
 * Decides whether the package touches this turn and, if so, what it asks.
 * Undefined leaves the turn exactly as Pi would run it without the package.
 */
export function gateTurn(input: GateInput): TurnPlan | undefined {
  const ok = eligible(input);
  if (ok === undefined) return undefined;
  const { snapshot, model, apiKey } = ok;
  const { switches, effort } = snapshot.settings;
  const effortOn = switches.effort;
  const askStrategy = switches.strategy;
  // The catalog is read only after every other gate passed.
  const anyFeature = effortOn || askStrategy || switches.skills;
  const batches = anyFeature ? (input.planSkills(switches.skills) ?? []) : [];
  if (!effortOn && !askStrategy && batches.length === 0) return undefined;

  const supported = supportedLevels({
    reasoning: model.reasoning,
    thinkingLevelMap: model.thinkingLevelMap as never,
  });
  const branch = input.branch();
  const { anchor, compactionId } = holdContext(branch);
  const provider = stringOrUndefined(model.provider);
  const modelId = stringOrUndefined(model.id);
  // A hold keeps the effort decision, so it applies only while `effort` is on.
  const held =
    effortOn && isHeld({ provider, model: modelId, holdProviders: effort.holdProviders, anchor });
  const askEffort = effortOn && !held && canAskEffort(supported);
  return {
    snapshot,
    branch,
    apiKey,
    effortOn,
    askEffort,
    askStrategy,
    held,
    supported,
    batches,
    questions: questionsFor({ askEffort, askStrategy, first: batches[0] }),
    provider,
    modelId,
    compactionId,
    previousTurnId: previousTurnId(branch),
  };
}

/** The record fields fixed when the turn starts. */
export type TurnStart = Pick<TurnRecord, "turnId" | "at" | "sessionId" | "mode" | "from">;

/** A fresh record for a decided turn; optional context fields only when known. */
export function newTurnRecord(plan: TurnPlan, start: TurnStart): TurnRecord {
  return {
    ...start,
    ...(plan.previousTurnId === undefined ? {} : { previousTurnId: plan.previousTurnId }),
    ...(plan.held ? { held: true as const } : {}),
    ...(plan.provider === undefined ? {} : { provider: plan.provider }),
    ...(plan.modelId === undefined ? {} : { model: plan.modelId }),
    ...(plan.compactionId === undefined ? {} : { compactionId: plan.compactionId }),
    answered: false,
    ms: 0,
    sawRequest: false,
    toolCalls: 0,
    failures: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
}
