import {
  getAgentDir,
  type BeforeAgentStartEvent,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { askJev, type JevOutcome, type JevRequest } from "../jev/client.ts";
import { buildToolQuestions } from "../jev/questions.ts";
import { buildToolState } from "../jev/state.ts";
import type { QuestionSpec } from "../policy/answers.ts";
import type { AgentFacts } from "../policy/launch.ts";
import { flaggedTools, toolCandidates, toolCounts } from "../policy/tools.ts";
import { readWorkerOutcome } from "../policy/worker.ts";
import { readAgent } from "./agents.ts";
import { isChild } from "./child.ts";
import { loadSnapshot, type Snapshot } from "./readiness.ts";
import { putToolCounts } from "./tool-counts.ts";
import { toolFacts, type ToolFacts } from "./tool-facts.ts";
import { mainService, type ServiceLike } from "./tool-service.ts";

export type ToolAssessmentDeps = {
  ask?: typeof askJev;
  snapshot?: () => Snapshot;
  agentDir?: string;
  service?: () => ServiceLike | undefined;
};

export type ToolAssessment = {
  beforeAgentStart(event: BeforeAgentStartEvent, ctx: ExtensionContext): Promise<void>;
  /** Forget a session's stored decision; its next first call assesses again. */
  dispose(sessionId: string): void;
};

type ToolMode = "observe" | "enforce";
/** What a session's first call decided; later calls only replay it. */
type Outcome = { kind: "none" } | { kind: "done"; mode: ToolMode; flagged: Set<string> };
const NONE: Outcome = { kind: "none" };

type WorkerRecord = { id: string; type: unknown; description: string };

/** Everything the gate lets through: a user-started first run with tools to look at. */
type Gate = {
  snap: Snapshot;
  service: ServiceLike;
  brief: string;
  selected: string[];
  file: string;
};

/** Gate on conditions read fresh at the first call; undefined means "do nothing". */
function openGate(
  event: BeforeAgentStartEvent,
  ctx: ExtensionContext,
  snap: Snapshot,
  service: ServiceLike | undefined,
): Gate | undefined {
  if (!snap.config.valid || !snap.keySet || !snap.settings.switches.tools) return undefined;
  if (service === undefined) return undefined;
  if (event.messageType !== "user" || typeof event.prompt !== "string" || event.prompt === "") {
    return undefined;
  }
  const selected = event.systemPromptOptions?.selectedTools;
  if (!Array.isArray(selected)) return undefined;
  const file = ctx.sessionManager.getSessionFile();
  if (typeof file !== "string" || file === "") return undefined;
  return { snap, service, brief: event.prompt, selected, file };
}

/** The one executor record whose `outputFile` is this session's file. */
function findRecord(service: ServiceLike, file: string): WorkerRecord | undefined {
  const matches = service
    .listAgents()
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .filter((r) => r["outputFile"] === file);
  const [only] = matches;
  if (matches.length !== 1 || only === undefined || typeof only["id"] !== "string") {
    return undefined;
  }
  const description = only["description"];
  return {
    id: only["id"],
    type: only["type"],
    description: typeof description === "string" ? description : "",
  };
}

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

type Request = { req: JevRequest; scored: string[]; specs: Record<string, QuestionSpec> };

function buildRequest(
  gate: Gate,
  agent: AgentFacts,
  record: WorkerRecord,
  tools: ToolFacts[],
  scored: string[],
): Request {
  const { questions, specs } = buildToolQuestions(scored);
  const { settings, keyVar } = gate.snap;
  const state = buildToolState({
    brief: gate.brief,
    description: record.description,
    agent,
    tools,
  });
  return {
    req: {
      url: settings.classifier.url,
      apiKey: process.env[keyVar] ?? "",
      model: settings.classifier.model,
      timeoutMs: settings.classifier.timeoutMs,
      state,
      questions,
    },
    scored,
    specs,
  };
}

/** Turn Jev's outcome into a stored decision; counts are handed over only for a read answer. */
function decide(outcome: JevOutcome, request: Request, mode: ToolMode, agentId: string): Outcome {
  const read = readWorkerOutcome(outcome, request.specs);
  if (read.kind !== "read") return NONE;
  const flagged = flaggedTools(read.answers, request.scored);
  putToolCounts(agentId, toolCounts(request.scored, flagged));
  return { kind: "done", mode, flagged };
}

/** Remove flagged names in place, as `hideReviewInChild` does. */
function spliceFlagged(selected: unknown, flagged: ReadonlySet<string>): void {
  if (!Array.isArray(selected)) return;
  for (let i = selected.length - 1; i >= 0; i--) {
    if (flagged.has(selected[i] as string)) selected.splice(i, 1);
  }
}

export function createToolAssessment(
  pi: Pick<ExtensionAPI, "getAllTools">,
  deps: ToolAssessmentDeps = {},
): ToolAssessment {
  const ask = deps.ask ?? askJev;
  const snapshot = deps.snapshot ?? (() => loadSnapshot(pi));
  const service = deps.service ?? mainService;
  const outcomes = new Map<string, Outcome>();

  /** First call of a session: everything up to and including the request. */
  async function assess(event: BeforeAgentStartEvent, ctx: ExtensionContext): Promise<Outcome> {
    const gate = openGate(event, ctx, snapshot(), service());
    if (gate === undefined) return NONE;
    const record = findRecord(gate.service, gate.file);
    if (record === undefined) return NONE;
    const agent = readAgent(record.type, {
      cwd: ctx.cwd,
      agentDir: deps.agentDir ?? getAgentDir(),
    });
    if (agent.declaredTools !== null) return NONE;
    const { scored } = toolCandidates(gate.selected.filter((n) => typeof n === "string"));
    if (scored.length === 0) return NONE;
    const request = buildRequest(gate, agent, record, toolMetadata(pi, scored), scored);
    const outcome = await ask(request.req);
    return decide(outcome, request, gate.snap.settings.tools.mode, record.id);
  }

  return {
    async beforeAgentStart(event, ctx): Promise<void> {
      try {
        const sessionId = ctx.sessionManager.getSessionId();
        if (!isChild(sessionId)) return;
        let outcome = outcomes.get(sessionId);
        if (outcome === undefined) {
          outcome = await assess(event, ctx).catch((): Outcome => NONE);
          outcomes.set(sessionId, outcome);
        }
        if (outcome.kind === "done" && outcome.mode === "enforce") {
          spliceFlagged(event.systemPromptOptions?.selectedTools, outcome.flagged);
        }
      } catch {
        /* fail open: every tool stays */
      }
    },
    dispose(sessionId): void {
      outcomes.delete(sessionId);
    },
  };
}
