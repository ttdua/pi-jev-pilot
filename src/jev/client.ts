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

type Prepared =
  | { ok: true; headers: Headers; payload: string }
  | { ok: false; outcome: JevOutcome };

const fail = (outcome: JevOutcome): Prepared => ({ ok: false, outcome });

// Pre-I/O step: every input check happens before the clock starts, in a fixed field read order.
function validateRequest(req: JevRequest): Prepared {
  if (!isAllowedJevUrl(req.url)) return fail(miss("error", "bad url", 0));
  if (typeof req.timeoutMs !== "number" || !Number.isFinite(req.timeoutMs) || req.timeoutMs <= 0) {
    return fail(miss("error", "bad timeout", 0));
  }
  try {
    if (typeof req.apiKey !== "string") throw new TypeError("apiKey");
    const payload = JSON.stringify({
      model: req.model,
      state: req.state,
      questions: req.questions,
    });
    if (typeof payload !== "string") throw new TypeError("payload");
    const headers = new Headers({
      authorization: `Bearer ${req.apiKey}`,
      "content-type": "application/json",
      accept: "application/json",
    });
    return { ok: true, headers, payload };
  } catch {
    // Getters that throw, bigint, cycles and bad header values all read as an unsendable request.
    return fail(miss("error", "bad request", 0));
  }
}

// Clock and abort rules shared by the steps after the request is sent.
type Run = {
  elapsed: () => number;
  // The caller's signal wins over every miss, whatever its cause.
  settle: (outcome: JevOutcome) => JevOutcome;
  // Like settle, but a fired timer (with no caller abort) is reported as a timeout.
  aborted: (fallback: JevOutcome) => JevOutcome;
};

// Status step: a non-2xx answer is a miss, anything else passes through.
async function checkStatus(res: Response, run: Run): Promise<JevOutcome | undefined> {
  if (res.status >= 300 && res.status < 400) {
    await discard(res);
    return run.settle(miss("error", "redirect", run.elapsed()));
  }
  if (res.status < 200 || res.status >= 300) {
    await discard(res);
    return run.settle(miss("error", `http ${res.status}`, run.elapsed()));
  }
  return undefined;
}

// Body step: size cap, utf-8, json.
async function readBody(res: Response, run: Run): Promise<JevOutcome> {
  const declared = res.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_RESPONSE_BYTES) {
    await discard(res);
    return run.settle(miss("error", "too large", run.elapsed()));
  }
  const bytes = await readCapped(res);
  if (bytes === "too large") return run.settle(miss("error", "too large", run.elapsed()));
  if (bytes === "unreadable") return run.aborted(miss("error", "connection", run.elapsed()));
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    // Invalid utf-8 and invalid json are the same schema miss.
    return run.settle(miss("schema", "invalid json", run.elapsed()));
  }
  const model = (body as { model?: unknown } | null)?.model;
  const ms = run.elapsed();
  return typeof model === "string" ? { kind: "ok", body, model, ms } : { kind: "ok", body, ms };
}

export async function askJev(req: JevRequest): Promise<JevOutcome> {
  const timer = new AbortController();
  let handle: ReturnType<typeof setTimeout> | undefined;
  try {
    if (req.signal?.aborted === true) return { kind: "cancelled" };
    const prepared = validateRequest(req);
    if (!prepared.ok) return prepared.outcome;

    const started = performance.now();
    const settle = (outcome: JevOutcome): JevOutcome =>
      req.signal?.aborted === true ? { kind: "cancelled" } : outcome;
    const run: Run = {
      elapsed: () => Math.round(performance.now() - started),
      settle,
      aborted: (fallback) =>
        timer.signal.aborted && req.signal?.aborted !== true
          ? miss("timeout", "timeout", run.elapsed())
          : settle(fallback),
    };
    handle = setTimeout(() => timer.abort(), req.timeoutMs);
    const combined =
      req.signal === undefined ? timer.signal : AbortSignal.any([timer.signal, req.signal]);
    let res: Response;
    try {
      res = await fetch(req.url, {
        method: "POST",
        headers: prepared.headers,
        body: prepared.payload,
        redirect: "manual",
        signal: combined,
      });
    } catch {
      // Refused, reset or aborted; aborted() tells a timeout or caller cancel from a plain failure.
      return run.aborted(miss("error", "connection", run.elapsed()));
    }
    return (await checkStatus(res, run)) ?? (await readBody(res, run));
  } catch {
    // Anything unexpected is a failed connection unless the caller cancelled.
    return req.signal?.aborted === true ? { kind: "cancelled" } : miss("error", "connection", 0);
  } finally {
    clearTimeout(handle);
  }
}
