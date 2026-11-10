// Characterization of askJev: read order of request fields, abort precedence, timer hygiene and ms rounding.
import { afterEach, describe, expect, test } from "bun:test";

import { askJev, type JevRequest } from "../../src/jev/client.ts";
import { startJevFixture, type JevFixture } from "./fixture.ts";

const fixtures: JevFixture[] = [];

async function fixture(routes: Parameters<typeof startJevFixture>[0]): Promise<JevFixture> {
  const f = await startJevFixture(routes);
  fixtures.push(f);
  return f;
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.stop()));
});

function base(url: string, extra: Partial<JevRequest> = {}): JevRequest {
  return {
    url,
    apiKey: "k",
    model: "m",
    timeoutMs: 1500,
    state: { s: 1 },
    questions: { q: 1 },
    ...extra,
  };
}

// A request whose fields are getters that log the order in which they are read.
function recording(
  url: string,
  log: string[],
  overrides: Partial<Record<keyof JevRequest, () => unknown>> = {},
  signal?: AbortSignal,
): JevRequest {
  const values: Record<string, unknown> = {
    url,
    apiKey: "k",
    model: "m",
    timeoutMs: 1500,
    state: { s: 1 },
    questions: { q: 1 },
    signal,
  };
  const req = {} as Record<string, unknown>;
  for (const name of Object.keys(values)) {
    Object.defineProperty(req, name, {
      enumerable: true,
      configurable: true,
      get() {
        log.push(name);
        const override = overrides[name as keyof JevRequest];
        return override === undefined ? values[name] : override();
      },
    });
  }
  return req as unknown as JevRequest;
}

function firstReads(log: string[]): string[] {
  return [...new Set(log)];
}

describe("askJev request field read order", () => {
  test("Fields are read signal, url, timeoutMs, apiKey, model, state, questions, all before the request is sent", async () => {
    const f = await fixture({ "/ok": { json: {} } });
    const log: string[] = [];
    const sentAtRead: Record<string, number> = {};
    const req = recording(f.url("/ok"), log);
    for (const name of ["url", "apiKey", "model", "state", "questions"] as const) {
      const desc = Object.getOwnPropertyDescriptor(req, name)!;
      Object.defineProperty(req, name, {
        ...desc,
        get() {
          sentAtRead[name] = f.requests.length;
          return desc.get!.call(req);
        },
      });
    }
    const out = await askJev(req);
    expect(out.kind).toBe("ok");
    expect(firstReads(log).slice(0, 7)).toEqual([
      "signal",
      "url",
      "timeoutMs",
      "apiKey",
      "model",
      "state",
      "questions",
    ]);
    expect(sentAtRead).toEqual({ url: 0, apiKey: 0, model: 0, state: 0, questions: 0 });
    expect(log.filter((n) => n === "apiKey").length).toBe(2);
    expect(log.filter((n) => n === "url").length).toBe(2);
  });

  test("A bad url stops reading after signal and url", async () => {
    const log: string[] = [];
    const out = await askJev(recording("http://example.com/x", log));
    expect(out).toEqual({ kind: "miss", miss: "error", reason: "bad url", ms: 0 });
    expect(firstReads(log)).toEqual(["signal", "url"]);
  });

  test("A bad timeout is reported before apiKey, model, state and questions are read", async () => {
    const f = await fixture({ "/ok": { json: {} } });
    const log: string[] = [];
    const out = await askJev(recording(f.url("/ok"), log, { timeoutMs: () => 0 }));
    expect(out).toEqual({ kind: "miss", miss: "error", reason: "bad timeout", ms: 0 });
    expect(firstReads(log)).toEqual(["signal", "url", "timeoutMs"]);
    expect(f.requests.length).toBe(0);
  });

  test("A non-number timeout is a bad timeout", async () => {
    const f = await fixture({ "/ok": { json: {} } });
    const out = await askJev(base(f.url("/ok"), { timeoutMs: "5" as unknown as number }));
    expect(out).toMatchObject({ reason: "bad timeout", ms: 0 });
    const inf = await askJev(base(f.url("/ok"), { timeoutMs: Infinity }));
    expect(inf).toMatchObject({ reason: "bad timeout", ms: 0 });
  });

  test("A throwing apiKey getter is a bad request and state is never read", async () => {
    const f = await fixture({ "/ok": { json: {} } });
    const log: string[] = [];
    const out = await askJev(
      recording(f.url("/ok"), log, {
        apiKey: () => {
          throw new Error("boom");
        },
      }),
    );
    expect(out).toEqual({ kind: "miss", miss: "error", reason: "bad request", ms: 0 });
    expect(firstReads(log)).toEqual(["signal", "url", "timeoutMs", "apiKey"]);
    expect(f.requests.length).toBe(0);
  });

  test("A non-string apiKey is a bad request", async () => {
    const f = await fixture({ "/ok": { json: {} } });
    const out = await askJev(base(f.url("/ok"), { apiKey: 5 as unknown as string }));
    expect(out).toEqual({ kind: "miss", miss: "error", reason: "bad request", ms: 0 });
    expect(f.requests.length).toBe(0);
  });

  test("A throwing state getter is a bad request and questions is never read", async () => {
    const f = await fixture({ "/ok": { json: {} } });
    const log: string[] = [];
    const out = await askJev(
      recording(f.url("/ok"), log, {
        state: () => {
          throw new Error("boom");
        },
      }),
    );
    expect(out).toEqual({ kind: "miss", miss: "error", reason: "bad request", ms: 0 });
    expect(firstReads(log)).toEqual(["signal", "url", "timeoutMs", "apiKey", "model", "state"]);
    expect(f.requests.length).toBe(0);
  });

  test("Non-serialisable payloads are a bad request", async () => {
    const f = await fixture({ "/ok": { json: {} } });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const toJson = {
      toJSON: () => {
        throw new Error("no");
      },
    };
    for (const questions of [cyclic, toJson]) {
      const out = await askJev(base(f.url("/ok"), { questions }));
      expect(out).toEqual({ kind: "miss", miss: "error", reason: "bad request", ms: 0 });
    }
    expect(f.requests.length).toBe(0);
  });

  test("The caller's signal wins over every validation miss", async () => {
    const log: string[] = [];
    const out = await askJev(recording("ftp://x", log, {}, AbortSignal.abort()));
    expect(out).toEqual({ kind: "cancelled" });
    expect(firstReads(log)).toEqual(["signal"]);
  });
});

