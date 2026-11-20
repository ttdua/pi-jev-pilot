import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO_ROOT } from "./helpers";

const OLD_NAMES = /\btwin\b|prompt_mode|inherit_context|inheritContext|forkedLaunch/i;

// Exactly the spec's exemptions: dated evidence, archived changes, ADRs, changelog, plans, retros, architecture history.
const EXEMPT = [/^docs\/evidence\//, /^docs\/decisions\//, /node_modules/];

function docFiles(): string[] {
  const out: string[] = [];
  for (const file of new Bun.Glob("docs/**/*.md").scanSync({ cwd: REPO_ROOT })) {
    if (!EXEMPT.some((re) => re.test(file))) out.push(file);
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
