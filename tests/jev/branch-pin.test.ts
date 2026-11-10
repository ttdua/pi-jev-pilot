import { describe, expect, test } from "bun:test";
import { branchItems, type SessionEntryLike } from "../../src/jev/branch.ts";

const msg = (message: unknown): SessionEntryLike => ({ type: "message", message });
const call = (id: unknown, name: unknown) => ({ type: "toolCall", id, name, arguments: { a: 1 } });

describe("branchItems pin: user", () => {
  test("string, parts, missing and non-text content", () => {
    expect(
      branchItems([
        msg({ role: "user", content: "hi" }),
        msg({ role: "user" }),
        msg({ role: "user", content: 5 }),
        msg({
          role: "user",
          content: [
            null,
            { type: "text", text: 3 },
            { type: "text", text: "a" },
            { type: "text", text: "b" },
            "x",
          ],
        }),
      ]),
    ).toEqual([
      { role: "user", text: "hi", tools: [] },
      { role: "user", text: "", tools: [] },
      { role: "user", text: "", tools: [] },
      { role: "user", text: "a\nb", tools: [] },
    ]);
  });

  test("user toolCall parts are not read as tools", () => {
    const [item] = branchItems([msg({ role: "user", content: [call("c", "bash")] })]);
    expect(item).toEqual({ role: "user", text: "", tools: [] });
  });
});

describe("branchItems pin: assistant", () => {
  test("string content has no tools; non-array content yields empty text and tools", () => {
    expect(
      branchItems([msg({ role: "assistant", content: "plain" }), msg({ role: "assistant" })]),
    ).toEqual([
      { role: "assistant", text: "plain", tools: [] },
      { role: "assistant", text: "", tools: [] },
    ]);
  });

  test("tool parts need a string name; id is optional; malformed parts are skipped", () => {
    const [item] = branchItems([
      msg({
        role: "assistant",
        content: [
          null,
          { type: "toolCall" },
          call("a", 7),
          { type: "tool", name: "no" },
          call(undefined, "noid"),
          call("b", "read"),
          { type: "text", text: "t" },
        ],
      }),
    ]);
    expect(item).toEqual({
      role: "assistant",
      text: "t",
      tools: [{ name: "noid" }, { name: "read" }],
    });
  });
});

describe("branchItems pin: tool results", () => {
  test("isError only counts when strictly true", () => {
    const items = branchItems([
      msg({ role: "toolResult", isError: true }),
      msg({ role: "toolResult", isError: "true" }),
      msg({ role: "toolResult", isError: 1 }),
      msg({ role: "toolResult", isError: false }),
      msg({ role: "toolResult" }),
    ]);
    expect(items).toEqual([
      { role: "toolResult", text: "", tools: [], isError: true },
      { role: "toolResult", text: "", tools: [] },
      { role: "toolResult", text: "", tools: [] },
      { role: "toolResult", text: "", tools: [] },
      { role: "toolResult", text: "", tools: [] },
    ]);
  });

  test("a failed result marks the matching call, even from an earlier assistant item", () => {
    const items = branchItems([
      msg({ role: "assistant", content: [call("c1", "bash")] }),
      msg({ role: "user", content: "between" }),
      msg({ role: "toolResult", toolCallId: "c1", isError: true }),
    ]);
    expect(items[0]).toEqual({
      role: "assistant",
      text: "",
      tools: [{ name: "bash", failed: true }],
    });
    expect(items[2]).toEqual({ role: "toolResult", text: "", tools: [], isError: true });
  });

  test("successful, unmatched, id-less and empty-id results mark nothing", () => {
    const items = branchItems([
      msg({ role: "assistant", content: [call("c1", "bash"), call("", "empty")] }),
      msg({ role: "toolResult", toolCallId: "c1", isError: false }),
      msg({ role: "toolResult", toolCallId: "zzz", isError: true }),
      msg({ role: "toolResult", isError: true }),
      msg({ role: "toolResult", toolCallId: "", isError: true }),
    ]);
    expect(items[0]).toEqual({
      role: "assistant",
      text: "",
      tools: [{ name: "bash" }, { name: "empty" }],
    });
  });

  test("a result before its call does not mark it", () => {
    const items = branchItems([
      msg({ role: "toolResult", toolCallId: "c1", isError: true }),
      msg({ role: "assistant", content: [call("c1", "bash")] }),
    ]);
    expect(items[1]).toEqual({ role: "assistant", text: "", tools: [{ name: "bash" }] });
  });

  test("a repeated call id binds to the latest tool", () => {
    const items = branchItems([
      msg({ role: "assistant", content: [call("d", "first")] }),
      msg({ role: "assistant", content: [call("d", "second")] }),
      msg({ role: "toolResult", toolCallId: "d", isError: true }),
    ]);
    expect(items[0]?.tools).toEqual([{ name: "first" }]);
    expect(items[1]?.tools).toEqual([{ name: "second", failed: true }]);
  });

  test("two failed results for one call mark it once", () => {
    const items = branchItems([
      msg({ role: "assistant", content: [call("d", "x")] }),
      msg({ role: "toolResult", toolCallId: "d", isError: true }),
      msg({ role: "toolResult", toolCallId: "d", isError: true }),
    ]);
    expect(items[0]?.tools).toEqual([{ name: "x", failed: true }]);
    expect(items).toHaveLength(3);
  });
});

describe("branchItems pin: other entries", () => {
  test("only message entries are read; unknown roles and custom/compaction entries are skipped", () => {
    expect(
      branchItems([
        { type: "custom", customType: "jev-turn", data: { turnId: "T" } },
        { type: "compaction" },
        { type: "branch_summary" },
        { type: "custom_message", customType: "x", message: { role: "user", content: "no" } },
        msg({ role: "system", content: "x" }),
        msg({ role: "bashExecution" }),
        msg({ role: "custom" }),
        msg({}),
      ]),
    ).toEqual([]);
  });

  test("a message entry without a message object throws (not swallowed)", () => {
    expect(() => branchItems([{ type: "message" }])).toThrow(TypeError);
    expect(() => branchItems([msg(null)])).toThrow(TypeError);
  });

  test("empty input and output order follow input order", () => {
    expect(branchItems([])).toEqual([]);
    const roles = branchItems([
      msg({ role: "toolResult" }),
      msg({ role: "user", content: "u" }),
      msg({ role: "assistant", content: "a" }),
    ]).map((i) => i.role);
    expect(roles).toEqual(["toolResult", "user", "assistant"]);
  });

  test("result items carry isError last; keys are role,text,tools[,isError]", () => {
    const [bad, ok] = branchItems([
      msg({ role: "toolResult", isError: true }),
      msg({ role: "toolResult" }),
    ]);
    expect(Object.keys(bad!)).toEqual(["role", "text", "tools", "isError"]);
    expect(Object.keys(ok!)).toEqual(["role", "text", "tools"]);
  });
});
