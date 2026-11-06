import { cutCodePoints } from "../shared/text.ts";
import type { AgentFacts } from "../policy/launch.ts";

export type WorkerStateInput = {
  brief: string;
  description?: string;
  agent: AgentFacts;
  runInBackground: boolean;
  parentRequest?: string;
};

export type WorkerState = {
  task: { brief: string; description: string };
  agent: {
    name: string;
    source: AgentFacts["source"];
    description: string;
    instructions_excerpt: string;
    declared_tools: string[] | null;
    max_turns: number | null;
    run_in_background: boolean;
  };
  parent_request?: string;
};

const BRIEF_MAX = 4000;
const PARENT_REQUEST_MAX = 500;

/** Builds the worker state sent to Jev. Model and thinking are never part of it. */
export function buildWorkerState(input: WorkerStateInput): WorkerState {
  const { agent } = input;
  const state: WorkerState = {
    task: {
      brief: cutCodePoints(input.brief, BRIEF_MAX),
      description: input.description ?? "",
    },
    agent: {
      name: agent.name,
      source: agent.source,
      description: agent.description,
      instructions_excerpt: agent.instructionsExcerpt,
      declared_tools: agent.declaredTools,
      max_turns: agent.maxTurns,
      run_in_background: input.runInBackground,
    },
  };
  if (typeof input.parentRequest === "string") {
    state.parent_request = cutCodePoints(input.parentRequest, PARENT_REQUEST_MAX);
  }
  return state;
}
