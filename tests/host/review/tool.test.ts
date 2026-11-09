import { existsSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "bun:test";
import { runReview } from "../../../src/host/review/tool.ts";
import type { Exec, ExecResult, ReviewChoice } from "../../../src/policy/review/cli.ts";

type Opts = Parameters<Exec>[2];
type Call = { command: string; args: string[]; options: Opts };

const ok = (stdout = "", extra: Partial<ExecResult> = {}): ExecResult => ({
  stdout,
  stderr: "",
  code: 0,
  killed: false,
  truncated: false,
  ...extra,
});

const CATALOG = JSON.stringify({
  models: [
    { slug: "gpt-5.6-luna", visibility: "list" },
    { slug: "gpt-6-luna", visibility: "list" },
  ],
});

function outOf(args: string[]): string {
  return args[args.indexOf("-o") + 1]!;
}

/** Records calls; `cli` handles non-catalog calls, `catalog` the `debug models` call. */
function fake(
  cli: (call: Call, n: number) => ExecResult | Promise<ExecResult>,
  catalog: () => ExecResult | Promise<ExecResult> = () => ok(CATALOG),
) {
  const calls: Call[] = [];
  let cliCalls = 0;
  const exec: Exec = async (command, args, options) => {
    const call = { command, args, options };
    calls.push(call);
    if (command === "codex" && args[0] === "debug") return catalog();
    cliCalls++;
    return cli(call, cliCalls);
  };
  return { exec, calls, cliCalls: () => calls.filter((c) => !(c.args[0] === "debug")) };
}

const codex: ReviewChoice = { cli: "codex" };
const run = (exec: Exec, choice: ReviewChoice = codex, extra: { signal?: AbortSignal } = {}) =>
  runReview(exec, { choice, brief: "the brief", cwd: "/work", ...extra });

test("codex success reads -o", async () => {
  const f = fake((c) => {
    writeFileSync(outOf(c.args), "VERDICT: PASS");
    return ok("noise");
  });
  const r = await run(f.exec);
  expect(r.isError).toBe(false);
  expect(r.text).toContain("VERDICT: PASS");
  expect(r.text).not.toContain("noise");
  expect(r.details).toMatchObject({ cli: "codex", outcome: "ok", attempts: 1, exitCode: 0 });
});

test("empty -o falls back to stdout", async () => {
  const f = fake((c) => {
    writeFileSync(outOf(c.args), "  \n");
    return ok("from stdout");
  });
  const r = await run(f.exec);
  expect(r.text).toContain("from stdout");
});

test("missing -o falls back to stdout", async () => {
  const f = fake(() => ok("only stdout"));
  expect((await run(f.exec)).text).toContain("only stdout");
});

test("output directory placement and cleanup", async () => {
  let dir = "";
  const seen = (c: Call) => {
    dir = dirname(outOf(c.args));
    expect(dir.startsWith(tmpdir())).toBe(true);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  };
  await run(fake((c) => (seen(c), ok("a"))).exec);
  expect(existsSync(dir)).toBe(false);
  await run(fake((c) => (seen(c), ok("", { code: 2 }))).exec);
  expect(existsSync(dir)).toBe(false);
  await run(fake((c) => (seen(c), ok("", { killed: true }))).exec);
  expect(existsSync(dir)).toBe(false);
  await run(fake((c) => (seen(c), Promise.reject(new Error("x")))).exec);
  expect(existsSync(dir)).toBe(false);
});

test("removes the output file before each attempt", async () => {
  const f = fake((c, n) => {
    const out = outOf(c.args);
    if (n === 1) {
      writeFileSync(out, "PARTIAL");
      return ok("", { killed: true });
    }
    expect(existsSync(out)).toBe(false);
    writeFileSync(out, "OK");
    return ok();
  });
  const r = await run(f.exec);
  expect(r.text).toContain("OK");
  expect(r.text).not.toContain("PARTIAL");
});

test("timeout then success", async () => {
  const f = fake((c, n) => {
    if (n === 1) return ok("", { killed: true });
    writeFileSync(outOf(c.args), "fine");
    return ok();
  });
  const r = await run(f.exec);
  expect(f.cliCalls()).toHaveLength(2);
  expect(r.isError).toBe(false);
  expect(r.details.attempts).toBe(2);
  expect(r.details.outcome).toBe("ok");
});

test("two timeouts", async () => {
  const f = fake(() => ok("", { killed: true }));
  const r = await run(f.exec);
  expect(f.cliCalls()).toHaveLength(2);
  expect(r.isError).toBe(true);
  expect(r.details).toMatchObject({ outcome: "timeout", attempts: 2 });
  expect(r.details.exitCode).toBeUndefined();
  expect(r.text).toContain("did not run");
});

test("exit 2 not retried", async () => {
  const f = fake(() => ok("", { code: 2, stderr: "boom" }));
  const r = await run(f.exec);
  expect(f.cliCalls()).toHaveLength(1);
  expect(r.isError).toBe(true);
  expect(r.details).toMatchObject({ outcome: "exit-error", exitCode: 2, attempts: 1 });
  expect(r.text).toContain("Exit code 2.");
  expect(r.text).toContain("boom");
});

test("truncated not retried", async () => {
  const f = fake(() => ok("", { truncated: true, killed: true }));
  const r = await run(f.exec);
  expect(f.cliCalls()).toHaveLength(1);
  expect(r.details.outcome).toBe("truncated");
  expect(r.details.exitCode).toBeUndefined();
});

test("cancelled", async () => {
  const ctl = new AbortController();
  const f = fake(() => {
    ctl.abort();
    return ok("", { killed: true });
  });
  const r = await run(f.exec, codex, { signal: ctl.signal });
  expect(f.cliCalls()).toHaveLength(1);
  expect(r.details.outcome).toBe("cancelled");
  expect(r.isError).toBe(true);
  expect(r.text).toContain("did not run");
  expect(r.text).toContain("cancelled");
});

test("already aborted", async () => {
  const ctl = new AbortController();
  ctl.abort();
  const f = fake(() => ok("x"));
  const r = await run(f.exec, codex, { signal: ctl.signal });
  expect(f.calls).toHaveLength(0);
  expect(r.details.outcome).toBe("cancelled");
  expect(r.text).toContain("did not run");
});

test("exec throws", async () => {
  const f = fake(() => {
    throw new TypeError("nope");
  });
  const r = await run(f.exec);
  expect(r.isError).toBe(true);
  expect(r.details.outcome).toBe("exec-error");
  expect(r.text).toContain("did not run");
  expect(r.text).toContain("TypeError");
});

test("exec throw after abort is cancelled", async () => {
  const ctl = new AbortController();
  const f = fake(() => {
    ctl.abort();
    throw new Error("aborted");
  });
  const r = await run(f.exec, codex, { signal: ctl.signal });
  expect(r.details.outcome).toBe("cancelled");
});

test("not found", async () => {
  const f = fake(() => ok("", { code: 1, stderr: "spawn codex ENOENT" }));
  const r = await run(f.exec);
  expect(r.details.outcome).toBe("not-found");
  expect(r.text).toContain("codex not found");
});

test("tier resolved per run", async () => {
  const f = fake((c) => {
    writeFileSync(outOf(c.args), "R");
    return ok();
  });
  const r = await run(f.exec, { cli: "codex", model: "luna", effort: "high" });
  const cli = f.cliCalls()[0]!;
  expect(cli.args[cli.args.indexOf("-m") + 1]).toBe("gpt-6-luna");
  expect(r.text).toContain("model gpt-6-luna");
  expect(r.details.model).toBe("gpt-6-luna");
  expect(r.details.effort).toBe("high");
  const cat = f.calls.find((c) => c.args[0] === "debug")!;
  expect(cat.args).toEqual(["debug", "models"]);
  expect(cat.options.timeout).toBe(30000);
  expect(cat.options.cwd).toBe("/work");
  expect(cat.options.maxBuffer).toBe(8 * 1024 * 1024);
});

test("tier falls back when catalog fails", async () => {
  for (const catalog of [
    () => ok("", { code: 1 }),
    () => ok("", { killed: true }),
    () => ok("not json"),
    () => ok(JSON.stringify({ models: [{ slug: "gpt-6-terra" }] })),
    () => {
      throw new Error("x");
    },
  ]) {
    const f = fake(() => ok("r"), catalog);
    const r = await run(f.exec, { cli: "codex", model: "luna" });
    const cli = f.cliCalls()[0]!;
    expect(cli.args[cli.args.indexOf("-m") + 1]).toBe("luna");
    expect(r.details.model).toBe("luna");
    expect(r.details.attempts).toBe(1);
  }
});

test("pinned model makes no catalog call", async () => {
  const f = fake(() => ok("r"));
  await run(f.exec, { cli: "codex", model: "gpt-5.6-luna" });
  expect(f.calls.some((c) => c.args[0] === "debug")).toBe(false);
  await run(f.exec, codex);
  expect(f.calls.some((c) => c.args[0] === "debug")).toBe(false);
});

test("opencode uses cwd and stdout", async () => {
  const f = fake(() => ok("oc says hi"));
  const r = await run(f.exec, { cli: "opencode", model: "anthropic/claude", effort: "high" });
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]!.command).toBe("opencode");
  expect(f.calls[0]!.options.cwd).toBe("/work");
  expect(f.calls[0]!.args).toContain("anthropic/claude#high");
  expect(r.text).toContain("OpenCode review");
  expect(r.text).toContain("oc says hi");
});

