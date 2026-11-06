// Jev HTTP client. Imports only ../policy/ and ../shared/; never host/, store/, extension.ts or @earendil-works/*.
import type { MissKind } from "../policy/answers.ts";
import { isAllowedJevUrl } from "../shared/urls.ts";

export { isAllowedJevUrl };

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

function miss(kind: MissKind, reason: string, ms: number): JevOutcome {
  return { kind: "miss", miss: kind, reason, ms };
}

// Releases an unread body; failures are irrelevant.
async function discard(res: Response): Promise<void> {
  await res.body?.cancel().catch(() => {});
}

// Reads the body up to MAX_RESPONSE_BYTES. A null body reads as empty.
async function readCapped(res: Response): Promise<Uint8Array | "too large" | "unreadable"> {
  if (res.body === null) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        return "too large";
      }
      chunks.push(value);
    }
  } catch {
    // Aborts surface here too; the caller classifies them by signal state.
    return "unreadable";
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined;
}

export async function askJev(req: JevRequest): Promise<JevOutcome> {
  const timer = new AbortController();
  let handle: ReturnType<typeof setTimeout> | undefined;
  // The caller's signal wins over every miss, whatever its cause.
  const settle = (outcome: JevOutcome): JevOutcome =>
    req.signal?.aborted === true ? { kind: "cancelled" } : outcome;
  try {
    if (req.signal?.aborted === true) return { kind: "cancelled" };
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
    handle = setTimeout(() => timer.abort(), req.timeoutMs);
    const combined =
      req.signal === undefined ? timer.signal : AbortSignal.any([timer.signal, req.signal]);
    const aborted = (fallback: JevOutcome): JevOutcome => {
      if (timer.signal.aborted && req.signal?.aborted !== true) {
        return miss("timeout", "timeout", elapsed());
      }
      return settle(fallback);
    };
    let res: Response;
    try {
      res = await fetch(req.url, {
        method: "POST",
        headers,
        body: payload,
        redirect: "manual",
        signal: combined,
      });
    } catch {
      return aborted(miss("error", "connection", elapsed()));
    }

    // Status step.
    if (res.status >= 300 && res.status < 400) {
      await discard(res);
      return settle(miss("error", "redirect", elapsed()));
    }
    if (res.status < 200 || res.status >= 300) {
      await discard(res);
      return settle(miss("error", `http ${res.status}`, elapsed()));
    }

    // Body step.
    const declared = res.headers.get("content-length");
    if (declared !== null && Number(declared) > MAX_RESPONSE_BYTES) {
      await discard(res);
      return settle(miss("error", "too large", elapsed()));
    }
    const bytes = await readCapped(res);
    if (bytes === "too large") return settle(miss("error", "too large", elapsed()));
    if (bytes === "unreadable") return aborted(miss("error", "connection", elapsed()));
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      return settle(miss("schema", "invalid json", elapsed()));
    }
    const model = (body as { model?: unknown } | null)?.model;
    const ms = elapsed();
    return typeof model === "string" ? { kind: "ok", body, model, ms } : { kind: "ok", body, ms };
  } catch {
    return req.signal?.aborted === true ? { kind: "cancelled" } : miss("error", "connection", 0);
  } finally {
    clearTimeout(handle);
  }
}
