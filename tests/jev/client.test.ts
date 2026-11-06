import { afterEach, describe, expect, test } from "bun:test";

import { askJev, isAllowedJevUrl, type JevRequest } from "../../src/jev/client.ts";
import { startJevFixture, type JevFixture } from "./fixture.ts";

const KEY = "test-key-123";
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
    apiKey: KEY,
    model: "jev-latest",
    timeoutMs: 1500,
    state: { request: { text: "hi" } },
    questions: { risky: { type: "noul" } },
    ...extra,
  };
}

describe("isAllowedJevUrl", () => {
  test("Loopback forms are accepted", () => {
    for (const url of [
      "http://127.0.0.1:1/",
      "http://127.5.6.7/",
      "http://127.1/",
      "http://[::1]:1/",
      "http://localhost:1/",
      "https://api.typesafe.ai/v1/systemone",
    ]) {
      expect(isAllowedJevUrl(url)).toBe(true);
    }
  });

  test("Other schemes and malformed URLs are rejected", () => {
    for (const url of [
      "ftp://127.0.0.1/",
      "http://10.0.0.1/",
      "http://user:pw@127.0.0.1/",
      "https://user:pw@api.typesafe.ai/",
      "not a url",
    ]) {
      expect(isAllowedJevUrl(url)).toBe(false);
    }
  });
});

describe("askJev inputs", () => {
  test("Plain HTTP to another host is rejected", async () => {
    const out = await askJev(base("http://example.com/v1/systemone"));
    expect(out).toEqual({ kind: "miss", miss: "error", reason: "bad url", ms: 0 });
  });

  test("Invalid timeout", async () => {
    const f = await fixture({ "/ok": { json: {} } });
    for (const timeoutMs of [0, -1, Number.NaN]) {
      const out = await askJev(base(f.url("/ok"), { timeoutMs }));
      expect(out).toEqual({ kind: "miss", miss: "error", reason: "bad timeout", ms: 0 });
    }
    expect(f.requests.length).toBe(0);
  });

  test("Input that cannot be sent", async () => {
    const f = await fixture({ "/ok": { json: {} } });
    const bigint = await askJev(base(f.url("/ok"), { state: { n: 1n } }));
    expect(bigint).toEqual({ kind: "miss", miss: "error", reason: "bad request", ms: 0 });
    const newline = await askJev(base(f.url("/ok"), { apiKey: "a\nb" }));
    expect(newline).toEqual({ kind: "miss", miss: "error", reason: "bad request", ms: 0 });
    expect(f.requests.length).toBe(0);
  });
});

describe("askJev request and status", () => {
  test("Fixture sees the request as specified", async () => {
    const f = await fixture({ "/ask": { json: { model: "jev-1.14.0", answers: {} } } });
    const state = { request: { text: "hello" } };
    const questions = { risky: { type: "noul" } };
    const out = await askJev(base(f.url("/ask"), { state, questions }));
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.model).toBe("jev-1.14.0");
      expect(out.body).toEqual({ model: "jev-1.14.0", answers: {} });
    }
    expect(f.requests.length).toBe(1);
    const seen = f.requests[0]!;
    expect(seen.method).toBe("POST");
    expect(seen.path).toBe("/ask");
    expect(seen.headers["authorization"]).toBe(`Bearer ${KEY}`);
    expect(seen.headers["content-type"]).toBe("application/json");
    expect(seen.headers["accept"]).toBe("application/json");
    const body = JSON.parse(seen.body) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["model", "questions", "state"]);
    expect(body).toEqual({ model: "jev-latest", state, questions });
  });

  test("Connection refused", async () => {
    const f = await startJevFixture({});
    const url = f.url("/ask");
    await f.stop();
    const out = await askJev(base(url));
    expect(out.kind).toBe("miss");
    if (out.kind === "miss") {
      expect(out.miss).toBe("error");
      expect(out.reason).toBe("connection");
      expect(out.reason).not.toContain(KEY);
    }
  });

  test("Redirect is not followed", async () => {
    const f = await fixture({
      "/redirect": { status: 302, location: "/target" },
      "/target": { json: { answers: {} } },
    });
    const out = await askJev(base(f.url("/redirect")));
    expect(out).toMatchObject({ kind: "miss", miss: "error", reason: "redirect" });
    expect(f.requests.map((r) => r.path)).toEqual(["/redirect"]);
  });

  test("Failure is not retried", async () => {
    const f = await fixture({ "/fail": { status: 503 } });
    const out = await askJev(base(f.url("/fail")));
    expect(out).toMatchObject({ kind: "miss", miss: "error", reason: "http 503" });
    expect(f.requests.length).toBe(1);
  });

  test("Client error status", async () => {
    const f = await fixture({ "/deny": { status: 401 } });
    const out = await askJev(base(f.url("/deny")));
    expect(out).toMatchObject({ kind: "miss", miss: "error", reason: "http 401" });
  });

  test("Server error status", async () => {
    const f = await fixture({ "/boom": { json: { error: "x" }, status: 500 } });
    const out = await askJev(base(f.url("/boom")));
    expect(out).toMatchObject({ kind: "miss", miss: "error", reason: "http 500" });
  });
});

