import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { LaunchRequest } from "@ttdua/pi-subagents";
import type { askJev, JevOutcome, JevRequest } from "../../jev/client.ts";
import { buildToolQuestions } from "../../jev/questions.ts";
import { buildToolState } from "../../jev/state.ts";
import type { QuestionSpec } from "../../policy/answers.ts";
import { flaggedTools, grantedTools, type ToolPlan } from "../../policy/tools/index.ts";
import { readWorkerOutcome } from "../../policy/worker/index.ts";
import { agentFacts, type Snapshot } from "../platform/index.ts";
import type { ToolDecision } from "./counts.ts";
import { toolFacts, type ToolFacts } from "./facts.ts";

/** What a launch's tool assessment needs from the policy call. */
export type AssessCall = {
  request: LaunchRequest;
  snap: Snapshot;
  plan: ToolPlan;
  signal: AbortSignal;
  /** Milliseconds left of the classifier deadline shared with the worker request. */
  remainingMs: () => number;
};

/** What asking about tools needs besides the call. */
export type AssessDeps = {
  ask: typeof askJev;
  pi: Pick<ExtensionAPI, "getAllTools">;
  /** The API key value for the snapshot's key variable. */
  apiKey: (keyVar: string) => string;
};

const MISSING = (name: string): ToolFacts => ({
  name,
  description: "",
  source: "unknown",
  parameters: {},
});

/** Pi's metadata for each name; a name or the whole list Pi cannot give falls back to empty facts. */
function toolMetadata(
  pi: Pick<ExtensionAPI, "getAllTools">,
  names: readonly string[],
): ToolFacts[] {
  const byName = new Map<string, ToolFacts>();
  try {
    for (const info of pi.getAllTools() as unknown[]) {
      const facts = toolFacts(info);
      if (facts !== undefined) byName.set(facts.name, facts);
    }
  } catch {
    /* every tool falls back to empty facts */
  }
  return names.map((name) => byName.get(name) ?? MISSING(name));
}

type Request = { req: JevRequest; specs: Record<string, QuestionSpec> };

function buildRequest(call: AssessCall, deps: AssessDeps): Request {
  const { request, snap, plan } = call;
  const { questions, specs } = buildToolQuestions(plan.block, plan.grant);
  const state = buildToolState({
    brief: request.prompt,
    description: request.description,
    agent: agentFacts(request.agent),
    tools: toolMetadata(deps.pi, [...plan.block, ...plan.grant]),
  });
  const { settings, keyVar } = snap;
  return {
    req: {
      url: settings.classifier.url,
      apiKey: deps.apiKey(keyVar),
      model: settings.classifier.model,
      timeoutMs: call.remainingMs(),
      state,
      questions,
      signal: call.signal,
    },
    specs,
  };
}

/** Jev's outcome as a decision; anything but a read answer decides nothing. */
function decide(outcome: JevOutcome, specs: Record<string, QuestionSpec>, call: AssessCall) {
  const read = readWorkerOutcome(outcome, specs);
  if (read.kind !== "read") return undefined;
  const { plan, snap } = call;
  return {
    mode: snap.settings.tools.mode,
    scored: [...plan.block, ...plan.grant],
    flagged: flaggedTools(read.answers, plan.block),
    granted: grantedTools(read.answers, plan.grant, snap.settings.tools.grantAt),
  } satisfies ToolDecision;
}

/**
 * Asks Jev about a launch's candidate tools and decides which are flagged and granted, under the
 * mode read now. Undefined for a miss, a cancel, an unreadable answer or any error: tools stay.
 */
export async function assessTools(
  call: AssessCall,
  deps: AssessDeps,
): Promise<ToolDecision | undefined> {
  try {
    const { req, specs } = buildRequest(call, deps);
    // Called detached: `ask` never receives a `this`.
    const { ask } = deps;
    return decide(await ask(req), specs, call);
  } catch {
    return undefined;
  }
}
