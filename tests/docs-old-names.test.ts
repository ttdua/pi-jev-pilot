import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO_ROOT } from "./helpers";

const OLD_NAMES = /\btwin\b|prompt_mode|inherit_context|inheritContext|forkedLaunch/i;

// Historical records: dated evidence, ADRs, per-change plans and retros, phase history.
const EXEMPT = [
  /^docs\/evidence\//,
  /(^|\/)decisions\//,
  /^packages\/pi-subagents\/docs\/(plans|retro)\//,
  /^packages\/pi-subagents\/docs\/architecture\/history\//,
  /(^|\/)CHANGELOG\.md$/,
  /node_modules/,
];

function docFiles(): string[] {
  const out: string[] = [];
  for (const pattern of ["docs/**/*.md", "packages/pi-subagents/**/*.md"]) {
    for (const file of new Bun.Glob(pattern).scanSync({ cwd: REPO_ROOT })) {
      if (!EXEMPT.some((re) => re.test(file))) out.push(file);
    }
  }
  return out.sort();
}

// Lines outside a section whose heading contains "Deprecated" (the section ends at the next heading of the same or a higher level).
function currentLines(text: string): { n: number; line: string }[] {
  const out: { n: number; line: string }[] = [];
  let skipLevel = 0;
  let fence = false;
  text.split("\n").forEach((line, i) => {
    if (/^\s*```/.test(line)) fence = !fence;
    const heading = fence ? null : /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      if (skipLevel && level <= skipLevel) skipLevel = 0;
      if (!skipLevel && /deprecated/i.test(heading[2])) skipLevel = level;
    }
    if (!skipLevel) out.push({ n: i + 1, line });
  });
  return out;
}

test("Old names gone from current docs", () => {
  const hits: string[] = [];
  for (const file of docFiles()) {
    const text = readFileSync(join(REPO_ROOT, file), "utf8");
    for (const { n, line } of currentLines(text)) {
      if (OLD_NAMES.test(line))
        hits.push(`${relative("", file)}:${n}: ${line.trim().slice(0, 100)}`);
    }
  }
  expect(hits).toEqual([]);
});

test("Decision record present", () => {
  const dir = join(REPO_ROOT, "packages/pi-subagents/docs/decisions");
  const adr14 = join(dir, "0014-subagent-context-is-fresh-or-fork.md");
  expect(existsSync(adr14)).toBe(true);
  const adr8 = readFileSync(join(dir, "0008-inherited-region-is-shared-parts.md"), "utf8");
  expect(adr8).toMatch(/^status:.*superseded by 0014/m);
  expect(adr8.split("## Status")[1]).toContain("ADR 0014");
});