describe("askJev body", () => {
  test("Successful request", async () => {
    const f = await fixture({ "/ok": { json: { model: "jev-1.14.0", answers: {} } } });
    const out = await askJev(base(f.url("/ok")));
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.body).toEqual({ model: "jev-1.14.0", answers: {} });
      expect(out.model).toBe("jev-1.14.0");
      expect(typeof out.ms).toBe("number");
    }
  });

  test("Response without a model string", async () => {
    const f = await fixture({
      "/none": { json: { answers: {} } },
      "/num": { json: { model: 5, answers: {} } },
    });
    for (const path of ["/none", "/num"]) {
      const out = await askJev(base(f.url(path)));
      expect(out.kind).toBe("ok");
      if (out.kind === "ok") expect("model" in out).toBe(false);
    }
  });

  test("Declared too large", async () => {
    const f = await fixture({ "/big": { raw: " ".repeat(262_145) } });
    const out = await askJev(base(f.url("/big")));
    expect(out).toMatchObject({ kind: "miss", miss: "error", reason: "too large" });
  });

  test("Streamed too large", async () => {
    const f = await fixture({ "/stream": { streamBytes: 300_000 } });
    const out = await askJev(base(f.url("/stream")));
    expect(out).toMatchObject({ kind: "miss", miss: "error", reason: "too large" });
  });

  test("Body at the cap", async () => {
    const prefix = '{"pad":"';
    const suffix = '"}';
    const pad = "x".repeat(262_144 - prefix.length - suffix.length);
    const raw = `${prefix}${pad}${suffix}`;
    expect(new TextEncoder().encode(raw).length).toBe(262_144);
    const f = await fixture({ "/cap": { raw } });
    const out = await askJev(base(f.url("/cap")));
    expect(out.kind).toBe("ok");
  });

  test("Malformed JSON", async () => {
    const f = await fixture({ "/bad": { raw: '{"answers":' } });
    const out = await askJev(base(f.url("/bad")));
    expect(out).toMatchObject({ kind: "miss", miss: "schema", reason: "invalid json" });
  });

  test("Empty body", async () => {
    const f = await fixture({ "/empty": { raw: "" } });
    const out = await askJev(base(f.url("/empty")));
    expect(out).toMatchObject({ kind: "miss", miss: "schema", reason: "invalid json" });
  });

  test("Multi-byte character split across chunks", async () => {
    const bytes = new TextEncoder().encode('{"model":"é"}');
    const cut = bytes.indexOf(0xc3) + 1;
    const f = await fixture({
      "/split": { chunks: [bytes.slice(0, cut), bytes.slice(cut)] },
    });
    const out = await askJev(base(f.url("/split")));
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.body).toEqual({ model: "é" });
      expect(out.model).toBe("é");
    }
  });

  test("Invalid UTF-8 is a schema miss", async () => {
    const f = await fixture({ "/latin": { raw: new Uint8Array([0x7b, 0xff, 0x7d]) } });
    const out = await askJev(base(f.url("/latin")));
    expect(out).toMatchObject({ kind: "miss", miss: "schema", reason: "invalid json" });
  });
});

