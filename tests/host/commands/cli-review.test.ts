import { describe, expect, test } from "bun:test";
import { checkCliReview } from "../../../src/host/commands/cli-review.ts";
import type { Exec } from "../../../src/policy/review/cli.ts";

const res = (stdout: string, over: object = {}) => ({
  stdout,
  stderr: "",
  code: 0,
  killed: false,
  truncated: false,
  ...over,
});
function fake(r: Awaited<ReturnType<Exec>> | Error) {
  const calls: [string, string[]][] = [];
  const exec: Exec = async (c, a) => {
    calls.push([c, a]);
    if (r instanceof Error) throw r;
    return r;
  };
  return { exec, calls };
}
const CODEX = JSON.stringify({
  models: [
    {
      slug: "gpt-6-luna",
      display_name: "GPT-6-Luna",
      visibility: "list",
      supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }],
    },
  ],
});

describe("checkCliReview", () => {
  test("a bare reviewer is stored as typed and never execs", async () => {
    const f = fake(res(""));
    expect(await checkCliReview({ kind: "cli-review", cli: "codex" }, f.exec)).toEqual({
      ok: true,
      choice: { model: undefined, effort: undefined },
    });
    expect(f.calls).toEqual([]);
  });
  test("a codex effort alone does not exec", async () => {
    const f = fake(res(""));
    const out = await checkCliReview({ kind: "cli-review", cli: "codex", effort: "high" }, f.exec);
    expect(out.ok).toBe(true);
    expect(f.calls).toEqual([]);
  });
  test("an OpenCode effort without a model is refused without exec", async () => {
    const f = fake(res(""));
    const out = await checkCliReview({ kind: "cli-review", cli: "opencode", effort: "x" }, f.exec);
    expect(out.ok).toBe(false);
    expect(f.calls).toEqual([]);
  });
  test("a state-rule violation is refused as path: message lines before any exec", async () => {
    const f = fake(res(""));
    const out = await checkCliReview(
      { kind: "cli-review", cli: "codex", model: "x".repeat(300) },
      f.exec,
    );
    expect(out).toMatchObject({ ok: false });
    expect((out as { message: string }).message).toMatch(/^cliReview\.model: /);
    expect(f.calls).toEqual([]);
  });
  test("a codex model is resolved against the catalog", async () => {
    const f = fake(res(CODEX));
    const out = await checkCliReview(
      { kind: "cli-review", cli: "codex", model: "luna", effort: "high" },
      f.exec,
    );
    expect(f.calls).toEqual([["codex", ["debug", "models"]]]);
    expect(out).toMatchObject({ ok: true });
    expect((out as { warning?: string }).warning).toBeUndefined();
  });
  test("an unknown model is refused with its suggestions", async () => {
    const f = fake(res("a/luna\na/nebula\n"));
    const out = await checkCliReview({ kind: "cli-review", cli: "opencode", model: "lun" }, f.exec);
    expect(out).toEqual({ ok: false, message: 'Unknown OpenCode model "lun".\nTry: a/luna' });
  });
  test("a throwing exec warns and keeps the typed choice", async () => {
    const out = await checkCliReview(
      { kind: "cli-review", cli: "codex", model: "m" },
      fake(new Error("x")).exec,
    );
    expect(out).toEqual({
      ok: true,
      choice: { model: "m", effort: undefined },
      warning: "CLI review model not checked: could not read the model list.",
    });
  });
  test("a non-zero exit, a kill or an empty list is unreadable", async () => {
    for (const r of [res("a/b", { code: 1 }), res("a/b", { killed: true }), res("")]) {
      const out = await checkCliReview(
        { kind: "cli-review", cli: "opencode", model: "m" },
        fake(r).exec,
      );
      expect((out as { warning?: string }).warning).toContain("could not read the model list");
    }
  });
  test("ENOENT on stderr with no output names the missing CLI", async () => {
    const out = await checkCliReview(
      { kind: "cli-review", cli: "codex", model: "m" },
      fake(res("", { code: 1, stderr: "ENOENT" })).exec,
    );
    expect((out as { warning?: string }).warning).toBe(
      "CLI review model not checked: codex not found.",
    );
  });
});
