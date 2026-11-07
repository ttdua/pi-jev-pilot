import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compare, diffCases } from "../../scripts/replay/compare.ts";
import { writeOutputs } from "../../scripts/replay/outputs.ts";
import { estimate, runPlan } from "../../scripts/replay/run.ts";
import { type JevFixture, startJevFixture } from "../jev/fixture.ts";
import { config, mainBody, mainReq, MARKER, planOf } from "./helpers.ts";

let fixture: JevFixture | undefined;
afterEach(async () => {
  await fixture?.stop();
  fixture = undefined;
});

const plan = () => planOf([mainReq("minimal", "minimal", 0), mainReq("full", "minimal", 0)]);
const opts = (url: string, send = true) => ({
  url,
  apiKey: "k",
  model: "m",
  send,
  timeoutMs: 2000,
});

describe("runPlan", () => {
  test("dry run makes no request", async () => {
    fixture = await startJevFixture({ "/": { json: mainBody() } });
    const e = estimate(plan());
    const results = await runPlan(plan(), opts(fixture.url("/"), false));
    expect(fixture.requests.length).toBe(0);
    expect(results).toEqual([]);
    expect(e.requests).toBe(2);
    expect(e.usd).toBeGreaterThan(0);
  });

  test("send makes counted requests", async () => {
    fixture = await startJevFixture({ "/": { json: mainBody() } });
    const results = await runPlan(plan(), opts(fixture.url("/")));
    expect(fixture.requests.length).toBe(estimate(plan()).requests);
    expect(results.every((r) => r.outcome.kind === "ok")).toBe(true);
  });

  test("retry succeeds", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (() => {
        let n = 0;
        return () => (n++ === 0 ? new Response("x", { status: 500 }) : Response.json(mainBody()));
      })(),
    });
    try {
      const p = planOf([mainReq("minimal", "minimal", 0)]);
      const [r] = await runPlan(p, opts(`http://127.0.0.1:${server.port}/`));
      expect(r?.outcome.kind).toBe("ok");
    } finally {
      await server.stop(true);
    }
  });

  test("at most 8 requests are in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async () => {
        peak = Math.max(peak, ++inFlight);
        await Bun.sleep(30);
        inFlight--;
        return Response.json(mainBody());
      },
    });
    try {
      const reqs = Array.from({ length: 24 }, (_, i) => mainReq("minimal", "minimal", i));
      const results = await runPlan(planOf(reqs), opts(`http://127.0.0.1:${server.port}/`));
      expect(results).toHaveLength(24);
      expect(peak).toBe(8);
    } finally {
      await server.stop(true);
    }
  });

  test("a schema rejection is retried", async () => {
    let n = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json(n++ === 0 ? { answers: "bad" } : mainBody()),
    });
    try {
      const p = planOf([mainReq("minimal", "minimal", 0)]);
      const [r] = await runPlan(p, opts(`http://127.0.0.1:${server.port}/`));
      expect(n).toBe(2);
      expect(r?.outcome.kind).toBe("ok");
    } finally {
      await server.stop(true);
    }
  });

  test("miss excluded", async () => {
    fixture = await startJevFixture({ "/": { status: 500 } });
    const p = plan();
    const results = await runPlan(p, opts(fixture.url("/")));
    expect(results.every((r) => r.outcome.kind === "miss")).toBe(true);
    expect(fixture.requests.length).toBe(4);
    const agg = compare(p, results, {
      runId: "r",
      pass: 1,
      samples: { main: 1, workers: 0 },
      config,
    });
    expect(agg.variants["full"]?.misses).toBe(1);
  });

  test("aggregates written only on completion", async () => {
    const dir = mkdtempSync(join(tmpdir(), "run-"));
    const finish = async () => {
      const p = plan();
      const results = await runPlan(p, { ...opts("http://127.0.0.1:1/"), send: true });
      if (results.some((r) => r.outcome.kind === "miss")) throw new Error("run failed");
      writeOutputs(
        dir,
        compare(p, results, { runId: "r", pass: 1, samples: { main: 1, workers: 0 }, config }),
        [],
      );
    };
    await expect(finish()).rejects.toThrow();
    expect(existsSync(join(dir, "aggregates.json"))).toBe(false);
  });

  test("nothing in the repository", async () => {
    const before = Bun.spawnSync(["git", "status", "--porcelain"]).stdout.toString();
    fixture = await startJevFixture({ "/": { json: mainBody() } });
    const agentDir = mkdtempSync(join(tmpdir(), "agent-"));
    const p = plan();
    const results = await runPlan(p, opts(fixture.url("/")));
    const dir = join(agentDir, "jev", "replay", "r");
    const meta = { runId: "r", pass: 1 as const, samples: { main: 1, workers: 0 }, config };
    writeOutputs(
      dir,
      compare(p, results, meta),
      diffCases(p, results, config, () => MARKER),
    );
    expect(readFileSync(join(dir, "aggregates.json"), "utf8")).toContain('"runId"');
    expect(Bun.spawnSync(["git", "status", "--porcelain"]).stdout.toString()).toBe(before);
  });
});
