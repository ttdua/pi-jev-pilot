import type {
  AgentSettledEvent,
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ExtensionAPI,
  ExtensionContext,
  TurnEndEvent,
} from "@earendil-works/pi-coding-agent";
import type { askJev } from "../jev/client.ts";
import { mainQuestions } from "../jev/questions.ts";
import { mainState, SHIPPED_MAIN_GROUPS, type RichGroup } from "../jev/state.ts";
import { readAnswers, type ReadResult } from "../policy/answers.ts";
import type { SkillPick } from "../policy/skill.ts";
import { isHeld } from "../policy/hold.ts";
import { canAskEffort, supportedLevels, type ThinkingLevel } from "../policy/effort.ts";
import type { Strategy } from "../policy/strategy.ts";
import type { WriteResult } from "../store/validate.ts";
import type { AgentFacts } from "../policy/launch.ts";
import { isChild } from "./child.ts";
import { branchItems, holdContext, previousTurnId } from "./context.ts";
import type { Snapshot } from "./readiness.ts";
import {
  correctionLine,
  decidedAnchor,
  decidedSummary,
  lastAssistantStop,
  mainLine,
} from "./main-line.ts";
import { planOutcome, type Answered, type OutcomeFlags, type OutcomePlan } from "./main-outcome.ts";
import type { TurnRecord } from "./main-record.ts";

type AnsweredPlan = Extract<OutcomePlan, { kind: "answered" }>;
import {
  askLaterBatches,
  joinMessages,
  pickSkillSafely,
  planSkills,
  skillMessage,
  type CommonRequest,
} from "./main-skills.ts";
import { buildRichInputs } from "./rich.ts";
import type { SkillCommand } from "./skills.ts";
import { drawStatus, withDecision, type Decision } from "./status.ts";

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
  /** Compact tally for the status line when this prompt is a multiple of 10, else `undefined`. */
  tallyText?: () => string | undefined;
  /** Rich state inputs; `groups` defaults to the shipped list. */
  rich?: {
    groups: readonly RichGroup[];
    tools: () => { name: string; description: string }[];
    agents: (cwd: string) => AgentFacts[];
  };
};

type Ctx = Pick<
  ExtensionContext,
  "cwd" | "hasUI" | "mode" | "model" | "sessionManager" | "signal" | "ui"
>;

