import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workerSamples } from "../../scripts/replay/corpus.ts";

const root = mkdtempSync(join(tmpdir(), "replay-pin-workers-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;

const header = { type: "session", id: "s1", cwd: "/w" };
const user = (id: string, parentId: string | null, text: string) => ({
  type: "message",
  id,
  parentId,
  message: { role: "user", content: text },
});
const assistant = (id: string, parentId: string | null, content: unknown) => ({
  type: "message",
  id,
  parentId,
  message: { role: "assistant", content },
});
const call = (args: unknown, name = "subagent") => ({ type: "toolCall", name, arguments: args });

/** Writes one session file in a fresh dir and returns the worker samples. */
function run(lines: unknown[]) {
  const dir = join(root, `d${n++}`);
  require("node:fs").mkdirSync(dir);
  writeFileSync(join(dir, "s.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n"));
  return workerSamples(dir);
}
const withCalls = (...parts: unknown[]) => [
  header,
  user("u1", null, "  parent prompt  "),
  assistant("a1", "u1", parts),
];

describe("workerSamples launch shapes", () => {
  test("single launch with agent/task", () => {
    expect(run(withCalls(call({ agent: "scout", task: "look" })))).toEqual([
      {
        session: "s1",
        agent: "scout",
        brief: "look",
        parentPrompt: "parent prompt",
        runInBackground: false,
      },
    ]);
  });

  test("subagent_type/prompt aliases, description kept, key order", () => {
    const [w] = run(
      withCalls(
        call({ subagent_type: "x", prompt: "p", description: "d", run_in_background: true }),
      ),
    );
    expect(w).toEqual({
      session: "s1",
      agent: "x",
      brief: "p",
      description: "d",
      parentPrompt: "parent prompt",
      runInBackground: true,
    });
    expect(Object.keys(w!)).toEqual([
      "session",
      "agent",
      "brief",
      "description",
      "parentPrompt",
      "runInBackground",
    ]);
  });

  test("agent wins over subagent_type, task over prompt", () => {
    const [w] = run(withCalls(call({ agent: "a", subagent_type: "b", task: "t", prompt: "p" })));
    expect([w!.agent, w!.brief]).toEqual(["a", "t"]);
  });

  test("empty-string agent or brief drops the launch (no fall-through to the alias)", () => {
    expect(run(withCalls(call({ agent: "", subagent_type: "b", task: "t" })))).toEqual([]);
    expect(run(withCalls(call({ agent: "a", task: "", prompt: "p" })))).toEqual([]);
  });

  test("async true means background; run_in_background only when exactly true", () => {
    const got = run(
      withCalls(
        call({ agent: "a", task: "1", async: true }),
        call({ agent: "a", task: "2", async: "true" }),
        call({ agent: "a", task: "3", run_in_background: true }),
        call({ agent: "a", task: "4", run_in_background: 1 }),
      ),
    );
    expect(got.map((w) => w.runInBackground)).toEqual([true, false, true, false]);
  });

  test("empty description is omitted", () => {
    const [w] = run(withCalls(call({ agent: "a", task: "t", description: "" })));
    expect("description" in w!).toBe(false);
  });

  test("nested args.tasks launches in order, skipping malformed items", () => {
    const got = run(
      withCalls(
        call({
          args: {
            tasks: [
              { agent: "a", task: "1" },
              null,
              "str",
              { agent: "b" },
              { task: "no agent" },
              { agent: "c", task: "3", async: true },
            ],
          },
        }),
      ),
    );
    expect(got.map((w) => [w.agent, w.brief, w.runInBackground])).toEqual([
      ["a", "1", false],
      ["c", "3", true],
    ]);
  });

  test("args.tasks that is not an array falls back to the top-level object", () => {
    const got = run(withCalls(call({ agent: "top", task: "t", args: { tasks: "x" } })));
    expect(got.map((w) => w.agent)).toEqual(["top"]);
  });

  test("args that is not an object falls back to the top-level object", () => {
    const got = run(withCalls(call({ agent: "top", task: "t", args: 3 })));
    expect(got.map((w) => w.agent)).toEqual(["top"]);
  });

  test("empty tasks array yields nothing", () => {
    expect(run(withCalls(call({ agent: "top", task: "t", args: { tasks: [] } })))).toEqual([]);
  });

  test("non-object arguments yield nothing", () => {
    expect(run(withCalls(call(null), call("x"), call(undefined), call(7)))).toEqual([]);
  });

  test("other tools, non-toolCall parts and non-object parts are ignored", () => {
    const got = run(
      withCalls(
        call({ agent: "a", task: "t" }, "bash"),
        { type: "text", text: "hi" },
        null,
        "x",
        call({ agent: "ok", task: "t" }),
      ),
    );
    expect(got.map((w) => w.agent)).toEqual(["ok"]);
  });

  test("non-assistant, non-array content and id-less entries are ignored", () => {
    const got = run([
      header,
      user("u1", null, "p"),
      assistant("a1", "u1", "plain string"),
      {
        type: "message",
        parentId: "u1",
        message: { role: "assistant", content: [call({ agent: "z", task: "t" })] },
      },
      { type: "custom", id: "c1", parentId: "u1" },
    ]);
    expect(got).toEqual([]);
  });

  test("no parent prompt omits the key; nearest earlier prompt is used", () => {
    const none = run([header, assistant("a1", null, [call({ agent: "a", task: "t" })])]);
    expect("parentPrompt" in none[0]!).toBe(false);
    const nearest = run([
      header,
      user("u1", null, "first"),
      assistant("a1", "u1", []),
      user("u2", "a1", "second"),
      assistant("a2", "u2", [call({ agent: "a", task: "t" })]),
    ]);
    expect(nearest[0]!.parentPrompt).toBe("second");
  });

  test("several calls produce samples in call order", () => {
    const got = run(
      withCalls(
        call({ agent: "a", task: "1" }),
        call({ args: { tasks: [{ agent: "b", task: "2" }] } }),
      ),
    );
    expect(got.map((w) => w.brief)).toEqual(["1", "2"]);
  });
});
