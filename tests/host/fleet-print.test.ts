// Print mode with the fleet list on and off (spec `fleet-view`, "Fleet list placement and visibility").
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../helpers";
import { startFixture, type Fixture, type RecordedRequest, type ScriptEntry } from "./fixture";
import { runOnce } from "./harness";

const fixtures: Fixture[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const KEY = { TYPESAFE_API_KEY: "test-key" };
const TIMEOUT = 90_000;
const BRIEF = "CHILD-TASK answer plainly";
const CHILD_MODEL = "fixture-balanced";

type Msg = { role?: string; content?: unknown };
const messages = (r: RecordedRequest): Msg[] =>
  Array.isArray(r.body.messages) ? (r.body.messages as Msg[]) : [];
const lastIsUser = (r: RecordedRequest, text: string): boolean => {
  const last = messages(r).at(-1);
  return last?.role === "user" && JSON.stringify(last).includes(text);
};

/** The main model launches one foreground child; the child and the main then answer in text. */
const script: ScriptEntry[] = [
  {
    name: "main-launch",
    match: (r) => r.model === "fixture-main" && lastIsUser(r, "launch"),
    reply: {
      toolCalls: [
        {
          name: "subagent",
          arguments: {
            prompt: BRIEF,
            description: "fleet probe",
            subagent_type: "general-purpose",
            model: `fixture/${CHILD_MODEL}`,
            thinking: "low",
          },
        },
      ],
    },
    times: 1,
  },
  {
    name: "child",
    match: (r) => JSON.stringify(messages(r).find((m) => m.role === "user")).includes("CHILD-TASK"),
    reply: { text: "child done" },
  },
  { name: "main-after", match: (r) => r.model === "fixture-main", reply: { text: "all done" } },
];

async function run(fleetView: boolean) {
  const fixture = await startFixture(script);
  fixtures.push(fixture);
  const agentDir = tempDir("fleet-print-agent-");
  const cwd = tempDir("fleet-print-cwd-");
  dirs.push(agentDir, cwd);
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(join(cwd, ".pi", "subagents.json"), JSON.stringify({ fleetView }));
  const result = await runOnce({
    fixture,
    mode: "print",
    message: "launch",
    self: false,
    install: "executor-only",
    agentDir,
    cwd,
    env: KEY,
  });
  // The child really ran: the fixture saw a request to the child model whose user message is the brief.
  const childRan = fixture.requests.some(
    (r) =>
      r.model === CHILD_MODEL &&
      JSON.stringify(messages(r).find((m) => m.role === "user")).includes(BRIEF),
  );
  expect(childRan).toBe(true);
  return result;
}

describe("print mode", () => {
  test(
    "print mode output is identical with fleetView on and off",
    async () => {
      const on = await run(true);
      const off = await run(false);

      expect(on.code).toBe(0);
      expect(off.code).toBe(0);
      expect(on.stdout).toBe(off.stdout);
      expect(on.stdout).toContain("all done");
    },
    TIMEOUT,
  );
});
