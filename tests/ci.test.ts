import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./helpers";

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
