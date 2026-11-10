import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "bun:test";
import { runReview } from "../../../src/host/review/tool.ts";
import type { Exec, ExecResult, ReviewChoice } from "../../../src/policy/review/cli.ts";

type Opts = Parameters<Exec>[2];
type Call = { command: string; args: string[]; options: Opts; self: unknown };

const ok = (stdout = "", extra: Partial<ExecResult> = {}): ExecResult => ({
  stdout,
  stderr: "",
  code: 0,
  killed: false,
  truncated: false,
  ...extra,
});

const CATALOG = JSON.stringify({ models: [{ slug: "gpt-6-luna", visibility: "list" }] });
const outOf = (args: string[]) => args[args.indexOf("-o") + 1]!;
const isCatalog = (c: { command: string; args: string[] }) =>
  c.command === "codex" && c.args[0] === "debug";

function fake(
  cli: (call: Call, n: number) => ExecResult | Promise<ExecResult>,
  catalog: () => ExecResult | Promise<ExecResult> = () => ok(CATALOG),
) {
  const calls: Call[] = [];
  let n = 0;
  const exec: Exec = async function (this: unknown, command, args, options) {
    const call = { command, args, options, self: this };
    calls.push(call);
    if (isCatalog(call)) return catalog();
    return cli(call, ++n);
  };
  return { exec, calls, cliCalls: () => calls.filter((c) => !isCatalog(c)) };
}

const reviewDirs = () => readdirSync(tmpdir()).filter((f) => f.startsWith("jev-review-"));
const codex: ReviewChoice = { cli: "codex" };
const run = (exec: Exec, choice: ReviewChoice = codex, extra: { signal?: AbortSignal } = {}) =>
  runReview(exec, { choice, brief: "the brief", cwd: "/work", ...extra });
const keys = (o: object) => Object.keys(o);

test("cancelled before start makes no exec call and no temp dir", async () => {
  const before = reviewDirs();
  const ctl = new AbortController();
  ctl.abort();
  const f = fake(() => ok("x"));
  const r = await run(
    f.exec,
    { cli: "codex", model: "luna", effort: "high" },
    { signal: ctl.signal },
  );
  expect(f.calls).toHaveLength(0);
  expect(r.details).toEqual({
    cli: "codex",
    attempts: 1,
    outcome: "cancelled",
    model: "luna",
    effort: "high",
  });
  expect(reviewDirs()).toEqual(before);
});

test("cancelled during model resolve reports the resolved model and creates no temp dir", async () => {
  const before = reviewDirs();
  const ctl = new AbortController();
  const f = fake(
    () => ok("x"),
    () => (ctl.abort(), ok(CATALOG)),
  );
  const r = await run(f.exec, { cli: "codex", model: "luna" }, { signal: ctl.signal });
  expect(f.cliCalls()).toHaveLength(0);
  expect(r.details.outcome).toBe("cancelled");
  expect(r.details.attempts).toBe(1);
  expect(r.details.model).toBe("gpt-6-luna");
  expect(reviewDirs()).toEqual(before);
});

test("cancelled during exec after a retry reports attempts 2", async () => {
  const ctl = new AbortController();
  const f = fake((_c, n) => {
    if (n === 2) ctl.abort();
    return ok("", { killed: true });
  });
  const r = await run(f.exec, codex, { signal: ctl.signal });
  expect(f.cliCalls()).toHaveLength(2);
  expect(r.details.outcome).toBe("cancelled");
  expect(r.details.attempts).toBe(2);
});

test("exec throwing records the error name; a non-Error throw is named Error", async () => {
  const named = await run(
    fake(() => {
      throw new RangeError("x");
    }).exec,
  );
  expect(named.details).toEqual({ cli: "codex", attempts: 1, outcome: "exec-error" });
  expect(named.text).toContain("could not start (RangeError)");
  const bare = await run(fake(() => Promise.reject("boom")).exec);
  expect(bare.text).toContain("could not start (Error)");
  expect(keys(bare.details)).toEqual(["cli", "attempts", "outcome"]);
});

test("exec throwing on the retry reports attempts 2", async () => {
  const f = fake((_c, n) => {
    if (n === 1) return ok("", { killed: true });
    throw new TypeError("x");
  });
  const r = await run(f.exec);
  expect(r.details.outcome).toBe("exec-error");
  expect(r.details.attempts).toBe(2);
});

test("a timeout is retried exactly once, then reported with attempts 2", async () => {
  const f = fake(() => ok("", { killed: true }));
  const r = await run(f.exec);
  expect(f.cliCalls()).toHaveLength(2);
  expect(r.details).toEqual({ cli: "codex", attempts: 2, outcome: "timeout" });
  expect(r.isError).toBe(true);
});

