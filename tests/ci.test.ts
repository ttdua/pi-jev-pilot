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
    "bun run test",
  ];
  const positions = commands.map((c) => text.indexOf(c));
  for (const p of positions) expect(p).toBeGreaterThanOrEqual(0);
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  expect(text).not.toContain("secrets.");
  expect(text).toContain("node-version: 22");
  expect(text).toContain("bun-version: 1.4.4");
});
