// Jev HTTP client. Imports only ../policy/; never host/, store/, extension.ts or @earendil-works/*.
import type { MissKind } from "../policy/answers.ts";

export type JevRequest = {
  url: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  state: unknown;
  questions: unknown;
  signal?: AbortSignal;
};

export type JevOutcome =
  | { kind: "ok"; body: unknown; model?: string; ms: number }
  | { kind: "miss"; miss: MissKind; reason: string; ms: number }
  | { kind: "cancelled" };

// Response size cap; see docs/jev-contract.md#transport.
export const MAX_RESPONSE_BYTES = 262_144;

function isLoopbackHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "[::1]") return true;
  const m = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.exec(hostname);
  return m !== null;
}

export function isAllowedJevUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.username !== "" || parsed.password !== "") return false;
  if (parsed.protocol === "https:") return true;
  return parsed.protocol === "http:" && isLoopbackHost(parsed.hostname);
}

function miss(kind: MissKind, reason: string, ms: number): JevOutcome {
  return { kind: "miss", miss: kind, reason, ms };
}

export async function askJev(req: JevRequest): Promise<JevOutcome> {
  try {
    // Pre-I/O step: every input check happens before the clock starts.
    if (!isAllowedJevUrl(req.url)) return miss("error", "bad url", 0);
    if (
      typeof req.timeoutMs !== "number" ||
      !Number.isFinite(req.timeoutMs) ||
      req.timeoutMs <= 0
    ) {
      return miss("error", "bad timeout", 0);
    }
    let headers: Headers;
    let payload: string;
    try {
      if (typeof req.apiKey !== "string") throw new TypeError("apiKey");
      payload = JSON.stringify({ model: req.model, state: req.state, questions: req.questions });
      if (typeof payload !== "string") throw new TypeError("payload");
      headers = new Headers({
        authorization: `Bearer ${req.apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
      });
    } catch {
      return miss("error", "bad request", 0);
    }

    // Fetch step.
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    let res: Response;
    try {
      res = await fetch(req.url, { method: "POST", headers, body: payload, redirect: "manual" });
    } catch {
      return miss("error", "connection", elapsed());
    }

    // Status step.
    if (res.status >= 300 && res.status < 400) return miss("error", "redirect", elapsed());
    if (res.status < 200 || res.status >= 300) {
      return miss("error", `http ${res.status}`, elapsed());
    }

    // Body step (Task 4 replaces this with bounded reading).
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return miss("schema", "invalid json", elapsed());
    }
    const model = (body as { model?: unknown } | null)?.model;
    const ms = elapsed();
    return typeof model === "string" ? { kind: "ok", body, model, ms } : { kind: "ok", body, ms };
  } catch {
    return miss("error", "connection", 0);
  }
}
