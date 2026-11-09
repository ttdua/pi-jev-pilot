import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { askJev } from "../../jev/client.ts";
import type { RichGroup } from "../../jev/state.ts";
import type { ThinkingLevel } from "../../policy/effort.ts";
import type { AgentFacts } from "../../policy/launch.ts";
import type { Strategy } from "../../policy/main/index.ts";
import type { WriteResult } from "../../store/validate.ts";
import type { TurnRecord } from "../../policy/main/index.ts";
import type { MainSession } from "./session.ts";
import type { Snapshot } from "../platform/index.ts";
import type { SkillCommand } from "./catalog.ts";
import { drawStatus, withDecision, type Decision } from "../status/index.ts";

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

export type Ctx = Pick<
  ExtensionContext,
  "cwd" | "hasUI" | "mode" | "model" | "sessionManager" | "signal" | "ui"
>;

/** What every main handler shares: Pi, the injected deps and the session state. */
export type MainHost = {
  pi: Pick<ExtensionAPI, "getThinkingLevel" | "setThinkingLevel" | "appendEntry">;
  deps: MainDeps;
  session: MainSession<Ctx, Snapshot>;
};

/** One decided turn, as the apply step sees it. */
export type Turn = { rec: TurnRecord; ctx: Ctx; snapshot: Snapshot; from: ThinkingLevel };

export const thinkingLevel = (host: MainHost): ThinkingLevel =>
  host.pi.getThinkingLevel() as ThinkingLevel;

/** The only place the status is drawn from a turn; marks the record as having drawn. */
export function drawTurn(host: MainHost, turn: Pick<Turn, "rec" | "ctx" | "snapshot">): void {
  const { session } = host;
  session.markDrawn(turn.rec);
  drawStatus(turn.ctx, turn.snapshot, session.current, session.overlay);
}

/** Sets the decision to the given effort part and advice suffix, then redraws. */
export function showDecision(
  host: MainHost,
  turn: Turn,
  effort: Decision["effort"],
  advice: Strategy | undefined,
): void {
  host.session.decide(turn.rec, withDecision(host.session.current, effort, advice));
  drawTurn(host, turn);
}