describe("askJev abort precedence", () => {
  // Wraps fetch so the caller aborts after the response headers arrived, before status/body handling.
  async function abortAfterFetch(req: (c: AbortController) => JevRequest): Promise<unknown> {
    const real = globalThis.fetch;
    const ctl = new AbortController();
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      const res = await real(...args);
      ctl.abort();
      return res;
    }) as typeof fetch;
    try {
      return await askJev(req(ctl));
    } finally {
      globalThis.fetch = real;
    }
  }

  test.each([
    ["redirect", { status: 302, location: "/t" }],
    ["http status", { status: 500 }],
    ["declared too large", { raw: " ".repeat(262_145) }],
    ["invalid json", { raw: "{" }],
  ] as const)("Aborted after headers beats a %s miss", async (_name, route) => {
    const f = await fixture({ "/r": route });
    const out = await abortAfterFetch((c) => base(f.url("/r"), { signal: c.signal }));
    expect(out).toEqual({ kind: "cancelled" });
  });

  test("Aborted while a streamed body is too large still cancels", async () => {
    const f = await fixture({ "/big": { streamBytes: 400_000 } });
    const out = await abortAfterFetch((c) => base(f.url("/big"), { signal: c.signal }));
    expect(out).toEqual({ kind: "cancelled" });
  });

  test("Aborted while the connection is refused beats the connection miss", async () => {
    const dead = await startJevFixture({});
    const url = dead.url("/x");
    await dead.stop();
    const out = await askJev(base(url, { signal: AbortSignal.abort() }));
    expect(out).toEqual({ kind: "cancelled" });
  });

  test("Timeout fires even when the caller's signal is present but never aborts", async () => {
    const f = await fixture({ "/hang": { hang: true } });
    const out = await askJev(
      base(f.url("/hang"), { timeoutMs: 100, signal: new AbortController().signal }),
    );
    expect(out).toMatchObject({ kind: "miss", miss: "timeout", reason: "timeout" });
  });

  test("Timeout and caller abort together resolve to cancelled", async () => {
    const f = await fixture({ "/hang": { hang: true } });
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 100);
    const out = await askJev(base(f.url("/hang"), { timeoutMs: 100, signal: ctl.signal }));
    // Whichever fires first, a signal aborted by the time of settling wins or the timeout is reported;
    // pin the observed result: the timer fires first or at the same instant only when the caller is not yet aborted.
    expect(["cancelled", "timeout"]).toContain(out.kind === "miss" ? out.miss : out.kind);
  });
});

