import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./helpers";

const PUBLIC_TYPES = "bun run --cwd packages/pi-subagents verify:public-types";

// Step blocks of the `check` job only: each block starts at a `      - ` line and
// runs to the next one. No YAML parser: the workflow is flat and indented.
function checkJobSteps(text: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^  check:\s*$/.test(l));
  if (start < 0) return [];
  let end = lines.findIndex((l, i) => i > start && /^  \S/.test(l));
  if (end < 0) end = lines.length;
  const blocks: string[][] = [];
  for (const line of lines.slice(start + 1, end)) {
    if (line.startsWith("      - ")) blocks.push([line]);
    else if (blocks.length > 0) blocks[blocks.length - 1].push(line);
  }
  return blocks.map((b) => b.join("\n"));
}

test("CI runs every check", () => {
  const text = readFileSync(join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8");
  expect(text).toContain("push");
  expect(text).toContain("pull_request");
  const commands = [
    "bun install --frozen-lockfile",
    "bun run typecheck",
    "bun run lint",
    "bun run fmt:check",
    "bun run test\n",
    "bun run test:executor",
    PUBLIC_TYPES,
  ];
  const positions = commands.map((c) => text.indexOf(c));
  for (const p of positions) expect(p).toBeGreaterThanOrEqual(0);
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  expect(text).not.toContain("secrets.");
  expect(text).toContain("fetch-depth: 0");
  expect(text).toContain("node-version: 22");
  expect(text).toContain("bun-version: 1.4.4");
});

test("lint and typecheck cover nothing under packages/", () => {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  expect(pkg.scripts.lint).not.toContain("packages");
  expect(pkg.scripts.typecheck).not.toContain("packages");
  const tsconfig = JSON.parse(readFileSync(join(REPO_ROOT, "tsconfig.json"), "utf8"));
  expect(tsconfig.include.filter((p: string) => p.startsWith("packages"))).toEqual([]);
  expect(tsconfig.exclude).toContain("packages");
  const lintrc = JSON.parse(readFileSync(join(REPO_ROOT, ".oxlintrc.json"), "utf8"));
  expect(lintrc.ignorePatterns).toContain("packages/**");
  expect(pkg.scripts.test).not.toContain("executor");
});

test("local test scripts skip the public-types check", () => {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  expect(pkg.scripts.test).not.toContain("verify:public-types");
  expect(pkg.scripts["test:executor"]).not.toContain("verify:public-types");
});

test("the public-types check is the last step of the check job", () => {
  const text = readFileSync(join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8");
  const steps = checkJobSteps(text);
  expect(steps.length).toBeGreaterThan(1);
  expect(steps[steps.length - 1]).toMatch(
    /^\s*-?\s*run: bun run --cwd packages\/pi-subagents verify:public-types\s*$/m,
  );
  expect(steps.slice(0, -1).some((b) => b.includes("run: bun run test:executor"))).toBe(true);
});

test("checkJobSteps bounds the check job", () => {
  const text = readFileSync(join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8");
  // A step appended after the check makes it the last block.
  const appended = checkJobSteps(`${text}      - uses: actions/cache@v4\n`);
  expect(appended[appended.length - 1]).not.toContain("verify:public-types");
  expect(appended[appended.length - 1]).toContain("actions/cache@v4");
  // A public-types step under another job is not a step of the check job.
  const otherJob = [
    "jobs:",
    "  check:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: bun run test:executor",
    "  other:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    `      - run: ${PUBLIC_TYPES}`,
    "",
  ].join("\n");
  const blocks = checkJobSteps(otherJob);
  expect(blocks.length).toBe(1);
  expect(blocks.some((b) => b.includes("verify:public-types"))).toBe(false);
});
