import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "../../scripts/replay/cli.ts";
import { parseArgs, readConfig, UsageError } from "../../scripts/replay/config.ts";
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
      workers: 46,
      send: false,
    });
    const a = parseArgs(["--pass", "2", "--kept", "last_decision", "--seed", "7", "--send"]);
    expect(a).toMatchObject({ pass: 2, kept: ["last_decision"], seed: 7, send: true });
  });

  test("pass is required", () => {
    expect(() => parseArgs([])).toThrow(UsageError);
  });

  test("rejects unknown flag and bad values", () => {
    expect(() => parseArgs(["--pass", "1", "--nope"])).toThrow(UsageError);
    expect(() => parseArgs(["--pass", "3"])).toThrow(UsageError);
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

  test("--kept git exits 2", async () => {
    const r = await run(["--pass", "2", "--kept", "git", "--sessions", sessions], {
      PI_CODING_AGENT_DIR: agentDir(),
    });
    expect(r.code).toBe(2);
    expect(r.err).toContain("git");
  });

  test("--pass 2 keeping capabilities needs --capabilities", async () => {
    const r = await run(["--pass", "2", "--kept", "capabilities", "--sessions", sessions], {
      PI_CODING_AGENT_DIR: agentDir(),
    });
    expect(r.code).toBe(2);
    expect(r.err).toContain("--capabilities");
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

  test("bad --kept exits 2", async () => {
    const r = await run(
      ["--pass", "2", "--kept", "last_decision,nonsense", "--sessions", sessions],
      {
        PI_CODING_AGENT_DIR: agentDir(),
      },
    );
    expect(r.code).toBe(2);
    expect(r.err).toContain("nonsense");
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
