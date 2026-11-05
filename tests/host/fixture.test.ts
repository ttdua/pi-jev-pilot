import { afterEach, describe, expect, test } from "bun:test";
import { type Fixture, type ScriptEntry, fixtureModelsJson, startFixture } from "./fixture";

let fixture: Fixture | undefined;

afterEach(async () => {
  await fixture?.stop();
  fixture = undefined;
});

async function start(script: ScriptEntry[]): Promise<Fixture> {
  fixture = await startFixture(script);
  return fixture;
}

function post(f: Fixture, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${f.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [], stream: true, ...body }),
  });
}

function chunks(sse: string): Record<string, any>[] {
  return sse
    .split("\n")
    .filter((l) => l.startsWith("data: ") && !l.includes("[DONE]"))
    .map((l) => JSON.parse(l.slice(6)));
}

const any = () => true;

describe("recording loopback provider", () => {
  test("binds loopback on an assigned port", async () => {
    const f = await start([]);
    expect(f.baseUrl.startsWith("http://127.0.0.1:")).toBe(true);
    expect(f.port).toBeGreaterThan(0);
  });

  test("records request fields", async () => {
    const f = await start([{ name: "a", match: any, reply: { text: "hi" } }]);
    const res = await post(f, {
      model: "fixture-main",
      reasoning_effort: "high",
      tools: [{ type: "function", function: { name: "read" } }],
    });
    await res.text();
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]?.seq).toBe(0);
    expect(f.requests[0]?.model).toBe("fixture-main");
    expect(f.requests[0]?.reasoningEffort).toBe("high");
    expect(f.requests[0]?.toolNames).toEqual(["read"]);
    expect(f.requests[0]?.matched).toBe("a");
  });

  test("streams a text reply", async () => {
    const f = await start([{ name: "t", match: any, reply: { text: "hello there" } }]);
    const sse = await (await post(f, { model: "fixture-main" })).text();
    const cs = chunks(sse);
    expect(cs.every((c) => c.object === "chat.completion.chunk")).toBe(true);
    expect(cs.map((c) => c.choices[0]?.delta?.content ?? "").join("")).toBe("hello there");
    expect(cs.some((c) => c.choices[0]?.finish_reason === "stop")).toBe(true);
    expect(cs.some((c) => c.usage?.total_tokens > 0)).toBe(true);
    expect(sse.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  test("streams a tool-call reply", async () => {
    const f = await start([
      {
        name: "tc",
        match: any,
        reply: { toolCalls: [{ name: "subagent", arguments: { agent: "w", task: "x" } }] },
      },
    ]);
    const cs = chunks(await (await post(f, { model: "fixture-main" })).text());
    const calls = cs.flatMap((c) => c.choices[0]?.delta?.tool_calls ?? []);
    expect(calls[0].index).toBe(0);
    expect(calls[0].function.name).toBe("subagent");
    expect(typeof calls[0].id).toBe("string");
    const args = calls.map((c) => c.function.arguments ?? "").join("");
    expect(JSON.parse(args)).toEqual({ agent: "w", task: "x" });
    expect(cs.some((c) => c.choices[0]?.finish_reason === "tool_calls")).toBe(true);
  });

  test("routes concurrent requests by matcher", async () => {
    const f = await start([
      { name: "main", match: (r) => r.model === "fixture-main", reply: { text: "from-main" } },
      { name: "fast", match: (r) => r.model === "fixture-fast", reply: { text: "from-fast" } },
    ]);
    const [a, b] = await Promise.all([
      post(f, { model: "fixture-main" }).then((r) => r.text()),
      post(f, { model: "fixture-fast" }).then((r) => r.text()),
    ]);
    expect(a).toContain("from-main");
    expect(a).not.toContain("from-fast");
    expect(b).toContain("from-fast");
    expect(b).not.toContain("from-main");
  });

  test("answers unmatched with an error", async () => {
    const f = await start([{ name: "none", match: () => false, reply: { text: "x" } }]);
    const res = await post(f, { model: "fixture-main" });
    expect(res.status).toBe(500);
    await res.text();
    expect(f.unmatched).toHaveLength(1);
    expect(f.unmatched[0]?.matched).toBeNull();
  });

  test("honours times", async () => {
    const f = await start([{ name: "once", match: any, reply: { text: "x" }, times: 1 }]);
    expect((await post(f, { model: "fixture-main" })).status).toBe(200);
    const second = await post(f, { model: "fixture-main" });
    expect(second.status).toBe(500);
    await second.text();
    expect(f.unmatched).toHaveLength(1);
  });

  test("fixtureModelsJson follows the contract", () => {
    const m = fixtureModelsJson("http://127.0.0.1:1/v1") as any;
    expect(m.providers.fixture.api).toBe("openai-completions");
    expect(m.providers.fixture.baseUrl).toBe("http://127.0.0.1:1/v1");
    expect(m.providers.fixture.models.map((x: any) => x.id)).toEqual([
      "fixture-main",
      "fixture-balanced",
      "fixture-fast",
    ]);
  });
});
