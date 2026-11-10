import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
  REVIEW_INSTRUCTIONS,
  buildPrompt,
  checkCodexChoice,
  checkOpencodeChoice,
  classifyAttempt,
  codexArgs,
  effectiveChoice,
  formatFailure,
  formatSuccess,
  stderrTail,
  isTier,
  opencodeArgs,
  parseCodexCatalog,
  parseOpencodeModels,
  resolveTier,
  type CodexModel,
  type ExecResult,
  type ReviewChoice,
  type ReviewDetails,
} from "../../../src/policy/review/cli.ts";
import { REPO_ROOT } from "../../helpers.ts";

test("instructions match the docs", () => {
  const docs = readFileSync(join(REPO_ROOT, "docs", "jev-questions.md"), "utf8");
  const after = docs.slice(docs.indexOf("### CLI review instructions"));
  const m = /```text\n([\s\S]*?)\n```/.exec(after);
  expect(m).not.toBeNull();
  expect(REVIEW_INSTRUCTIONS).toBe(m![1]!);
});

test("review-cli imports nothing from Pi", () => {
  const src = readFileSync(join(REPO_ROOT, "src", "policy", "review", "cli.ts"), "utf8");
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
  expect(
    opencodeArgs({
      model: "ollama-cloud/glm-5.3",
      effort: "high",
      prompt: "P",
    }),
  ).toEqual(["run", "-m", "ollama-cloud/glm-5.3#high", "--agent", "plan", "P"]);
});

test("opencode effort without a model", () => {
  expect(opencodeArgs({ effort: "high", prompt: "P" })).toEqual(["run", "--agent", "plan", "P"]);
});

const catalogJson = JSON.stringify({
  models: [
    {
      slug: "gpt-5.6-luna",
      display_name: "GPT-5.6-Luna",
      visibility: "list",
      supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }],
      extra: { a: 1 },
    },
    {
      slug: "gpt-6-luna",
      visibility: "list",
      supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }],
    },
    { slug: "gpt-5.10-luna", supported_reasoning_levels: [{ effort: "low" }] },
    {
      slug: "gpt-7-luna",
      visibility: "hide",
      supported_reasoning_levels: [{ effort: "low" }],
    },
    {
      slug: "gpt-5-sol",
      display_name: "Sol Five",
      visibility: "list",
      supported_reasoning_levels: [],
    },
  ],
});

test("parseCodexCatalog keeps visible models", () => {
  const c = parseCodexCatalog(catalogJson);
  expect(c.map((m) => m.slug)).toEqual([
    "gpt-5.6-luna",
    "gpt-6-luna",
    "gpt-5.10-luna",
    "gpt-5-sol",
  ]);
  expect(c[0]).toEqual({
    slug: "gpt-5.6-luna",
    name: "GPT-5.6-Luna",
    efforts: ["low", "high"],
  });
  expect(c[1]!.name).toBe("gpt-6-luna");
});

test("parseCodexCatalog tolerates junk", () => {
  expect(parseCodexCatalog("banner\n{")).toEqual([]);
  expect(parseCodexCatalog('{"models":5}')).toEqual([]);
  expect(parseCodexCatalog("")).toEqual([]);
});

test("parseOpencodeModels", () => {
  expect(parseOpencodeModels("  a/b \n\nnoslash\r\nc/d:1\n")).toEqual(["a/b", "c/d:1"]);
});

test("isTier", () => {
  expect(isTier("luna")).toBe(true);
  expect(isTier("Sol")).toBe(true);
  expect(isTier("gpt-5.6-luna")).toBe(false);
  expect(isTier("p/m")).toBe(false);
  expect(isTier("luna2")).toBe(false);
});

test("resolveTier compares numbers", () => {
  const m = (slug: string): CodexModel => ({ slug, name: slug, efforts: [] });
  const all = [m("gpt-5.6-luna"), m("gpt-6-luna"), m("gpt-5.10-luna")];
  expect(resolveTier("luna", all)).toBe("gpt-6-luna");
  expect(resolveTier("Luna", all)).toBe("gpt-6-luna");
  expect(resolveTier("luna", [all[0]!, all[2]!])).toBe("gpt-5.10-luna");
  expect(resolveTier("nova", all)).toBeUndefined();
});

test("checkCodexChoice", () => {
  const cat = parseCodexCatalog(catalogJson);
  expect(checkCodexChoice("luna", "high", cat)).toEqual({
    ok: true,
    model: "luna",
    effort: "high",
  });
  expect(checkCodexChoice("Luna", undefined, cat)).toEqual({
    ok: true,
    model: "Luna",
  });
  expect(checkCodexChoice("GPT-5.6-Luna", undefined, cat)).toEqual({
    ok: true,
    model: "gpt-5.6-luna",
  });
  const bad = checkCodexChoice("nova", undefined, cat);
  expect(bad.ok).toBe(false);
  if (!bad.ok) {
    expect(bad.message).toContain("nova");
    expect(bad.suggestions).toEqual(["luna (now gpt-6-luna)", "sol (now gpt-5-sol)"]);
  }
  const ultra = checkCodexChoice("luna", "ultra", cat);
  expect(ultra.ok).toBe(false);
  if (!ultra.ok) {
    expect(ultra.message).toContain("ultra");
    expect(ultra.suggestions).toEqual(["low", "high"]);
  }
  expect(checkCodexChoice("gpt-7-luna", undefined, cat).ok).toBe(false);
  expect(checkCodexChoice(undefined, "high", cat)).toEqual({
    ok: true,
    effort: "high",
  });
  expect(checkCodexChoice(undefined, undefined, cat)).toEqual({ ok: true });
});

