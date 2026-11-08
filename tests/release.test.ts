import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./helpers";
import { checkRelease } from "./release-check";

const PINNED = "pi install git:github.com/ttdua/pi-jev-pilot@v0.1.0\n";
const ENTRY = "## [0.1.0] - 2026-11-07\n\nTag: v0.1.0\n";
const SWITCHES = [
  "/jev effort off",
  "/jev subagents off",
  "/jev skills off",
  "/jev strategy off",
  "/jev tools off",
  "/jev expert off",
  "/jev cli-review off",
];
const README_OK = `${PINNED}${SWITCHES.join("\n")}\n`;
const BASE = { pkg: '{"version":"0.1.0"}', changelog: ENTRY };

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
      docs: { "README.md": README_OK, "docs/usage-guide.md": PINNED },
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

describe("user-facing docs carry no usage figures", () => {
  test("figure detected", () => {
    const problems = checkRelease({
      ...BASE,
      docs: { "README.md": `${README_OK}Jev chose low for 74% of prompts\n` },
    });
    expect(problems.some((p) => p.includes("README.md") && p.includes("%"))).toBe(true);
  });

  test("evidence link detected", () => {
    const problems = checkRelease({
      ...BASE,
      docs: { "README.md": README_OK, "docs/scenarios.md": "See [r](evidence/x.md)\n" },
    });
    expect(problems.some((p) => p.includes("docs/scenarios.md") && p.includes("evidence/"))).toBe(
      true,
    );
  });

  test("off switch missing", () => {
    const readme = README_OK.replace("/jev expert off", "");
    const problems = checkRelease({ ...BASE, docs: { "README.md": readme } });
    expect(problems).toContain("README.md: missing off switch /jev expert off");
  });
});

describe("repository release metadata", () => {
  test("repository release metadata is consistent", () => {
    const problems = checkRelease({
      pkg: readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
      changelog: readFileSync(join(REPO_ROOT, "CHANGELOG.md"), "utf8"),
      docs: readDocs(),
    });
    expect(problems).toEqual([]);
  });
});

describe("scenario documentation", () => {
  test("scenario documentation has its sections and is linked", () => {
    const text = readFileSync(join(REPO_ROOT, "docs/scenarios.md"), "utf8");
    const sections = text.split(/^## /m).slice(1);
    expect(sections.map((s) => s.split("\n")[0])).toEqual([
      "Your thinking level follows the prompt",
      "Workers get a model and effort for you",
      "Reviews go to your reviewer model",
      "Which rule wins",
    ]);
    expect(readFileSync(join(REPO_ROOT, "README.md"), "utf8")).toContain("](docs/scenarios.md)");
  });
});
