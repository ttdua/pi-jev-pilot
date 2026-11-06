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
import {
  canAskEffort,
  decideEffort,
  supportedLevels,
  type EffortLevel,
  type ThinkingLevel,
} from "../policy/effort.ts";
import type { WriteResult } from "../store/validate.ts";
import { isChild } from "./child.ts";
import { branchItems, previousTurnId } from "./context.ts";
import type { Snapshot } from "./readiness.ts";
import { drawStatus, type Decision } from "./status.ts";

export type MainDeps = {
  load: () => Snapshot;
  ask: typeof askJev;
  append: (entry: unknown) => WriteResult;
  now: () => number;
  newId: () => string;
  platforms: (cwd: string) => string[];
  env: () => Record<string, string | undefined>;
};

/** Per-turn bookkeeping. Internal; Task 7 writes the ledger lines from it. */
export type TurnRecord = {
  turnId: string;
  at: number;
  sessionId: string;
  mode: string;
  from: ThinkingLevel;
  previousTurnId?: string;
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
};

type Ctx = Pick<
  ExtensionContext,
  "cwd" | "hasUI" | "mode" | "model" | "sessionManager" | "signal" | "ui"
>;

export function createMain(pi: ExtensionAPI, deps: MainDeps) {
  let record: TurnRecord | undefined;
  let current: Decision | undefined;

  const level = (): ThinkingLevel => pi.getThinkingLevel() as ThinkingLevel;

  function setDecision(ctx: Ctx, snapshot: Snapshot, decision: Decision): void {
    current = decision;
    drawStatus(ctx, snapshot, decision);
  }

  async function beforeAgentStart(event: BeforeAgentStartEvent, ctx: Ctx): Promise<undefined> {
    try {
      await decide(event, ctx);
    } catch {
      // A failure before the apply leaves the level unchanged; after it the applied level stays.
      if (record !== undefined && record.applied === undefined) record = undefined;
    }
    return undefined;
  }

  async function decide(event: BeforeAgentStartEvent, ctx: Ctx): Promise<void> {
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
    const askEffort = canAskEffort(supported);
    const questions = mainQuestions({ askEffort });
    const entries = ctx.sessionManager.getBranch();
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
      answered: false,
      ms: 0,
      sawRequest: false,
      toolCalls: 0,
      failures: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    record = rec;

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
      record = undefined;
      return;
    }
    rec.ms = outcome.ms;
    if (outcome.kind === "miss") {
      rec.miss = outcome.miss;
      setDecision(ctx, snapshot, { kind: "no-answer" });
      return;
    }
    const read = readAnswers(questions.specs, outcome.body);
    if (read.kind === "miss") {
      rec.miss = read.miss;
      setDecision(ctx, snapshot, { kind: "no-answer" });
      return;
    }
    rec.answered = true;
    const effort = read.answers["effort"];
    const risky = read.answers["risky"];
    const corrects = read.answers["corrects"];
    if (risky?.type === "noul") rec.risky = risky.noul;
    if (corrects?.type === "noul") rec.corrects = corrects.noul;
    if (effort?.type !== "choice") {
      if (askEffort) setDecision(ctx, snapshot, { kind: "no-answer" });
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
      setDecision(ctx, snapshot, { kind: "level", level: "max" });
      return;
    }
    if (target !== from) pi.setThinkingLevel(target as never);
    rec.effective = level();
    rec.applied = rec.effective;
    setDecision(ctx, snapshot, { kind: "level", level: rec.effective });
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
        record = undefined;
        return;
      }
      // Task 7: write the correction and `main` ledger lines and the `jev-turn` entry from `rec` here.
      record = undefined;
    } catch {
      record = undefined;
    }
  }

  return {
    beforeAgentStart,
    beforeProviderRequest,
    turnEnd,
    agentSettled,
    sessionStart: (): void => {
      current = undefined;
    },
    decision: (): Decision | undefined => current,
  };
}
