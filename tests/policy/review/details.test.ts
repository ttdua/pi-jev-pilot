import { expect, test } from "bun:test";
import { failureDetails, reviewDetails } from "../../../src/policy/review/index.ts";

const r = { stdout: "", stderr: "", code: 7, killed: false, truncated: false };

test("reviewDetails orders keys and skips unset model and effort", () => {
  const d = reviewDetails({ cli: "codex", model: "m", effort: "high" }, "ok", 2);
  expect(Object.keys(d)).toEqual(["cli", "attempts", "outcome", "model", "effort"]);
  expect(d).toEqual({ cli: "codex", attempts: 2, outcome: "ok", model: "m", effort: "high" });
  expect(Object.keys(reviewDetails({ cli: "opencode" }, "timeout", 1))).toEqual([
    "cli",
    "attempts",
    "outcome",
  ]);
});

test("failureDetails adds the exit code only for exit-error with a result", () => {
  const used = { cli: "codex" as const };
  expect(failureDetails(used, "exit-error", 1, r).exitCode).toBe(7);
  expect(failureDetails(used, "exit-error", 1).exitCode).toBeUndefined();
  expect("exitCode" in failureDetails(used, "timeout", 2, r)).toBe(false);
});