test("opencode empty stdout is still ok", async () => {
  const r = await run(fake(() => ok("")).exec, { cli: "opencode" });
  expect(r.details.outcome).toBe("ok");
});

test("failure does not switch reviewer", async () => {
  const f = fake(() => ok("", { code: 3 }));
  await run(f.exec);
  expect(f.calls.some((c) => c.command === "opencode")).toBe(false);
});

test("each attempt passes timeout, maxBuffer and signal", async () => {
  const ctl = new AbortController();
  const f = fake(() => ok("", { killed: true }));
  await run(f.exec, codex, { signal: ctl.signal });
  for (const c of f.cliCalls()) {
    expect(c.options.timeout).toBe(600000);
    expect(c.options.maxBuffer).toBe(8388608);
    expect(c.options.signal).toBe(ctl.signal);
  }
  const g = fake(() => ok("x"));
  await run(g.exec, { cli: "codex", model: "luna" }, { signal: ctl.signal });
  expect(g.calls.find((c) => c.args[0] === "debug")!.options.signal).toBe(ctl.signal);
});

test("details hold no text", async () => {
  const f = fake((c) => {
    writeFileSync(outOf(c.args), "JEV-MARKER-1 output");
    return ok("", { stderr: "JEV-MARKER-1" });
  });
  const r = await runReview(f.exec, { choice: codex, brief: "JEV-MARKER-1", cwd: "/w" });
  expect(r.text).toContain("JEV-MARKER-1");
  expect(JSON.stringify(r.details)).not.toContain("JEV-MARKER-1");
  const prompt = f.cliCalls()[0]!.args.at(-1)!;
  expect(prompt).toContain("JEV-MARKER-1");
});
