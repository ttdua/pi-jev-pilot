import type {
  AgentSettledEvent,
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionContext,
  TurnEndEvent,
} from "@earendil-works/pi-coding-agent";
import type { askJev } from "../jev/client.ts";
import { mainQuestions } from "../jev/questions.ts";
import { mainState } from "../jev/state.ts";
import { readAnswers } from "../policy/answers.ts";
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
import { drawStatus, withDecision, type Decision } from "./status.ts";

export type MainDeps = {
  load: () => Snapshot;
  ask: typeof askJev;
  append: (entry: unknown) => WriteResult;
  now: () => number;
  newId: () => string;
  platforms: (cwd: string) => string[];
  env: () => Record<string, string | undefined>;
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

  async function beforeAgentStart(event: BeforeAgentStartEvent, ctx: Ctx): Promise<undefined> {
    const mine: { rec?: TurnRecord } = {};
    try {
      await decide(event, ctx, mine);
    } catch {
      // A failure before the apply leaves the level unchanged; after it the applied level stays.
      // Only this run's own record is dropped, never a newer one.
      if (mine.rec !== undefined && record === mine.rec && mine.rec.applied === undefined) {
        record = undefined;
        undo = undefined;
      }
    }
    return undefined;
  }

  async function decide(
    event: BeforeAgentStartEvent,
    ctx: Ctx,
    mine: { rec?: TurnRecord },
  ): Promise<void> {
    if (event.messageType !== "user" || event.prompt.trim() === "") return;
    const sessionId = ctx.sessionManager.getSessionId();
    if (isChild(sessionId)) return;
    const snapshot = deps.load();
    if (!snapshot.config.valid || !snapshot.keySet || !snapshot.settings.switches.effort) return;
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
    const held = isHeld({
      provider,
      model: modelId,
      holdProviders: snapshot.settings.effort.holdProviders,
      anchor,
    });
    const askEffort = !held && canAskEffort(supported);
    const questions = mainQuestions({ askEffort, askStrategy: false });
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
    undo = { rec, ctx, snapshot, previous: current, drew: false };

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
      return;
    }
    rec.ms = outcome.ms;
    if (held) {
      holdOutcome(rec, ctx, snapshot, outcome, questions.specs);
      return;
    }
    if (outcome.kind === "miss") {
      rec.miss = outcome.miss;
      setDecision(
        rec,
        ctx,
        snapshot,
        withDecision(current, { kind: "no-answer" }, current?.advice),
      );
      return;
    }
    const read = readAnswers(questions.specs, outcome.body);
    if (read.kind === "miss") {
      rec.miss = read.miss;
      setDecision(
        rec,
        ctx,
        snapshot,
        withDecision(current, { kind: "no-answer" }, current?.advice),
      );
      return;
    }
    rec.answered = true;
    const effort = read.answers["effort"];
    const risky = read.answers["risky"];
    const corrects = read.answers["corrects"];
    if (risky?.type === "noul") rec.risky = risky.noul;
    if (corrects?.type === "noul") rec.corrects = corrects.noul;
    if (effort?.type !== "choice") {
      if (askEffort)
        setDecision(
          rec,
          ctx,
          snapshot,
          withDecision(current, { kind: "no-answer" }, current?.advice),
        );
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
      setDecision(
        rec,
        ctx,
        snapshot,
        withDecision(current, { kind: "level", level: "max" }, current?.advice),
      );
      return;
    }
    if (target !== from) pi.setThinkingLevel(target as never);
    rec.effective = level();
    rec.applied = rec.effective;
    setDecision(
      rec,
      ctx,
      snapshot,
      withDecision(current, { kind: "level", level: rec.effective }, current?.advice),
    );
  }

  /** A held prompt keeps the level: record the classifier outcome, never touch the thinking level. */
  function holdOutcome(
    rec: TurnRecord,
    ctx: Ctx,
    snapshot: Snapshot,
    outcome: Exclude<Awaited<ReturnType<typeof askJev>>, { kind: "cancelled" }>,
    specs: ReturnType<typeof mainQuestions>["specs"],
  ): void {
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
      }
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
