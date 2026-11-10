import { expect, test } from "bun:test";
import { runReview } from "../../../src/host/review/run.ts";
import type { Exec } from "../../../src/policy/review/cli.ts";

test("runReview reads choice, brief, cwd and signal once, before the first exec", async () => {
  const log: string[] = [];
  const input = {
    get choice() {
      log.push("read choice");
      return { cli: "codex" as const };
    },
    get brief() {
      log.push("read brief");
      return "b";
    },
    get cwd() {
      log.push("read cwd");
      return "/tmp";
    },
    get signal() {
      log.push("read signal");
      return undefined;
    },
  };
  const exec: Exec = async () => {
    log.push("exec");
    return { stdout: "", stderr: "", code: 1, killed: false, truncated: false };
  };
  await runReview(exec, input);
  const firstExec = log.indexOf("exec");
  expect(firstExec).toBeGreaterThan(-1);
  for (const k of ["choice", "brief", "cwd", "signal"]) {
    const reads = log.filter((l) => l === `read ${k}`);
    expect(reads).toHaveLength(1);
    expect(log.indexOf(`read ${k}`)).toBeLessThan(firstExec);
  }
});
