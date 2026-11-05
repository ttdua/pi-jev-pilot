import { cpSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { OXFMT_BIN, OXLINT_BIN, REPO_ROOT, run, tempDir } from "./helpers.ts";

const FIXTURES = join(REPO_ROOT, "tests", "fixtures", "boundaries");

function listFiles(root: string): string[] {
  return (readdirSync(root, { recursive: true }) as string[])
    .map((p) => p.split("\\").join("/"))
    .filter((p) => p.endsWith(".ts"));
}

test("boundary rules flag exactly the forbidden imports", () => {
  const dir = tempDir("boundaries-");
  cpSync(FIXTURES, dir, { recursive: true });
  const config = JSON.parse(readFileSync(join(REPO_ROOT, ".oxlintrc.json"), "utf8"));
  delete config.ignorePatterns;
  writeFileSync(join(dir, ".oxlintrc.json"), JSON.stringify(config));

  const result = run([OXLINT_BIN, "-c", ".oxlintrc.json", "-f", "json", "."], { cwd: dir });
  const parsed = JSON.parse(result.stdout) as {
    diagnostics: { code: string; filename: string }[];
  };
  const flagged = new Set(
    parsed.diagnostics
      .filter((d) => d.code === "eslint(no-restricted-imports)")
      .map((d) => d.filename.split("\\").join("/").replace(/^\.\//, "")),
  );
  const expected = new Set(
    listFiles(FIXTURES).filter((p) => (p.split("/").pop() ?? "").includes("bad-")),
  );
  expect([...flagged].sort()).toEqual([...expected].sort());
});

test("format check rejects an unformatted file", () => {
  const dir = tempDir("fmt-");
  writeFileSync(join(dir, "bad.ts"), "export const a   =1\n");
  const result = run([OXFMT_BIN, "--check", "bad.ts"], { cwd: dir });
  expect(result.code).not.toBe(0);
});
