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
import { mainState } from "../jev/state.ts";
import { readAnswers, type Answer } from "../policy/answers.ts";
import { isHeld } from "../policy/hold.ts";
import {
  CORRECTION_THRESHOLD,
  canAskEffort,
  decideEffort,
  supportedLevels,
  type EffortLevel,
  type ThinkingLevel,
} from "../policy/effort.ts";
import { adviseStrategy, type Strategy } from "../policy/strategy.ts";
import type { WriteResult } from "../store/validate.ts";
import { isChild } from "./child.ts";
import { branchItems, holdContext, previousTurnId } from "./context.ts";
import type { Snapshot } from "./readiness.ts";
import { drawStatus, withDecision, type Decision } from "./status.ts";

export type MainDeps = {
  load: () => Snapshot;
  ask: typeof askJev;
  append: (entry: unknown) => WriteResult;
  now: () => number;
  newId: () => string;
  platforms: (cwd: string) => string[];
  env: () => Record<string, string | undefined>;
  /** Compact tally for the status line when this prompt is a multiple of 10, else `undefined`. */
  tallyText?: () => string | undefined;
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
  strategy?: Strategy;
  strategyP?: number;
  advised?: boolean;
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

type Ctx = Pick<
  ExtensionContext,
  "cwd" | "hasUI" | "mode" | "model" | "sessionManager" | "signal" | "ui"
>;

export function createMain(pi: ExtensionAPI, deps: MainDeps) {
  let record: TurnRecord | undefined;
  let current: Decision | undefined;
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
    const snapshot = deps.load();
    if (
      !snapshot.config.valid ||
      !snapshot.keySet ||
      !(snapshot.settings.switches.effort || snapshot.settings.switches.strategy)
    )
      return;
    const model = ctx.model;
    if (model === undefined) return;
    const apiKey = deps.env()[snapshot.keyVar];
    if (apiKey === undefined || apiKey === "") return;

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
    const askEffort = snapshot.settings.switches.effort && !held && canAskEffort(supported);
    const askStrategy = snapshot.settings.switches.strategy;
    const questions = mainQuestions({ askEffort, askStrategy });
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
    mine.rec = rec;
    undo = { rec, ctx, snapshot, previous: current, previousOverlay: overlay, drew: false };

    const outcome = await deps.ask({
      url: snapshot.settings.classifier.url,
      apiKey,
      model: snapshot.settings.classifier.model,
      timeoutMs: snapshot.settings.classifier.timeoutMs,
      state,
      questions: questions.wire,
      ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
    });

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
      return applyOutcome(
        { rec, ctx, snapshot, held, askEffort, askStrategy, supported, from },
        outcome,
        questions.specs,
      );
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

  type Turn = {
    rec: TurnRecord;
    ctx: Ctx;
    snapshot: Snapshot;
    held: boolean;
    askEffort: boolean;
    askStrategy: boolean;
    supported: ReturnType<typeof supportedLevels>;
    from: ThinkingLevel;
  };

  /** Records the classifier outcome and, when the turn is decided, applies and draws the result. */
  function applyOutcome(
    turn: Turn,
    outcome: Exclude<Awaited<ReturnType<typeof askJev>>, { kind: "cancelled" }>,
    specs: ReturnType<typeof mainQuestions>["specs"],
  ): BeforeAgentStartEventResult | undefined {
    const { rec, ctx, snapshot, held, askEffort, askStrategy, supported, from } = turn;
    if (held) return holdOutcome(rec, ctx, snapshot, outcome, specs, askStrategy);
    if (outcome.kind === "miss") {
      rec.miss = outcome.miss;
      setDecision(rec, ctx, snapshot, withDecision(current, { kind: "no-answer" }, undefined));
      return;
    }
    const read = readAnswers(specs, outcome.body);
    if (read.kind === "miss") {
      rec.miss = read.miss;
      setDecision(rec, ctx, snapshot, withDecision(current, { kind: "no-answer" }, undefined));
      return;
    }
    rec.answered = true;
    const effort = read.answers["effort"];
    const risky = read.answers["risky"];
    const corrects = read.answers["corrects"];
    const strategy = read.answers["strategy"];
    const tier = read.answers["tier"];
    if (risky?.type === "noul") rec.risky = risky.noul;
    if (corrects?.type === "noul") rec.corrects = corrects.noul;
    const { nextAdvice, message } = applyAdvice(rec, askStrategy, strategy, tier);
    /** Advice-only redraw: the effort part stays as it is. */
    const keepEffort = (): void => {
      if (nextAdvice !== current?.advice)
        setDecision(rec, ctx, snapshot, withDecision(current, current?.effort, nextAdvice));
    };
    if (effort?.type !== "choice") {
      if (askEffort)
        setDecision(rec, ctx, snapshot, withDecision(current, { kind: "no-answer" }, nextAdvice));
      else keepEffort();
      return message;
    }
    rec.effortP = effort.probabilities;
    const { requested, target } = decideEffort({
      choice: effort.choice as EffortLevel,
      ...(rec.risky === undefined ? {} : { risky: rec.risky }),
      supported,
    });
    rec.requested = requested;

    // Operator changed the level (or the model) during the wait: discard, keep the old suffix.
    if (level() !== from) {
      keepEffort();
      return message;
    }
    if (from === "max") {
      rec.effective = "max";
      setDecision(
        rec,
        ctx,
        snapshot,
        withDecision(current, { kind: "level", level: "max" }, nextAdvice),
      );
      return message;
    }
    if (target !== from) pi.setThinkingLevel(target as never);
    rec.effective = level();
    rec.applied = rec.effective;
    setDecision(
      rec,
      ctx,
      snapshot,
      withDecision(current, { kind: "level", level: rec.effective }, nextAdvice),
    );
    return message;
  }

  /**
   * Gates the strategy answer, records it on the turn, and returns the next advice suffix and
   * the hidden message. A turn that did not ask `strategy` keeps the current advice suffix.
   */
  function applyAdvice(
    rec: TurnRecord,
    askStrategy: boolean,
    strategy: Answer | undefined,
    tier: Answer | undefined,
  ): { nextAdvice: Strategy | undefined; message: BeforeAgentStartEventResult | undefined } {
    if (!askStrategy) return { nextAdvice: current?.advice, message: undefined };
    const advice = adviseStrategy({
      ...(strategy?.type === "choice" ? { strategy } : {}),
      ...(tier?.type === "choice" ? { tier: tier.choice } : {}),
    });
    if (advice !== undefined) {
      rec.strategy = advice.strategy;
      rec.strategyP = advice.strategyP;
      rec.advised = advice.advised;
    }
    if (advice?.advised !== true || advice.block === undefined) {
      return { nextAdvice: undefined, message: undefined };
    }
    return {
      nextAdvice: advice.strategy,
      message: { message: { customType: "jev-advice", content: advice.block, display: false } },
    };
  }

  /**
   * A held prompt keeps the level: record the classifier outcome, never touch the thinking level.
   * Strategy advice still applies, as on any other turn; a miss clears the advice suffix.
   */
  function holdOutcome(
    rec: TurnRecord,
    ctx: Ctx,
    snapshot: Snapshot,
    outcome: Exclude<Awaited<ReturnType<typeof askJev>>, { kind: "cancelled" }>,
    specs: ReturnType<typeof mainQuestions>["specs"],
    askStrategy: boolean,
  ): BeforeAgentStartEventResult | undefined {
    let nextAdvice: Strategy | undefined;
    let message: BeforeAgentStartEventResult | undefined;
    if (outcome.kind === "miss") {
      rec.miss = outcome.miss;
    } else {
      const read = readAnswers(specs, outcome.body);
      if (read.kind === "miss") {
        rec.miss = read.miss;
      } else {
        rec.answered = true;
        const corrects = read.answers["corrects"];
        if (corrects?.type === "noul") rec.corrects = corrects.noul;
        ({ nextAdvice, message } = applyAdvice(
          rec,
          askStrategy,
          read.answers["strategy"],
          read.answers["tier"],
        ));
      }
    }
    rec.effective = level();
    setDecision(
      rec,
      ctx,
      snapshot,
      withDecision(current, { kind: "level", level: rec.effective }, nextAdvice),
    );
    return message;
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
        ...(rec.strategy === undefined || rec.strategyP === undefined || rec.advised === undefined
          ? {}
          : { strategy: rec.strategy, strategyP: rec.strategyP, advised: rec.advised }),
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
      record = undefined;
      undo = undefined;
    },
    decision: (): Decision | undefined => current,
    overlay: (): string | undefined => overlay,
  };
}
