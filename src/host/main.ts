import type {
  AgentSettledEvent,
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ExtensionAPI,
  ExtensionContext,
  TurnEndEvent,
} from "@earendil-works/pi-coding-agent";
import type { askJev, JevOutcome } from "../jev/client.ts";
import { mainQuestions, skillBatchQuestions } from "../jev/questions.ts";
import { mainState } from "../jev/state.ts";
import { readAnswers, type QuestionSpec, type ReadResult } from "../policy/answers.ts";
import {
  deliveryForm,
  deliveryText,
  pickSkill,
  skillBatches,
  type SkillPick,
} from "../policy/skill.ts";
import { isHeld } from "../policy/hold.ts";
import {
  CORRECTION_THRESHOLD,
  canAskEffort,
  decideEffort,
  supportedLevels,
  type EffortLevel,
  type ThinkingLevel,
} from "../policy/effort.ts";
import type { WriteResult } from "../store/validate.ts";
import { isChild } from "./child.ts";
import { branchItems, holdContext, previousTurnId } from "./context.ts";
import type { Snapshot } from "./readiness.ts";
import {
  SKILL_MESSAGE_TYPE,
  explicitSkill,
  loadedSkills,
  readCatalog,
  type CatalogSkill,
  type SkillCommand,
} from "./skills.ts";
import { drawStatus, type Decision } from "./status.ts";

export type MainDeps = {
  load: () => Snapshot;
  ask: typeof askJev;
  append: (entry: unknown) => WriteResult;
  now: () => number;
  newId: () => string;
  platforms: (cwd: string) => string[];
  env: () => Record<string, string | undefined>;
  commands: () => readonly SkillCommand[];
  readFile: (path: string) => string;
};

/** Per-turn bookkeeping. Internal; the ledger lines are written from it when the run settles. */
export type TurnRecord = {
  turnId: string;
  at: number;
  sessionId: string;
  mode: string;
  from: ThinkingLevel;
  previousTurnId?: string;
  held?: true;
  provider?: string;
  model?: string;
  compactionId?: string;
  answered: boolean;
  ms: number;
  miss?: string;
  effortP?: Record<string, number>;
  risky?: number;
  corrects?: number;
  skill?: string;
  skillP?: number;
  gate?: number;
  requested?: EffortLevel;
  effective?: ThinkingLevel;
  applied?: ThinkingLevel;
  sawRequest: boolean;
  toolCalls: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  /** Stop reason of the last assistant message seen in `turn_end`. */
  lastStop?: string;
};

/** Everything `decide` needs once a prompt is eligible. */
type Prepared = {
  rec: TurnRecord;
  snapshot: Snapshot;
  apiKey: string;
  supported: ReturnType<typeof supportedLevels>;
  held: boolean;
  askEffort: boolean;
  questions: ReturnType<typeof mainQuestions>;
  state: ReturnType<typeof mainState>;
  /** All skill batches; the first rides on the main request, the rest go out beside it. */
  batches: CatalogSkill[][];
  effortOn: boolean;
};

type Answered = Exclude<JevOutcome, { kind: "cancelled" }>;

type Ctx = Pick<
  ExtensionContext,
  "cwd" | "hasUI" | "mode" | "model" | "sessionManager" | "signal" | "ui"
>;

