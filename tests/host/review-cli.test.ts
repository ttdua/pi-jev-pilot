import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
  REVIEW_INSTRUCTIONS,
  buildPrompt,
  codexArgs,
  opencodeArgs,
} from "../../src/host/review-cli.ts";
import { REPO_ROOT } from "../helpers.ts";

test("instructions match the docs", () => {
  const docs = readFileSync(join(REPO_ROOT, "docs", "jev-questions.md"), "utf8");
  const after = docs.slice(docs.indexOf("### CLI review instructions"));
  const m = /```text\n([\s\S]*?)\n```/.exec(after);
  expect(m).not.toBeNull();
  expect(REVIEW_INSTRUCTIONS).toBe(m![1]!);
});

test("review-cli imports nothing from Pi", () => {
  const src = readFileSync(join(REPO_ROOT, "src", "host", "review-cli.ts"), "utf8");
  expect(src).not.toContain("@earendil-works/");
});

test("prompt layout", () => {
  expect(buildPrompt("-rf everything")).toBe(
    REVIEW_INSTRUCTIONS + "\n\nThe change:\n-rf everything",
  );
  expect(buildPrompt("x").split("\n")[0]).toBe(
    "Review a code change in this repository, read-only: don't edit anything.",
  );
});

test("prompt keeps shell metacharacters", () => {
  const brief = 'a "b" $(c)\nd';
  expect(buildPrompt(brief).endsWith(brief)).toBe(true);
});

test("codex with model and effort", () => {
  expect(
    codexArgs({
      model: "gpt-6-luna",
      effort: "high",
      cwd: "/work/repo",
      out: "/t/out",
      prompt: "P",
    }),
  ).toEqual([
    "exec",
    "-m",
    "gpt-6-luna",
    "-c",
    'model_reasoning_effort="high"',
    "-s",
    "read-only",
    "--skip-git-repo-check",
    "--ephemeral",
    "-C",
    "/work/repo",
    "-o",
    "/t/out",
    "P",
  ]);
});

test("codex without model or effort", () => {
  expect(codexArgs({ cwd: "/w", out: "/t/out", prompt: "P" })).toEqual([
    "exec",
    "-s",
    "read-only",
    "--skip-git-repo-check",
    "--ephemeral",
    "-C",
    "/w",
    "-o",
    "/t/out",
    "P",
  ]);
});

test("opencode with model and effort", () => {
  expect(opencodeArgs({ model: "ollama-cloud/glm-5.3", effort: "high", prompt: "P" })).toEqual([
    "run",
    "-m",
    "ollama-cloud/glm-5.3#high",
    "--agent",
    "plan",
    "P",
  ]);
});

test("opencode effort without a model", () => {
  expect(opencodeArgs({ effort: "high", prompt: "P" })).toEqual(["run", "--agent", "plan", "P"]);
});