test("checkCodexChoice caps suggestions at five", () => {
  const cat = ["a", "b", "c", "d", "e", "f", "g"].map((t) => ({
    slug: `gpt-1-${t}`,
    name: t,
    efforts: [],
  }));
  const r = checkCodexChoice("zzz", undefined, cat);
  expect(!r.ok && r.suggestions.length).toBe(5);
});

test("checkOpencodeChoice", () => {
  const ids = ["ollama-cloud/glm-5.3", "a/x", "a/y"];
  expect(checkOpencodeChoice("a/x", "high", ids)).toEqual({
    ok: true,
    model: "a/x",
    effort: "high",
  });
  expect(checkOpencodeChoice("glm-5.3", "high", ids)).toEqual({
    ok: true,
    model: "ollama-cloud/glm-5.3",
    effort: "high",
  });
  const two = checkOpencodeChoice("glm-5.3", undefined, ["a/glm-5.3", "b/glm-5.3"]);
  expect(!two.ok && two.suggestions).toEqual(["a/glm-5.3", "b/glm-5.3"]);
  const noModel = checkOpencodeChoice(undefined, "high", ids);
  expect(!noModel.ok && noModel.message).toContain("needs a model");
  const unk = checkOpencodeChoice("GLM", undefined, ids);
  expect(!unk.ok && unk.suggestions).toEqual(["ollama-cloud/glm-5.3"]);
  expect(checkOpencodeChoice(undefined, undefined, ids)).toEqual({ ok: true });
  const many = Array.from({ length: 8 }, (_, i) => `p/m${i}`);
  const cap = checkOpencodeChoice("m", undefined, many);
  expect(!cap.ok && cap.suggestions.length).toBe(5);
});

const ok = (o: Partial<ExecResult> = {}): ExecResult => ({
  stdout: "x",
  stderr: "",
  code: 0,
  killed: false,
  truncated: false,
  ...o,
});

test("checkCodexChoice suggests only tiers", () => {
  const cat: CodexModel[] = [
    { slug: "gpt-5.5", name: "GPT-5.5", efforts: [] },
    { slug: "gpt-6-luna", name: "Luna", efforts: [] },
  ];
  const r = checkCodexChoice("nope", undefined, cat);
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.suggestions).toContain("luna (now gpt-6-luna)");
    expect(r.suggestions.some((s) => /^\d/.test(s))).toBe(false);
  }
});

test("effectiveChoice merges per-call fields", () => {
  const d: ReviewChoice = { cli: "codex", model: "luna", effort: "high" };
  expect(effectiveChoice(d, { reviewer: "opencode" })).toEqual({
    cli: "opencode",
  });
  expect(effectiveChoice(d, { model: "gpt-5.6-sol" })).toEqual({
    cli: "codex",
    model: "gpt-5.6-sol",
  });
  expect(effectiveChoice({ cli: "codex", model: "gpt-5.6-luna" }, { effort: "low" })).toEqual({
    cli: "codex",
    model: "gpt-5.6-luna",
    effort: "low",
  });
  expect(effectiveChoice(d, { reviewer: "codex" })).toEqual(d);
});

test("classifyAttempt", () => {
  expect(classifyAttempt(ok(), false)).toBe("ok");
  expect(classifyAttempt(ok({ killed: true, code: 1 }), false)).toBe("timeout");
  expect(classifyAttempt(ok({ truncated: true }), false)).toBe("truncated");
  expect(classifyAttempt(ok({ killed: true }), true)).toBe("cancelled");
  expect(classifyAttempt(ok({ code: 1, stdout: "", stderr: "spawn codex ENOENT" }), false)).toBe(
    "not-found",
  );
  expect(classifyAttempt(ok({ code: 1, stderr: "bad flag" }), false)).toBe("exit-error");
});

test("formatSuccess", () => {
  expect(formatSuccess({ cli: "codex", model: "gpt-6-luna", effort: "high" }, "  hi \n")).toBe(
    "Codex review (model gpt-6-luna, effort high):\nhi",
  );
  expect(formatSuccess({ cli: "codex" }, "a").split("\n")[0]).toBe(
    "Codex review (the CLI's default model and effort):",
  );
  expect(formatSuccess({ cli: "opencode", effort: "low" }, "a").split("\n")[0]).toBe(
    "OpenCode review (effort low):",
  );
});

test("formatFailure", () => {
  const f = (o: ReviewDetails["outcome"], r?: ExecResult, n?: string) =>
    formatFailure("codex", o, r, n);
  const err = f("exit-error", ok({ code: 3, stderr: "boom" }));
  expect(err.startsWith("The Codex review did not run:")).toBe(true);
  expect(err).toContain("Exit code 3.");
  expect(err).toContain("\n\nboom");
  expect(f("timeout", ok({ code: 1, killed: true }))).toContain("timed out twice after 10 minutes");
  expect(f("timeout", ok({ code: 1, killed: true }))).not.toContain("Exit code");
  expect(f("cancelled")).toContain("cancelled");
  expect(f("cancelled")).not.toContain("Exit code");
  expect(f("not-found", ok({ code: 1, stderr: "ENOENT" }))).toContain("codex not found");
  expect(f("truncated", ok({ truncated: true }))).toContain("output exceeded 8 MiB");
  expect(f("exec-error", undefined, "TypeError")).toContain("could not start (TypeError)");
  expect(formatFailure("opencode", "not-found")).toContain("opencode not found");
});

test("stderrTail", () => {
  const lines = Array.from({ length: 30 }, (_, i) => `l${i}`).join("\n");
  expect(stderrTail(lines).split("\n")).toEqual(Array.from({ length: 20 }, (_, i) => `l${i + 10}`));
  expect(stderrTail("a".repeat(10000)).length).toBe(4000);
});