export function createMain(pi: ExtensionAPI, deps: MainDeps) {
  let record: TurnRecord | undefined;
  let current: Decision | undefined;
  /** What an aborted start needs to put the status back. Belongs to `record`. */
  let undo:
    | {
        rec: TurnRecord;
        ctx: Ctx;
        snapshot: Snapshot;
        previous: Decision | undefined;
        drew: boolean;
      }
    | undefined;

  const level = (): ThinkingLevel => pi.getThinkingLevel() as ThinkingLevel;

  function setDecision(rec: TurnRecord, ctx: Ctx, snapshot: Snapshot, decision: Decision): void {
    if (undo?.rec === rec) undo.drew = true;
    current = decision;
    drawStatus(ctx, snapshot, decision);
  }

  async function beforeAgentStart(
    event: BeforeAgentStartEvent,
    ctx: Ctx,
  ): Promise<BeforeAgentStartEventResult | undefined> {
    const mine: { rec?: TurnRecord } = {};
    try {
      return await decide(event, ctx, mine);
    } catch {
      // A failure before the apply leaves the level unchanged; after it the applied level stays.
      // Only this run's own record is dropped, never a newer one.
      if (mine.rec !== undefined && record === mine.rec && mine.rec.applied === undefined) {
        record = undefined;
        undo = undefined;
      }
      return undefined;
    }
  }

  async function decide(
    event: BeforeAgentStartEvent,
    ctx: Ctx,
    mine: { rec?: TurnRecord },
  ): Promise<BeforeAgentStartEventResult | undefined> {
    const p = prepare(event, ctx);
    if (p === undefined) return undefined;
    const { rec, snapshot } = p;
    mine.rec = rec;
    const common = {
      url: snapshot.settings.classifier.url,
      apiKey: p.apiKey,
      model: snapshot.settings.classifier.model,
      timeoutMs: snapshot.settings.classifier.timeoutMs,
      state: p.state,
      ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
    };
    const asked = deps.ask({ ...common, questions: p.questions.wire });
    const later = askBatches(p.batches.slice(1), common);
    const outcome = await asked;

    if (outcome.kind === "cancelled") {
      if (record === rec) {
        record = undefined;
        undo = undefined;
      }
      return undefined;
    }
    rec.ms = outcome.ms;
    const read = readOf(outcome, p.questions.specs);
    const pick = await safePick(p, read, later);
    recordPick(rec, pick);
    const message = skillMessage(pick, p.batches, ctx, snapshot);
    if (p.held) holdOutcome(rec, ctx, snapshot, outcome, read);
    else applyEffort(p, ctx, outcome, read);
    return message;
  }

  /** The answers of a successful reply; undefined for a miss. */
  function readOf(
    outcome: Answered,
    specs: Readonly<Record<string, QuestionSpec>>,
  ): ReadResult | undefined {
    return outcome.kind === "ok" ? readAnswers(specs, outcome.body) : undefined;
  }

  const whichOptions = (specs: Readonly<Record<string, QuestionSpec>>): readonly string[] => {
    const which = specs["which"];
    return which?.type === "choice" ? which.options : [];
  };

  /** A throw while picking means no pick; the effort decision still goes ahead. */
  async function safePick(
    p: Prepared,
    mainRead: ReadResult | undefined,
    later: readonly Promise<JevOutcome>[],
  ): Promise<SkillPick> {
    try {
      return await skillPick(p, mainRead, later);
    } catch {
      return { kind: "none", reason: "failed" };
    }
  }

  /** Put the pick's name (only when picked), leader probability and gate mean on the record. */
  function recordPick(rec: TurnRecord, pick: SkillPick): void {
    if (pick.kind === "picked") rec.skill = pick.name;
    if ("p" in pick) rec.skillP = pick.p;
    if ("gate" in pick && pick.gate !== undefined) rec.gate = pick.gate;
  }

  /** Pick one skill over the main reply and the later batches' replies; a cancel or miss reads as undefined. */
  async function skillPick(
    p: Prepared,
    mainRead: ReadResult | undefined,
    later: readonly Promise<JevOutcome>[],
  ): Promise<SkillPick> {
    if (p.batches.length === 0) return pickSkill([]);
    const outcomes = await Promise.all(later);
    const rest = p.batches.slice(1).map((batch, i) => {
      const { specs } = skillBatchQuestions(batch);
      const outcome = outcomes[i];
      return {
        options: whichOptions(specs),
        read:
          outcome === undefined || outcome.kind === "cancelled"
            ? undefined
            : readOf(outcome, specs),
      };
    });
    return pickSkill([{ options: whichOptions(p.questions.specs), read: mainRead }, ...rest]);
  }

  /** The hidden `jev-skill` message for a picked skill; any failure means no message. */
  function skillMessage(
    pick: SkillPick,
    batches: readonly CatalogSkill[][],
    ctx: Ctx,
    snapshot: Snapshot,
  ): BeforeAgentStartEventResult | undefined {
    if (pick.kind !== "picked") return undefined;
    try {
      const catalog = batches.flat();
      const skill = catalog.find((s) => s.name === pick.name);
      if (skill === undefined) return undefined;
      const loaded = loadedSkills(ctx.sessionManager.buildSessionProjection().entries, catalog);
      const form = deliveryForm({
        name: skill.name,
        fingerprint: skill.fingerprint,
        inject: snapshot.settings.skills.inject,
        loaded,
      });
      return {
        message: {
          customType: SKILL_MESSAGE_TYPE,
          display: false,
          content: deliveryText(form, skill),
          details: { name: skill.name, fingerprint: skill.fingerprint, form },
        },
      };
    } catch {
      return undefined;
    }
  }

  /** Eligibility, the hold and the record; undefined when no request is due. */
  function prepare(event: BeforeAgentStartEvent, ctx: Ctx): Prepared | undefined {
    if (event.messageType !== "user" || event.prompt.trim() === "") return undefined;
    const sessionId = ctx.sessionManager.getSessionId();
    if (isChild(sessionId)) return undefined;
    const snapshot = deps.load();
    if (!snapshot.config.valid || !snapshot.keySet) return undefined;
    const model = ctx.model;
    if (model === undefined) return undefined;
    const apiKey = deps.env()[snapshot.keyVar];
    if (apiKey === undefined || apiKey === "") return undefined;
    const effortOn = snapshot.settings.switches.effort;
    const skills = planSkills(event.prompt, snapshot);
    if (!effortOn && skills === undefined) return undefined;

    const supported = supportedLevels({
      reasoning: model.reasoning,
      thinkingLevelMap: (model as { thinkingLevelMap?: never }).thinkingLevelMap,
    });
    const entries = ctx.sessionManager.getBranch();
    const { anchor, compactionId } = holdContext(entries);
    const provider = typeof model.provider === "string" ? model.provider : undefined;
    const modelId = typeof model.id === "string" ? model.id : undefined;
    const held =
      effortOn &&
      isHeld({
        provider,
        model: modelId,
        holdProviders: snapshot.settings.effort.holdProviders,
        anchor,
      });
    const askEffort = effortOn && !held && canAskEffort(supported);
    const batches = skills?.batches ?? [];
    const first = batches[0];
    const questions =
      first === undefined
        ? mainQuestions({ askEffort })
        : mainQuestions({ askEffort, skills: first });
    const state = mainState({
      prompt: event.prompt,
      items: branchItems(entries),
      platforms: deps.platforms(ctx.cwd),
    });
    const prev = previousTurnId(entries);
    const from = level();
    const at = deps.now();
    const rec: TurnRecord = {
      turnId: deps.newId(),
      at,
      sessionId,
      mode: snapshot.settings.mode,
      from,
      ...(prev === undefined ? {} : { previousTurnId: prev }),
      ...(held ? { held: true as const } : {}),
      ...(provider === undefined ? {} : { provider }),
      ...(modelId === undefined ? {} : { model: modelId }),
      ...(compactionId === undefined ? {} : { compactionId }),
      answered: false,
      ms: 0,
      sawRequest: false,
      toolCalls: 0,
      failures: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    record = rec;
    undo = { rec, ctx, snapshot, previous: current, drew: false };
    return {
      rec,
      snapshot,
      apiKey,
      supported,
      held,
      askEffort,
      questions,
      state,
      batches,
      effortOn,
    };
  }

  /** Skill batches for this prompt; undefined when skills do not apply. A read failure means they do not. */
  function planSkills(
    prompt: string,
    snapshot: Snapshot,
  ): { batches: CatalogSkill[][] } | undefined {
    if (!snapshot.settings.switches.skills || explicitSkill(prompt) !== undefined) return undefined;
    try {
      const catalog = readCatalog(deps.commands(), deps.readFile);
      const byName = new Map(catalog.map((skill) => [skill.name, skill]));
      const batches = skillBatches(catalog).map((batch) =>
        batch.flatMap((entry) => {
          const skill = byName.get(entry.name);
          return skill === undefined ? [] : [skill];
        }),
      );
      return batches.length === 0 ? undefined : { batches };
    } catch {
      return undefined;
    }
  }

  /** One request per later batch, all started now; a rejection counts as a miss. */
  function askBatches(
    batches: readonly CatalogSkill[][],
    common: Omit<Parameters<typeof askJev>[0], "questions">,
  ): Promise<JevOutcome>[] {
    return batches.map((batch) =>
      deps.ask({ ...common, questions: skillBatchQuestions(batch).wire }).catch((): JevOutcome => ({
        kind: "miss",
        miss: "error",
        reason: "request failed",
        ms: 0,
      })),
    );
  }

  /** Read the answers and set the thinking level; records the outcome on `rec`. */
  function applyEffort(
    p: Prepared,
    ctx: Ctx,
    outcome: Answered,
    read: ReadResult | undefined,
  ): void {
    const { rec, snapshot, supported, askEffort } = p;
    const from = rec.from;
    // A skills-only turn has no level to show, so a miss leaves the status alone.
    const miss = (kind: string): void => {
      rec.miss = kind;
      if (p.effortOn) setDecision(rec, ctx, snapshot, { kind: "no-answer" });
    };
    if (outcome.kind === "miss") return miss(outcome.miss);
    if (read === undefined || read.kind === "miss") return miss("schema");
    rec.answered = true;
    const effort = read.answers["effort"];
    const risky = read.answers["risky"];
    const corrects = read.answers["corrects"];
    if (risky?.type === "noul") rec.risky = risky.noul;
    if (corrects?.type === "noul") rec.corrects = corrects.noul;
    if (effort?.type !== "choice") {
      if (askEffort) setDecision(rec, ctx, snapshot, { kind: "no-answer" });
      return;
    }
    rec.effortP = effort.probabilities;
    const { requested, target } = decideEffort({
      choice: effort.choice as EffortLevel,
      ...(rec.risky === undefined ? {} : { risky: rec.risky }),
      supported,
    });
    rec.requested = requested;

    // Operator changed the level (or the model) during the wait: discard, keep the old suffix.
    if (level() !== from) return;
    if (from === "max") {
      rec.effective = "max";
      setDecision(rec, ctx, snapshot, { kind: "level", level: "max" });
      return;
    }
    if (target !== from) pi.setThinkingLevel(target as never);
    rec.effective = level();
    rec.applied = rec.effective;
    setDecision(rec, ctx, snapshot, { kind: "level", level: rec.effective });
  }

  /** A held prompt keeps the level: record the classifier outcome, never touch the thinking level. */
  function holdOutcome(
    rec: TurnRecord,
    ctx: Ctx,
    snapshot: Snapshot,
    outcome: Answered,
    read: ReadResult | undefined,
  ): void {
    if (outcome.kind === "miss") {
      rec.miss = outcome.miss;
    } else if (read === undefined || read.kind === "miss") {
      rec.miss = "schema";
    } else {
      rec.answered = true;
      const corrects = read.answers["corrects"];
      if (corrects?.type === "noul") rec.corrects = corrects.noul;
    }
    rec.effective = level();
    setDecision(rec, ctx, snapshot, { kind: "level", level: rec.effective });
  }

  async function beforeProviderRequest(): Promise<undefined> {
    try {
      if (record !== undefined) record.sawRequest = true;
    } catch {
      /* swallow */
    }
    return undefined;
  }

  async function turnEnd(event: TurnEndEvent): Promise<void> {
    try {
      if (record === undefined) return;
      const results = event.toolResults ?? [];
      record.toolCalls += results.length;
      record.failures += results.filter((r) => r.isError === true).length;
      const usage = (event.message as { usage?: { input?: unknown; output?: unknown } }).usage;
      if (typeof usage?.input === "number") record.inputTokens += usage.input;
      if (typeof usage?.output === "number") record.outputTokens += usage.output;
      const stop = (event.message as { stopReason?: unknown }).stopReason;
      if (typeof stop === "string") record.lastStop = stop;
    } catch {
      /* swallow */
    }
  }

  function lastBranchStop(ctx: Ctx | undefined): string | undefined {
    try {
      const entries = ctx?.sessionManager.getBranch() ?? [];
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i]!;
        if (e.type !== "message") continue;
        const m = e.message as { role?: string; stopReason?: unknown };
        if (m.role === "assistant")
          return typeof m.stopReason === "string" ? m.stopReason : undefined;
      }
    } catch {
      /* no fallback */
    }
    return undefined;
  }

  /** `jev-turn` data: the hold anchor rides along only for a decided turn on an unchanged compaction. */
  function turnData(rec: TurnRecord, ctx: Ctx | undefined): Record<string, unknown> {
    const plain = { turnId: rec.turnId };
    if (
      rec.held === true ||
      rec.effective === undefined ||
      typeof rec.provider !== "string" ||
      typeof rec.model !== "string" ||
      ctx === undefined
    ) {
      return plain;
    }
    try {
      const { compactionId } = holdContext(ctx.sessionManager.getBranch());
      if (compactionId !== rec.compactionId) return plain;
      return {
        ...plain,
        decided: { provider: rec.provider, model: rec.model, level: rec.effective },
      };
    } catch {
      return plain;
    }
  }

  /** Correction line, `main` line, then the `jev-turn` entry. A failed ledger write never skips the entry. */
  function write(rec: TurnRecord, aborted: boolean, ctx: Ctx | undefined): void {
    const base = { v: 1, at: rec.at, session: rec.sessionId };
    try {
      if (
        rec.corrects !== undefined &&
        rec.corrects >= CORRECTION_THRESHOLD &&
        rec.previousTurnId !== undefined
      ) {
        deps.append({
          ...base,
          kind: "correction",
          turnId: rec.previousTurnId,
          corrects: rec.corrects,
        });
      }
    } catch {
      /* the main line still goes */
    }
    try {
      const stop = rec.lastStop ?? lastBranchStop(ctx);
      const outcome = aborted ? "aborted" : stop === "error" ? "error" : "ok";
      deps.append({
        ...base,
        kind: "main",
        mode: rec.mode,
        answered: rec.answered,
        turnId: rec.turnId,
        ...(rec.held === true ? { held: true } : {}),
        ...(rec.answered || rec.miss !== undefined ? { ms: rec.ms } : {}),
        ...(rec.miss === undefined ? {} : { miss: rec.miss }),
        ...(rec.effortP === undefined ? {} : { effortP: rec.effortP }),
        ...(rec.risky === undefined ? {} : { risky: rec.risky }),
        ...(rec.corrects === undefined ? {} : { corrects: rec.corrects }),
        ...(rec.skill === undefined ? {} : { skill: rec.skill }),
        ...(rec.skillP === undefined ? {} : { skillP: rec.skillP }),
        ...(rec.gate === undefined ? {} : { gate: rec.gate }),
        ...(rec.requested === undefined ? {} : { requested: rec.requested }),
        ...(rec.effective === undefined ? {} : { effective: rec.effective }),
        from: rec.from,
        toolCalls: rec.toolCalls,
        failures: rec.failures,
        inputTokens: rec.inputTokens,
        outputTokens: rec.outputTokens,
        durationMs: Math.max(0, deps.now() - rec.at),
        outcome,
      });
    } catch {
      /* ledger failure never affects the turn */
    }
    try {
      pi.appendEntry("jev-turn", turnData(rec, ctx));
    } catch {
      /* swallow */
    }
  }

  async function agentSettled(event: AgentSettledEvent): Promise<void> {
    try {
      const rec = record;
      if (rec === undefined) return;
      if (event.aborted && !rec.sawRequest) {
        // Esc during classification: restore the level the package applied, unless the operator moved it.
        if (rec.applied !== undefined && rec.applied !== rec.from && level() === rec.applied) {
          pi.setThinkingLevel(rec.from as never);
        }
        // Nothing ran: put the status back as it was before this turn.
        if (undo?.rec === rec && undo.drew) {
          current = undo.previous;
          drawStatus(undo.ctx, undo.snapshot, undo.previous);
        }
        record = undefined;
        undo = undefined;
        return;
      }
      const ctx = undo?.rec === rec ? undo.ctx : undefined;
      record = undefined;
      undo = undefined;
      write(rec, event.aborted, ctx);
    } catch {
      record = undefined;
      undo = undefined;
    }
  }

  return {
    beforeAgentStart,
    beforeProviderRequest,
    turnEnd,
    agentSettled,
    sessionStart: (): void => {
      // A run from the replaced session may still settle; it must not touch the new one.
      current = undefined;
      record = undefined;
      undo = undefined;
    },
    decision: (): Decision | undefined => current,
  };
}
