import { expect, test } from "bun:test";
import { execOptions, runAttempt } from "../../../src/host/review/attempt.ts";
import type { Exec, ExecResult } from "../../../src/policy/review/index.ts";

const res: ExecResult = { stdout: "o", stderr: "", code: 0, killed: false, truncated: false };

test("execOptions adds the signal only when given", () => {
  const ctl = new AbortController();
  expect(Object.keys(execOptions("/w", 5))).toEqual(["cwd", "timeout", "maxBuffer"]);
  expect(Object.keys(execOptions("/w", 5, ctl.signal))).toEqual([
    "cwd",
    "timeout",
    "signal",
    "maxBuffer",
  ]);
});

test("runAttempt returns the exec result", async () => {
  let seen: unknown[] = [];
  const exec: Exec = async (c, a, o) => ((seen = [c, a, o]), res);
  const a = await runAttempt(exec, "codex", ["x"], { cwd: "/w" });
  expect(a).toEqual({ ok: true, r: res });
  expect(seen).toEqual([
    "codex",
    ["x"],
    { cwd: "/w", timeout: 600_000, maxBuffer: 8 * 1024 * 1024 },
  ]);
});

test("runAttempt maps a throw to the error name, or cancelled when aborted", async () => {
  const boom: Exec = async () => {
    throw new TypeError("x");
  };
  expect(await runAttempt(boom, "c", [], { cwd: "/w" })).toEqual({
    ok: false,
    cancelled: false,
    errorName: "TypeError",
  });
  const bare: Exec = () => Promise.reject("s");
  expect((await runAttempt(bare, "c", [], { cwd: "/w" })) as { errorName: string }).toMatchObject({
    errorName: "Error",
  });
  const ctl = new AbortController();
  const abort: Exec = async () => {
    ctl.abort();
    throw new Error("a");
  };
  expect(await runAttempt(abort, "c", [], { cwd: "/w", signal: ctl.signal })).toMatchObject({
    ok: false,
    cancelled: true,
  });
});