export function createMain(pi: ExtensionAPI, deps: MainDeps) {
  let record: TurnRecord | undefined;
  let current: Decision | undefined;
  /** What the last settled, answered turn applied; carried to the next prompt. */
  let lastDecided: { effort?: string; strategy?: string } | undefined;
  /** Tally text shown on every 10th prompt until the next eligible prompt's result. */
  let overlay: string | undefined;
  /** Records that already drew during their own `decide` call. */
  const drawnBy = new WeakSet<TurnRecord>();
  /** What an aborted start needs to put the status back. Belongs to `record`. */
  let undo:
    | {
        rec: TurnRecord;
        ctx: Ctx;
        snapshot: Snapshot;
        previous: Decision | undefined;
        previousOverlay: string | undefined;
        drew: boolean;
      }
    | undefined;

  const level = (): ThinkingLevel => pi.getThinkingLevel() as ThinkingLevel;

  /** The only place the status is drawn from a turn; marks the record as having drawn. */
  function draw(rec: TurnRecord, ctx: Ctx, snapshot: Snapshot): void {
    if (undo?.rec === rec) undo.drew = true;
    drawnBy.add(rec);
    drawStatus(ctx, snapshot, current, overlay);
  }

  function setDecision(rec: TurnRecord, ctx: Ctx, snapshot: Snapshot, decision: Decision): void {
    current = decision;
    draw(rec, ctx, snapshot);
  }

  /** Asks for this prompt's tally text. A failure keeps the old overlay. Returns whether it changed. */
  function refreshOverlay(): boolean {
    let next: string | undefined;
    try {
      next = deps.tallyText?.();
    } catch {
      return false;
    }
    if (next === overlay) return false;
    overlay = next;
    return true;
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
    if (event.messageType !== "user" || event.prompt.trim() === "") return;
    const sessionId = ctx.sessionManager.getSessionId();
    if (isChild(sessionId)) return;
    const groups = deps.rich?.groups ?? SHIPPED_MAIN_GROUPS;
    const snapshot = deps.load();
    if (!snapshot.config.valid || !snapshot.keySet) return;
    const model = ctx.model;
    if (model === undefined) return;
    const apiKey = deps.env()[snapshot.keyVar];
    if (apiKey === undefined || apiKey === "") return;
    const effortOn = snapshot.settings.switches.effort;
    const askStrategy = snapshot.settings.switches.strategy;
    // The catalog is read only after every other gate passed.
    const batches =
      effortOn || askStrategy || snapshot.settings.switches.skills
        ? (planSkills(event.prompt, snapshot.settings.switches.skills, deps) ?? [])
        : [];
    if (!effortOn && !askStrategy && batches.length === 0) return;

    const supported = supportedLevels({
      reasoning: model.reasoning,
      thinkingLevelMap: (model as { thinkingLevelMap?: never }).thinkingLevelMap,
    });
    const entries = ctx.sessionManager.getBranch();
    const { anchor, compactionId } = holdContext(entries);
    const provider = typeof model.provider === "string" ? model.provider : undefined;
    const modelId = typeof model.id === "string" ? model.id : undefined;
    // A hold keeps the effort decision, so it applies only while `effort` is on.
    const held =
      snapshot.settings.switches.effort &&
      isHeld({
        provider,
        model: modelId,
        holdProviders: snapshot.settings.effort.holdProviders,
        anchor,
      });
    const askEffort = effortOn && !held && canAskEffort(supported);
    const first = batches[0];
    const questions =
      first === undefined
        ? mainQuestions({ askEffort, askStrategy })
        : mainQuestions({ askEffort, askStrategy, skills: first });
    // `from` and `at` are read before the rich inputs are awaited, so a level change during that wait
    // or the Jev call is seen.
    const from = level();
    const at = deps.now();
    const rich = await buildRichInputs({
      groups,
      cwd: ctx.cwd,
      ...(lastDecided === undefined ? {} : { last: lastDecided }),
      tools: () => deps.rich?.tools() ?? [],
      agents: () => deps.rich?.agents(ctx.cwd) ?? [],
    });
    const state = mainState({
      prompt: event.prompt,
      items: branchItems(entries),
      platforms: deps.platforms(ctx.cwd),
      rich,
    });
    const prev = previousTurnId(entries);
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
    mine.rec = rec;
    undo = { rec, ctx, snapshot, previous: current, previousOverlay: overlay, drew: false };

    const common: CommonRequest = {
      url: snapshot.settings.classifier.url,
      apiKey,
      model: snapshot.settings.classifier.model,
      timeoutMs: snapshot.settings.classifier.timeoutMs,
      state,
      ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
    };
    const asked = deps.ask({ ...common, questions: questions.wire });
    const later = askLaterBatches(deps.ask, batches.slice(1), common);
    const outcome = await asked;

    if (outcome.kind === "cancelled") {
      if (record === rec) {
        record = undefined;
        undo = undefined;
      }
      return undefined;
    }
    rec.ms = outcome.ms;
    const changed = refreshOverlay();
    try {
      const read = outcome.kind === "ok" ? readAnswers(questions.specs, outcome.body) : undefined;
      const pick = await pickSkillSafely(batches, questions.specs, read, later);
      recordPick(rec, pick);
      const skill = skillMessage(pick, batches, {
        inject: snapshot.settings.skills.inject,
        entries: () => ctx.sessionManager.buildSessionProjection().entries,
      });
      const advice = applyOutcome(
        { rec, ctx, snapshot, from },
        { held, effortOn, askEffort, askStrategy, supported },
        outcome,
        read,
      );
      return joinMessages(skill, advice);
    } finally {
      // The overlay changed but no branch drew: show it (or its removal) over the old suffix.
      if (changed && !drawnBy.has(rec)) {
        try {
          draw(rec, ctx, snapshot);
        } catch {
          /* fail open */
        }
      }
    }
  }

  /** Put the pick's name (only when picked), leader probability and gate mean on the record. */
  function recordPick(rec: TurnRecord, pick: SkillPick): void {
    if (pick.kind === "picked") rec.skill = pick.name;
    if ("p" in pick) rec.skillP = pick.p;
    if ("gate" in pick && pick.gate !== undefined) rec.gate = pick.gate;
  }

  type Turn = { rec: TurnRecord; ctx: Ctx; snapshot: Snapshot; from: ThinkingLevel };

  /** Redraws with the given effort part and advice suffix. */
  function show(turn: Turn, effort: Decision["effort"], advice: Strategy | undefined): void {
    setDecision(turn.rec, turn.ctx, turn.snapshot, withDecision(current, effort, advice));
  }

  /** Advice-only redraw: the effort part stays as it is. */
  function keepEffort(turn: Turn, askStrategy: boolean, nextAdvice: Strategy | undefined): void {
    if (askStrategy && nextAdvice !== current?.advice) show(turn, current?.effort, nextAdvice);
  }

  /** Applies the effort target unless the operator moved the level during the wait. */
  function applyTarget(
    turn: Turn,
    target: ThinkingLevel,
    plan: AnsweredPlan,
    askStrategy: boolean,
  ): void {
    const { rec, from } = turn;
    // Operator changed the level (or the model) during the wait: discard, keep the old suffix.
    if (level() !== from) return keepEffort(turn, askStrategy, plan.nextAdvice);
    if (from === "max") {
      rec.effective = "max";
      return show(turn, { kind: "level", level: "max" }, plan.nextAdvice);
    }
    if (target !== from) pi.setThinkingLevel(target as never);
    rec.effective = level();
    rec.applied = rec.effective;
    show(turn, { kind: "level", level: rec.effective }, plan.nextAdvice);
  }

  function applyAnswered(turn: Turn, plan: AnsweredPlan, askStrategy: boolean): void {
    if (plan.effort.kind === "target")
      return applyTarget(turn, plan.effort.target, plan, askStrategy);
    if (plan.effort.showNoAnswer) return show(turn, { kind: "no-answer" }, plan.nextAdvice);
    keepEffort(turn, askStrategy, plan.nextAdvice);
  }

  /** Records the classifier outcome and, when the turn is decided, applies and draws the result. */
  function applyOutcome(
    turn: Turn,
    flags: OutcomeFlags,
    outcome: Answered,
    read: ReadResult | undefined,
  ): BeforeAgentStartEventResult | undefined {
    const plan = planOutcome(flags, outcome, read, current?.advice);
    Object.assign(turn.rec, plan.patch);
    if (plan.kind === "miss") {
      if (plan.showNoAnswer) show(turn, { kind: "no-answer" }, undefined);
      return undefined;
    }
    if (plan.kind === "held") {
      // A held prompt keeps the level; the suffix shows the level as it is.
      turn.rec.effective = level();
      show(turn, { kind: "level", level: turn.rec.effective }, plan.nextAdvice);
      return plan.message;
    }
    applyAnswered(turn, plan, flags.askStrategy);
    return plan.message;
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

  function branchStop(ctx: Ctx | undefined): string | undefined {
    try {
      return lastAssistantStop(ctx?.sessionManager.getBranch() ?? []);
    } catch {
      return undefined; // no fallback: the line reports `ok`
    }
  }

  /** `jev-turn` data: the hold anchor rides along only for a decided turn on an unchanged compaction. */
  function turnData(rec: TurnRecord, ctx: Ctx | undefined): Record<string, unknown> {
    const plain = { turnId: rec.turnId };
    if (ctx === undefined) return plain;
    try {
      const { compactionId } = holdContext(ctx.sessionManager.getBranch());
      const decided = decidedAnchor(rec, compactionId);
      return decided === undefined ? plain : { ...plain, decided };
    } catch {
      return plain; // a branch read failure drops only the anchor
    }
  }

  /** Builds and appends one ledger line; a failure never affects the turn or the next line. */
  function appendSafely(build: () => Record<string, unknown> | undefined): void {
    try {
      const line = build();
      if (line !== undefined) deps.append(line);
    } catch {
      /* ledger failure never affects the turn */
    }
  }

  /** Correction line, `main` line, then the `jev-turn` entry. A failed ledger write never skips the entry. */
  function write(rec: TurnRecord, aborted: boolean, ctx: Ctx | undefined): void {
    lastDecided = decidedSummary(rec) ?? lastDecided;
    appendSafely(() => correctionLine(rec));
    appendSafely(() =>
      mainLine(rec, { stop: rec.lastStop ?? branchStop(ctx), aborted, now: deps.now() }),
    );
    try {
      pi.appendEntry("jev-turn", turnData(rec, ctx));
    } catch {
      /* the session entry is best effort */
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
          overlay = undo.previousOverlay;
          drawStatus(undo.ctx, undo.snapshot, current, overlay);
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
      overlay = undefined;
      lastDecided = undefined;
      record = undefined;
      undo = undefined;
    },
    decision: (): Decision | undefined => current,
    overlay: (): string | undefined => overlay,
  };
}
