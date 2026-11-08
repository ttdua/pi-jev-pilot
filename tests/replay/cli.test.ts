import { afterEach, describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { main } from "../../scripts/replay/cli.ts";
import { parseArgs, readConfig, UsageError, workersFor } from "../../scripts/replay/config.ts";
import { type JevFixture, startJevFixture } from "../jev/fixture.ts";
import { tempDir } from "../helpers.ts";
import { mainBody } from "./helpers.ts";

const sessions = join(import.meta.dir, "../fixtures/replay/sessions");
const SECRET = "sk-secret-value-123";

let fixture: JevFixture | undefined;
const dirs: string[] = [];
afterEach(async () => {
  await fixture?.stop();
  fixture = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function agentDir(config?: unknown, state?: unknown): string {
  const dir = tempDir("replay-cli-");
  dirs.push(dir);
  mkdirSync(join(dir, "jev"), { recursive: true });
  if (config !== undefined) writeFileSync(join(dir, "jev", "config.json"), JSON.stringify(config));
  if (state !== undefined) writeFileSync(join(dir, "jev", "state.json"), JSON.stringify(state));
  return dir;
}

async function run(argv: string[], env: Record<string, string | undefined>) {
  const out: string[] = [];
  const err: string[] = [];
  const log = console.log;
  const error = console.error;
  console.log = (...a: unknown[]) => void out.push(a.join(" "));
  console.error = (...a: unknown[]) => void err.push(a.join(" "));
  try {
    const code = await main(argv, env);
    return { code, out: out.join("\n"), err: err.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
  }
}

describe("parseArgs", () => {
  test("parses flags with defaults", () => {
    expect(parseArgs(["--pass", "1"])).toEqual({
      pass: 1,
      seed: 1,
      main: 100,
      send: false,
    });
    const a = parseArgs(["--pass", "1", "--seed", "7", "--send"]);
    expect(a).toMatchObject({ pass: 1, seed: 7, send: true });
  });

  test("pass is required", () => {
    expect(() => parseArgs([])).toThrow(UsageError);
  });

  test("parses --pass report", () => {
    expect(parseArgs(["--pass", "report"]).pass).toBe("report");
  });

  test("--only is refused with report", () => {
    expect(() => parseArgs(["--pass", "report", "--only", "full"])).toThrow(UsageError);
  });

  test("rejects unknown flag and bad values", () => {
    expect(() => parseArgs(["--pass", "1", "--nope"])).toThrow(UsageError);
    expect(() => parseArgs(["--pass", "3"])).toThrow(UsageError);
    expect(() => parseArgs(["--pass", "2"])).toThrow(UsageError);
    expect(() => parseArgs(["--pass", "1", "--kept", "last_decision"])).toThrow(UsageError);
    expect(() => parseArgs(["--pass", "1", "--seed", "x"])).toThrow(UsageError);
  });
});

describe("readConfig", () => {
  test("reads plain JSON", () => {
    const dir = agentDir(
      {
        classifier: { url: "https://x.example/v1", model: "m1", apiKeyEnv: "MY_KEY" },
        tiers: { fast: "a/b" },
        crew: { slots: [{ name: "s", model: "c/d", when: "always" }] },
      },
      { mode: "premium", switches: { expert: false } },
    );
    const c = readConfig(join(dir, "jev"));
    expect(c).toMatchObject({ url: "https://x.example/v1", model: "m1", apiKeyEnv: "MY_KEY" });
    expect(c.plain).toEqual({
      tiers: { fast: "a/b" },
      slots: [{ name: "s", model: "c/d", when: "always" }],
      mode: "premium",
      expertOn: false,
    });
  });

  test("defaults when files are missing", () => {
    const c = readConfig(join(agentDir(), "jev"));
    expect(c).toMatchObject({
      url: "https://api.typesafe.ai/v1/systemone",
      model: "jev-latest",
      apiKeyEnv: "TYPESAFE_API_KEY",
    });
    expect(c.plain).toMatchObject({ mode: "standard", expertOn: true });
  });
});

describe("main", () => {
  test("unknown flag exits 2 with usage", async () => {
    const r = await run(["--pass", "1", "--bogus"], { PI_CODING_AGENT_DIR: agentDir() });
    expect(r.code).toBe(2);
    expect(r.err).toContain("usage:");
  });

  test("dry run prints counts and cost, sends nothing", async () => {
    fixture = await startJevFixture({ "/": { json: mainBody() } });
    const dir = agentDir();
    const r = await run(["--pass", "1", "--sessions", sessions, "--url", fixture.url("/")], {
      PI_CODING_AGENT_DIR: dir,
    });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/requests: \d+/);
    expect(r.out).toMatch(/\$\d+\.\d{2}/);
    expect(r.out).toContain("retries are not");
    expect(r.out).not.toContain("Fix the widget parser");
    expect(fixture.requests.length).toBe(0);
    expect(existsSync(join(dir, "jev", "replay"))).toBe(false);
  });

  test("disallowed url exits 2", async () => {
    const r = await run(["--pass", "1", "--sessions", sessions, "--url", "http://example.com/"], {
      PI_CODING_AGENT_DIR: agentDir(),
    });
    expect(r.code).toBe(2);
  });

  test("--send without a key exits 2 and names only the variable", async () => {
    fixture = await startJevFixture({ "/": { json: mainBody() } });
    const r = await run(
      ["--pass", "1", "--sessions", sessions, "--url", fixture.url("/"), "--send"],
      { PI_CODING_AGENT_DIR: agentDir({ classifier: { apiKeyEnv: "MY_REPLAY_KEY" } }) },
    );
    expect(r.code).toBe(2);
    expect(r.err).toContain("MY_REPLAY_KEY");
    expect(fixture.requests.length).toBe(0);
  });

  test("bad snapshot exits 2", async () => {
    const dir = agentDir();
    const bad = join(dir, "snap.json");
    writeFileSync(bad, '{"v":2}');
    const r = await run(["--pass", "1", "--sessions", sessions, "--capabilities", bad], {
      PI_CODING_AGENT_DIR: dir,
    });
    expect(r.code).toBe(2);
  });

  test("corrupt config.json exits 2", async () => {
    const dir = agentDir();
    writeFileSync(join(dir, "jev", "config.json"), "{not json");
    const r = await run(["--pass", "1", "--sessions", sessions], { PI_CODING_AGENT_DIR: dir });
    expect(r.code).toBe(2);
    expect(r.err).toContain("config.json");
  });

  test("corrupt state.json exits 2", async () => {
    const dir = agentDir();
    writeFileSync(join(dir, "jev", "state.json"), "[1]");
    const r = await run(["--pass", "1", "--sessions", sessions], { PI_CODING_AGENT_DIR: dir });
    expect(r.code).toBe(2);
    expect(r.err).toContain("state.json");
  });

  test("dry run shows the destination url and model", async () => {
    const dir = agentDir({ classifier: { url: "https://x.example/v1", model: "m-dest" } });
    const r = await run(["--pass", "1", "--sessions", sessions], { PI_CODING_AGENT_DIR: dir });
    expect(r.code).toBe(0);
    expect(r.out).toContain("url: https://x.example/v1");
    expect(r.out).toContain("model: m-dest");
  });

  test("unknown pass exits 2 naming 1 and report", async () => {
    const r = await run(["--pass", "2", "--sessions", sessions], {
      PI_CODING_AGENT_DIR: agentDir(),
    });
    expect(r.code).toBe(2);
    expect(r.err).toContain("1");
    expect(r.err).toContain("report");
  });

  test("--kept is an unknown flag and exits 2", async () => {
    const r = await run(["--pass", "1", "--kept", "last_decision", "--sessions", sessions], {
      PI_CODING_AGENT_DIR: agentDir(),
    });
    expect(r.code).toBe(2);
    expect(r.err).toContain("--kept");
  });

  test("--models is accepted and ignored", () => {
    expect(parseArgs(["--pass", "1", "--models", "x.txt"])).toEqual(parseArgs(["--pass", "1"]));
  });

  test("--only parses a list and needs a value", () => {
    expect(parseArgs(["--pass", "1", "--only", "effort-reversed,full"]).only).toEqual([
      "effort-reversed",
      "full",
    ]);
    expect(() => parseArgs(["--pass", "1", "--only"])).toThrow();
    expect(() => parseArgs(["--pass", "1", "--only", ","])).toThrow();
  });

  test("unknown --only variant exits 2", async () => {
    const r = await run(["--pass", "1", "--only", "effort-ordr", "--sessions", sessions], {
      PI_CODING_AGENT_DIR: agentDir(),
    });
    expect(r.code).toBe(2);
    expect(r.err).toContain("effort-ordr");
  });

  test("--send runs against the fixture and writes outputs", async () => {
    fixture = await startJevFixture({ "/": { json: mainBody() } });
    const dir = agentDir({ classifier: { apiKeyEnv: "MY_REPLAY_KEY" } });
    const r = await run(
      ["--pass", "1", "--main", "3", "--sessions", sessions, "--url", fixture.url("/"), "--send"],
      { PI_CODING_AGENT_DIR: dir, MY_REPLAY_KEY: SECRET },
    );
    expect(r.code).toBe(0);
    expect(fixture.requests.length).toBeGreaterThan(0);
    expect(r.out + r.err).not.toContain(SECRET);
    const [runId] = readdirSync(join(dir, "jev", "replay"));
    expect(runId).toMatch(/-pass1$/);
    const file = join(dir, "jev", "replay", runId!, "aggregates.json");
    const agg = JSON.parse(readFileSync(file, "utf8")) as { pass: number };
    expect(agg.pass).toBe(1);
    expect(r.out).toContain(join(dir, "jev", "replay", runId!));
  });
});

describe("report pass", () => {
  const MARKER = "JEV-MARKER-PROMPT";
  const agent = (name: string) => ({
    name,
    source: "global",
    description: `${name} agent`,
    instructionsExcerpt: "",
    declaredTools: null,
    maxTurns: null,
    sets: { model: false, thinking: false },
  });

  /** A copy of the session corpus with one extra prompt that carries the marker. */
  function markerCorpus(): string {
    const dir = tempDir("replay-report-");
    dirs.push(dir);
    cpSync(sessions, join(dir, "sessions"), { recursive: true });
    const lines = [
      { type: "session", version: 3, id: "s-marker", timestamp: "2026-02-01T00:00:00Z", cwd: "/m" },
      {
        type: "message",
        id: "m1",
        parentId: null,
        timestamp: "2026-02-01T00:00:01Z",
        message: { role: "user", content: `${MARKER} tidy the parser` },
      },
    ];
    writeFileSync(
      join(dir, "sessions", "marker.jsonl"),
      `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`,
    );
    return join(dir, "sessions");
  }

  function snapshot(dir: string): string {
    const path = join(dir, "caps.json");
    const agents = ["scout", "worker", "reviewer", "general"].map(agent);
    writeFileSync(path, JSON.stringify({ v: 1, tools: [], agents }));
    return path;
  }

  /** Loopback Jev that answers a prompt `high` effort the second time it sees it. */
  function flippingJev(): { url: string; count: () => number; stop: () => void } {
    const seen = new Map<string, number>();
    let total = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        total++;
        const body = await req.text();
        const prompt = body.includes(MARKER) ? MARKER : body;
        const n = (seen.get(prompt) ?? 0) + 1;
        seen.set(prompt, n);
        return Response.json(mainBody({ effort: prompt === MARKER && n > 1 ? "high" : "low" }));
      },
    });
    return {
      url: `http://127.0.0.1:${server.port}/`,
      count: () => total,
      stop: () => void server.stop(true),
    };
  }

  test("report dry run sends nothing and prints the estimate", async () => {
    fixture = await startJevFixture({ "/": { json: mainBody() } });
    const dir = agentDir();
    const r = await run(["--pass", "report", "--sessions", sessions, "--url", fixture.url("/")], {
      PI_CODING_AGENT_DIR: dir,
    });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/requests: \d+/);
    expect(r.out).toMatch(/cost: \$/);
    expect(fixture.requests.length).toBe(0);
    expect(existsSync(join(dir, "jev", "replay"))).toBe(false);
  });

  test("report send keeps the prompt out of aggregates and in cases.md", async () => {
    const corpus = markerCorpus();
    const dir = agentDir({ classifier: { apiKeyEnv: "MY_REPLAY_KEY" } });
    const caps = snapshot(dir);
    const jev = flippingJev();
    try {
      const base = ["--pass", "report", "--sessions", corpus, "--capabilities", caps];
      const dry = await run([...base, "--url", jev.url], { PI_CODING_AGENT_DIR: dir });
      const planned = Number(/requests: (\d+)/.exec(dry.out)?.[1]);
      expect(planned).toBeGreaterThan(0);
      expect(jev.count()).toBe(0);
      const r = await run([...base, "--url", jev.url, "--send"], {
        PI_CODING_AGENT_DIR: dir,
        MY_REPLAY_KEY: SECRET,
      });
      expect(r.code).toBe(0);
      expect(jev.count()).toBe(planned);
      const [runId] = readdirSync(join(dir, "jev", "replay"));
      expect(runId).toMatch(/-report$/);
      const out = join(dir, "jev", "replay", runId!);
      const raw = readFileSync(join(out, "aggregates.json"), "utf8");
      expect((JSON.parse(raw) as { pass: string }).pass).toBe("report");
      expect(raw).not.toContain(MARKER);
      expect(readFileSync(join(out, "cases.md"), "utf8")).toContain(MARKER);
    } finally {
      jev.stop();
    }
  });

  test("report with Jev down writes aggregates and counts every request a miss", async () => {
    fixture = await startJevFixture({ "/": { json: {}, status: 500 } });
    const dir = agentDir({ classifier: { apiKeyEnv: "MY_REPLAY_KEY" } });
    const argv = [
      "--pass",
      "report",
      "--sessions",
      markerCorpus(),
      "--capabilities",
      snapshot(dir),
    ];
    const r = await run([...argv, "--url", fixture.url("/"), "--send"], {
      PI_CODING_AGENT_DIR: dir,
      MY_REPLAY_KEY: SECRET,
    });
    expect(r.code).toBe(0);
    const [runId] = readdirSync(join(dir, "jev", "replay"));
    const agg = JSON.parse(
      readFileSync(join(dir, "jev", "replay", runId!, "aggregates.json"), "utf8"),
    ) as { misses: Record<string, number> };
    const misses = Object.values(agg.misses).reduce((a, b) => a + b, 0);
    expect(misses).toBeGreaterThan(0);
    expect(misses).toBe(Number(/requests: (\d+)/.exec(r.out)?.[1]));
  });

  test("workers default to 200 for report and 46 for pass 1", () => {
    expect(workersFor(parseArgs(["--pass", "report"]))).toBe(200);
    expect(workersFor(parseArgs(["--pass", "1"]))).toBe(46);
    expect(workersFor(parseArgs(["--pass", "report", "--workers", "5"]))).toBe(5);
    expect(workersFor(parseArgs(["--pass", "1", "--workers", "5"]))).toBe(5);
  });
});
