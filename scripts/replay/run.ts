// Sends planned requests to Jev. I/O and concurrency only; aggregation lives in compare.ts.
import { askJev } from "../../src/jev/client.ts";
import { readAnswers } from "../../src/policy/answers.ts";
import type { Result } from "./compare.ts";
import type { Plan, PlannedRequest } from "./variants.ts";

export const DEFAULT_CONCURRENCY = 8;
export const DEFAULT_TIMEOUT_MS = 5000;
const BYTES_PER_TOKEN = 4;
const USD_PER_MILLION_TOKENS = 0.042;

export type RunOptions = {
  url: string;
  apiKey: string;
  model: string;
  send: boolean;
  concurrency?: number;
  timeoutMs?: number;
};

export function estimate(plan: Plan): { requests: number; bytes: number; usd: number } {
  const encoder = new TextEncoder();
  let bytes = 0;
  for (const r of plan.requests) {
    bytes += encoder.encode(JSON.stringify({ state: r.state, questions: r.questions })).length;
  }
  return {
    requests: plan.requests.length,
    bytes,
    usd: (bytes / BYTES_PER_TOKEN / 1_000_000) * USD_PER_MILLION_TOKENS,
  };
}

async function attempt(req: PlannedRequest, o: RunOptions): Promise<Result["outcome"]> {
  const out = await askJev({
    url: o.url,
    apiKey: o.apiKey,
    model: o.model,
    timeoutMs: o.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    state: req.state,
    questions: req.questions,
  });
  if (out.kind === "miss") return { kind: "miss", miss: out.miss };
  if (out.kind === "cancelled") return { kind: "miss", miss: "error" };
  // A body the answer reader rejects counts as a failure, so it is retried too.
  if (readAnswers(req.specs, out.body).kind === "miss") return { kind: "miss", miss: "schema" };
  return { kind: "ok", body: out.body };
}

async function ask(req: PlannedRequest, o: RunOptions): Promise<Result> {
  let outcome = await attempt(req, o);
  if (outcome.kind === "miss") outcome = await attempt(req, o);
  return { variant: req.variant, base: req.base, sample: req.sample, kind: req.kind, outcome };
}

/** Results come back in plan order. Without `send`, no request is made. */
export async function runPlan(plan: Plan, o: RunOptions): Promise<Result[]> {
  if (!o.send) return [];
  const results: Result[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      const req = plan.requests[i];
      if (req === undefined) return;
      results[i] = await ask(req, o);
    }
  };
  const width = Math.max(1, Math.min(o.concurrency ?? DEFAULT_CONCURRENCY, plan.requests.length));
  await Promise.all(Array.from({ length: width }, worker));
  return results;
}