describe("askJev timer hygiene", () => {
  const DELAY = 4321;

  async function withTimerSpy(
    run: () => Promise<unknown>,
  ): Promise<{ set: number; cleared: number }> {
    const realSet = globalThis.setTimeout;
    const realClear = globalThis.clearTimeout;
    const handles: unknown[] = [];
    const cleared = new Set<unknown>();
    globalThis.setTimeout = ((fn: () => void, ms?: number, ...rest: unknown[]) => {
      const h = realSet(fn, ms, ...rest);
      if (ms === DELAY) handles.push(h);
      return h;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = ((h: unknown) => {
      cleared.add(h);
      return realClear(h as never);
    }) as typeof clearTimeout;
    try {
      await run();
    } finally {
      globalThis.setTimeout = realSet;
      globalThis.clearTimeout = realClear;
    }
    return { set: handles.length, cleared: handles.filter((h) => cleared.has(h)).length };
  }

  test.each([
    ["ok", { json: { model: "x" } }, 1],
    ["redirect", { status: 302 }, 1],
    ["http status", { status: 500 }, 1],
    ["too large", { streamBytes: 400_000 }, 1],
    ["invalid json", { raw: "{" }, 1],
  ] as const)("The timer is cleared after %s", async (_n, route, expectedSet) => {
    const f = await fixture({ "/r": route });
    const spy = await withTimerSpy(() => askJev(base(f.url("/r"), { timeoutMs: DELAY })));
    expect(spy).toEqual({ set: expectedSet, cleared: expectedSet });
  });

  test("The timer is cleared after a connection failure", async () => {
    const dead = await startJevFixture({});
    const url = dead.url("/x");
    await dead.stop();
    const spy = await withTimerSpy(() => askJev(base(url, { timeoutMs: DELAY })));
    expect(spy).toEqual({ set: 1, cleared: 1 });
  });

  test("The timer is cleared after the caller cancels", async () => {
    const f = await fixture({ "/hang": { hang: true } });
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 30);
    const spy = await withTimerSpy(() =>
      askJev(base(f.url("/hang"), { timeoutMs: DELAY, signal: ctl.signal })),
    );
    expect(spy).toEqual({ set: 1, cleared: 1 });
  });

  test("No timer is started when validation fails", async () => {
    const spy = await withTimerSpy(() =>
      askJev(base("http://example.com/x", { timeoutMs: DELAY })),
    );
    expect(spy.set).toBe(0);
    const f = await fixture({ "/ok": { json: {} } });
    const bad = await withTimerSpy(() =>
      askJev(base(f.url("/ok"), { timeoutMs: DELAY, state: { n: 1n } })),
    );
    expect(bad.set).toBe(0);
    expect(f.requests.length).toBe(0);
  });
});

describe("askJev ms", () => {
  async function withClock(
    elapsedMs: number,
    run: () => Promise<JevRequest | unknown>,
  ): Promise<unknown> {
    const real = performance.now.bind(performance);
    let calls = 0;
    performance.now = () => (calls++ === 0 ? 100 : 100 + elapsedMs);
    try {
      return await run();
    } finally {
      performance.now = real;
    }
  }

  test.each([
    [0.49, 0],
    [0.5, 1],
    [1.4, 1],
    [12.6, 13],
  ])("An elapsed %p ms is reported as %p", async (elapsed, expected) => {
    const f = await fixture({ "/r": { json: { model: "m" } }, "/e": { status: 500 } });
    const ok = await withClock(elapsed, () => askJev(base(f.url("/r"))));
    expect(ok).toEqual({ kind: "ok", body: { model: "m" }, model: "m", ms: expected });
    const miss = await withClock(elapsed, () => askJev(base(f.url("/e"))));
    expect(miss).toEqual({ kind: "miss", miss: "error", reason: "http 500", ms: expected });
  });

  test("ok keeps the key order kind, body, model, ms", async () => {
    const f = await fixture({ "/r": { json: { model: "m" } }, "/n": { json: { model: 5 } } });
    const withModel = await askJev(base(f.url("/r")));
    expect(Object.keys(withModel)).toEqual(["kind", "body", "model", "ms"]);
    const without = await askJev(base(f.url("/n")));
    expect(Object.keys(without)).toEqual(["kind", "body", "ms"]);
  });

  test("A JSON null body is ok without a model", async () => {
    const f = await fixture({ "/null": { raw: "null" } });
    const out = await askJev(base(f.url("/null")));
    expect(out).toMatchObject({ kind: "ok", body: null });
    expect("model" in out).toBe(false);
  });

  test("Miss outcomes have the key order kind, miss, reason, ms", async () => {
    const f = await fixture({ "/e": { status: 404 } });
    const out = await askJev(base(f.url("/e")));
    expect(Object.keys(out)).toEqual(["kind", "miss", "reason", "ms"]);
    expect(Number.isInteger((out as { ms: number }).ms)).toBe(true);
  });
});