describe("askJev timeout and cancellation", () => {
  test("Server never answers", async () => {
    const f = await fixture({ "/hang": { hang: true } });
    const t0 = performance.now();
    const out = await askJev(base(f.url("/hang"), { timeoutMs: 200 }));
    expect(out).toMatchObject({ kind: "miss", miss: "timeout", reason: "timeout" });
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  test("Body stalls after headers", async () => {
    const f = await fixture({ "/stall": { stallAfterHeaders: true } });
    const out = await askJev(base(f.url("/stall"), { timeoutMs: 200 }));
    expect(out).toMatchObject({ kind: "miss", miss: "timeout", reason: "timeout" });
  });

  test("Already cancelled", async () => {
    const f = await fixture({ "/ok": { json: {} } });
    const out = await askJev(base(f.url("/ok"), { signal: AbortSignal.abort() }));
    expect(out).toEqual({ kind: "cancelled" });
    expect(f.requests.length).toBe(0);
  });

  test("Already cancelled with invalid input", async () => {
    const out = await askJev(base("ftp://nope", { signal: AbortSignal.abort() }));
    expect(out).toEqual({ kind: "cancelled" });
  });

  test("Cancelled while waiting", async () => {
    const f = await fixture({ "/hang": { hang: true } });
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 50);
    const t0 = performance.now();
    const out = await askJev(base(f.url("/hang"), { timeoutMs: 1500, signal: ctl.signal }));
    expect(out).toEqual({ kind: "cancelled" });
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  test("Cancelled while the body stalls", async () => {
    const f = await fixture({ "/stall": { stallAfterHeaders: true } });
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 50);
    const t0 = performance.now();
    const out = await askJev(base(f.url("/stall"), { timeoutMs: 1500, signal: ctl.signal }));
    expect(out).toEqual({ kind: "cancelled" });
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe("askJev key hygiene", () => {
  const routes = {
    "/redirect": { status: 302, location: "/t" },
    "/401": { status: 401 },
    "/500": { json: { error: "x" }, status: 500 },
    "/big": { raw: " ".repeat(262_145) },
    "/invalid": { raw: "{" },
    "/hang": { hang: true },
  } as const;

  test.each([
    "bad url",
    "bad timeout",
    "bad request",
    "connection",
    "redirect",
    "401",
    "500",
    "too large",
    "invalid json",
    "timeout",
  ])("Key never appears in a reason", async (route) => {
    const f = await fixture(routes);
    let req: JevRequest;
    switch (route) {
      case "bad url":
        req = base("http://example.com/x");
        break;
      case "bad timeout":
        req = base(f.url("/401"), { timeoutMs: 0 });
        break;
      case "bad request":
        req = base(f.url("/401"), { state: { n: 1n } });
        break;
      case "connection": {
        const dead = await startJevFixture({});
        const url = dead.url("/x");
        await dead.stop();
        req = base(url);
        break;
      }
      case "redirect":
        req = base(f.url("/redirect"));
        break;
      case "401":
        req = base(f.url("/401"));
        break;
      case "500":
        req = base(f.url("/500"));
        break;
      case "too large":
        req = base(f.url("/big"));
        break;
      case "invalid json":
        req = base(f.url("/invalid"));
        break;
      default:
        req = base(f.url("/hang"), { timeoutMs: 100 });
    }
    const out = await askJev(req);
    expect(out.kind).toBe("miss");
    if (out.kind === "miss") expect(out.reason).not.toContain(KEY);
  });
});
