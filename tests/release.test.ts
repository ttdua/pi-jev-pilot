import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./helpers";
import { checkRelease } from "./release-check";

const PINNED = "pi install git:github.com/ttdua/pi-jev-pilot@v0.1.0\n";
const ENTRY = "## [0.1.0] - 2026-11-07\n\nTag: v0.1.0\n";

describe("release metadata fixtures", () => {
  test("missing entry fails", () => {
    const problems = checkRelease({
      pkg: '{"version":"0.2.0"}',
      changelog: ENTRY,
      docs: {},
    });
    expect(problems).toContain("CHANGELOG.md has no entry for 0.2.0");
  });

  test("unpinned install fails", () => {
    const problems = checkRelease({
      pkg: '{"version":"0.1.0"}',
      changelog: ENTRY,
      docs: { "README.md": "pi install git:github.com/ttdua/pi-jev-pilot\n" },
    });
    expect(problems).toContain("README.md: install command not pinned to @v0.1.0");
  });

  test("banner fails", () => {
    const problems = checkRelease({
      pkg: '{"version":"0.1.0"}',
      changelog: ENTRY,
      docs: { "docs/x.md": "Status: design phase." },
    });
    expect(problems.some((p) => p.includes("docs/x.md") && p.includes("design phase"))).toBe(true);
  });

  test("consistent passes", () => {
    const problems = checkRelease({
      pkg: '{"version":"0.1.0"}',
      changelog: ENTRY,
      docs: { "README.md": PINNED, "docs/usage-guide.md": PINNED },
    });
    expect(problems).toEqual([]);
  });
});

function readDocs(): Record<string, string> {
  const docs: Record<string, string> = {
    "README.md": readFileSync(join(REPO_ROOT, "README.md"), "utf8"),
  };
  for (const file of readdirSync(join(REPO_ROOT, "docs"), { recursive: true })) {
    const rel = String(file).split("\\").join("/");
    if (!rel.endsWith(".md")) continue;
    if (rel.startsWith("evidence/") || rel.startsWith("decisions/")) continue;
    docs[`docs/${rel}`] = readFileSync(join(REPO_ROOT, "docs", rel), "utf8");
  }
  return docs;
}

describe("repository release metadata", () => {
  // Enabled once the README and docs lose their pre-release banners.
  test.todo("repository release metadata is consistent", () => {
    const problems = checkRelease({
      pkg: readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
      changelog: readFileSync(join(REPO_ROOT, "CHANGELOG.md"), "utf8"),
      docs: readDocs(),
    });
    expect(problems).toEqual([]);
  });
});
