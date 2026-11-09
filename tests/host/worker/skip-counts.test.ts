import { afterEach, beforeEach, expect, test } from "bun:test";
import { putToolCounts, takeToolCounts } from "../../../src/host/tools/counts.ts";
import { base, harness } from "../worker-fakes.ts";

const saved = process.env.TYPESAFE_API_KEY;
beforeEach(() => {
  process.env.TYPESAFE_API_KEY = "k";
});
afterEach(() => {
  if (saved === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = saved;
});

test("a launch that writes no line leaves the agent's tool counts in place", async () => {
  const h = harness();
  h.setScript(() => ({ kind: "cancelled" }));
  putToolCounts("ag-s1", { toolsScored: 5, toolsFlagged: 2 });
  const input = base();

  await h.fire("message_end", h.msg(["s1", input]));
  await h.fire("tool_call", h.call("s1", input));
  await h.fire("tool_result", h.result("s1", "ag-s1"));
  await h.emit("subagents:completed", { id: "ag-s1", status: "completed" });

  expect(h.lines).toHaveLength(0);
  expect(takeToolCounts("ag-s1")).toEqual({ toolsScored: 5, toolsFlagged: 2 });
});
