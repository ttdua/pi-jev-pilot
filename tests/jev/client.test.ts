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
