import type {
  AgentSettledEvent,
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ExtensionAPI,
  TurnEndEvent,
} from "@earendil-works/pi-coding-agent";
import type { Ctx, MainDeps, MainHost } from "./main-host.ts";
import { addTurnEnd, type TurnRecord } from "../policy/main/index.ts";
import { MainSession } from "./main-session.ts";
import type { Snapshot } from "./readiness.ts";
import { settleRun } from "./main-settled.ts";
import { startTurn } from "./main-start.ts";
import type { Decision } from "./status.ts";

export type { MainDeps } from "./main-host.ts";

/**
 * The main-session handlers. Every handler fails open: a throw leaves Pi as it would run
 * without the package. The units it wires: `main-start` (gate, ask, apply), `main-settled`
 * (ledger lines, abort undo) and `MainSession` (the only mutable state).
 */
export function createMain(pi: ExtensionAPI, deps: MainDeps) {
  const session = new MainSession<Ctx, Snapshot>();
  const host: MainHost = { pi, deps, session };

  async function beforeAgentStart(
    event: BeforeAgentStartEvent,
    ctx: Ctx,
  ): Promise<BeforeAgentStartEventResult | undefined> {
    const mine: { rec?: TurnRecord } = {};
    try {
      return await startTurn(host, event, ctx, mine);
    } catch {
      // A failure before the apply leaves the level unchanged; after it the applied level stays.
      // Only this run's own record is dropped, never a newer one.
      session.dropUnapplied(mine.rec);
      return undefined;
    }
  }

  async function beforeProviderRequest(): Promise<undefined> {
    const rec = session.record;
    if (rec !== undefined) rec.sawRequest = true;
    return undefined;
  }

  async function turnEnd(event: TurnEndEvent): Promise<void> {
    try {
      const rec = session.record;
      if (rec !== undefined) addTurnEnd(rec, event);
    } catch {
      /* fail open: the counts stay as they were */
    }
  }

  async function agentSettled(event: AgentSettledEvent): Promise<void> {
    try {
      settleRun(host, event.aborted);
    } catch {
      session.clearTurn(); // never leave a stale record behind
    }
  }

  return {
    beforeAgentStart,
    beforeProviderRequest,
    turnEnd,
    agentSettled,
    // A run from the replaced session may still settle; it must not touch the new one.
    sessionStart: (): void => session.reset(),
    decision: (): Decision | undefined => session.current,
    overlay: (): string | undefined => session.overlay,
  };
}
