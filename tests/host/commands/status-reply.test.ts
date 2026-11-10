import { describe, expect, test } from "bun:test";
import { statusReply } from "../../../src/host/commands/status-reply.ts";
import { formatStatus } from "../../../src/host/commands/status-format.ts";
import { EMPTY_TALLY } from "../../../src/host/status/line.ts";
import { buildSnapshot } from "../../../src/host/platform/readiness.ts";
import type { Config } from "../../../src/store/config.ts";

const snap = (localMode?: "budget") =>
  buildSnapshot({
    configRead: { kind: "ok", present: true, config: {} as Config },
    stateRead: { kind: "ok", state: {} },
    env: { TYPESAFE_API_KEY: "k" },
    toolNames: ["subagent"],
    ...(localMode === undefined ? {} : { localModeRead: { kind: "ok" as const, mode: localMode } }),
  });

describe("statusReply", () => {
  test("the plain reply is the empty-tally status at info", () => {
    const s = snap();
    expect(statusReply({ kind: "status" }, s, {}, undefined)).toEqual({
      text: formatStatus(s, EMPTY_TALLY, undefined),
      level: "info",
    });
  });
  test("tally and window are read through the readers object", () => {
    const seen: unknown[] = [];
    const readers = {
      tally(this: unknown) {
        seen.push(this);
        return { ...EMPTY_TALLY, prompts: 3 };
      },
      window(this: unknown) {
        seen.push(this);
        return [];
      },
    };
    const out = statusReply({ kind: "status" }, snap(), readers, undefined);
    expect(out.text).toContain("prompts 3");
    expect(seen).toEqual([readers, readers]);
  });
  test("a partial-reset line leads and the level is a warning", () => {
    const out = statusReply({ kind: "reset" }, snap(), {}, "partial!");
    expect(out.text.split("\n")[0]).toBe("partial!");
    expect(out.level).toBe("warning");
  });
  test("a global mode shadowed by a directory mode adds the last line", () => {
    const out = statusReply(
      { kind: "mode", mode: "premium", target: "global" },
      snap("budget"),
      {},
      undefined,
    );
    expect(out.text.split("\n").at(-1)).toBe(
      "directory mode budget still applies here; global mode is now premium",
    );
  });
  test("no shadowed line for a local mode change or an unshadowed global", () => {
    for (const [args, s] of [
      [{ kind: "mode", mode: "premium", target: "local" }, snap("budget")],
      [{ kind: "mode", mode: "premium", target: "global" }, snap()],
    ] as const) {
      expect(statusReply(args, s, {}, undefined).text).not.toContain("still applies here");
    }
  });
});