test("a timeout followed by success reports attempts 2 and exit code 0", async () => {
  const f = fake((_c, n) => (n === 1 ? ok("", { killed: true }) : ok("fine")));
  const r = await run(f.exec);
  expect(r.isError).toBe(false);
  expect(r.details).toEqual({ cli: "codex", attempts: 2, outcome: "ok", exitCode: 0 });
});

test("only exit-error carries an exit code", async () => {
  const exit = await run(fake(() => ok("", { code: 3 })).exec);
  expect(exit.details).toEqual({ cli: "codex", attempts: 1, outcome: "exit-error", exitCode: 3 });
  expect(exit.text).toContain("Exit code 3.");
  const nf = await run(fake(() => ok("", { code: 1, stderr: "ENOENT" })).exec);
  expect(keys(nf.details)).toEqual(["cli", "attempts", "outcome"]);
  const tr = await run(fake(() => ok("", { truncated: true, code: 1 })).exec);
  expect(tr.details.outcome).toBe("truncated");
  expect(tr.details.exitCode).toBeUndefined();
  expect(keys(tr.details)).toEqual(["cli", "attempts", "outcome"]);
});

test("details keep the key order cli, attempts, outcome, model, effort, exitCode", async () => {
  const good = await run(fake((c) => (writeFileSync(outOf(c.args), "R"), ok())).exec, {
    cli: "codex",
    model: "m",
    effort: "high",
  });
  expect(keys(good.details)).toEqual(["cli", "attempts", "outcome", "model", "effort", "exitCode"]);
  const bad = await run(fake(() => ok("", { code: 2 })).exec, {
    cli: "codex",
    model: "m",
    effort: "high",
  });
  expect(keys(bad.details)).toEqual(["cli", "attempts", "outcome", "model", "effort", "exitCode"]);
  const oc = await run(fake(() => ok("o")).exec, { cli: "opencode", effort: "low" });
  expect(keys(oc.details)).toEqual(["cli", "attempts", "outcome", "effort", "exitCode"]);
});

test("a blank out file falls back to stdout, a filled one wins", async () => {
  const blank = await run(fake((c) => (writeFileSync(outOf(c.args), "  \n"), ok("STDOUT"))).exec);
  expect(blank.text).toContain("STDOUT");
  const filled = await run(fake((c) => (writeFileSync(outOf(c.args), "FILE"), ok("STDOUT"))).exec);
  expect(filled.text).toContain("FILE");
  expect(filled.text).not.toContain("STDOUT");
});

test("opencode runs without a temp dir or -o", async () => {
  const before = reviewDirs();
  const f = fake(() => ok("OC"));
  const r = await run(f.exec, { cli: "opencode", model: "p/m", effort: "low" });
  expect(reviewDirs()).toEqual(before);
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]!.command).toBe("opencode");
  expect(f.calls[0]!.args.slice(0, 3)).toEqual(["run", "-m", "p/m#low"]);
  expect(f.calls[0]!.args).not.toContain("-o");
  expect(r.text).toContain("OC");
});

test("exec is called detached with cwd, timeout, maxBuffer and a signal only when given", async () => {
  const f = fake(() => ok("x"));
  await run(f.exec);
  const c = f.calls[0]!;
  expect(c.self).toBeUndefined();
  expect(c.command).toBe("codex");
  expect(keys(c.options)).toEqual(["cwd", "timeout", "maxBuffer"]);
  expect(c.options).toEqual({ cwd: "/work", timeout: 600_000, maxBuffer: 8 * 1024 * 1024 });
  expect(c.args).toContain("/work");
});

test("the temp dir is 0700 and removed when exec throws", async () => {
  let dir = "";
  const f = fake((c) => {
    dir = dirname(outOf(c.args));
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    throw new Error("x");
  });
  await run(f.exec);
  expect(dir).not.toBe("");
  expect(existsSync(dir)).toBe(false);
});

test("the temp dir is removed when the code throws after mkdtemp", async () => {
  const before = reviewDirs();
  let reads = 0;
  const choice = {
    cli: "codex" as const,
    get effort() {
      // first read happens while building codex args, after the temp dir exists
      if (reads++ === 0) throw new RangeError("late");
      return "high";
    },
  };
  const f = fake(() => ok("x"));
  const r = await run(f.exec, choice);
  expect(f.calls).toHaveLength(0);
  expect(r.isError).toBe(true);
  expect(r.details.outcome).toBe("exec-error");
  expect(r.text).toContain("could not start (RangeError)");
  expect(reviewDirs()).toEqual(before);
});

test("the out file is removed before the first attempt too", async () => {
  const f = fake((c) => {
    expect(existsSync(outOf(c.args))).toBe(false);
    return ok("x");
  });
  await run(f.exec);
  expect(f.calls).toHaveLength(1);
});
