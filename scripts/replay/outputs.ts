// Private replay output files. Owner-only; nothing here decides or aggregates.
import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Aggregates, DiffCase } from "./compare.ts";

function formatCases(cases: readonly DiffCase[]): string {
  const blocks = cases.map((c) =>
    [
      `## ${c.variant} / ${c.key}`,
      `- base: ${c.base} ${JSON.stringify(c.baseAnswer ?? null)}`,
      `- variant: ${c.value} ${JSON.stringify(c.answer ?? null)}`,
      "",
      "~~~~",
      c.text,
      "~~~~",
    ].join("\n"),
  );
  return `# Differing pairs\n\n${blocks.join("\n\n")}\n`;
}

/** Owner-only outputs. `aggregates.json` goes last, atomically, so it marks a finished run. */
export function writeOutputs(
  dir: string,
  aggregates: Aggregates,
  cases: readonly DiffCase[],
): void {
  const markdown = formatCases(cases);
  const json = `${JSON.stringify(aggregates, null, 2)}\n`;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const put = (name: string, content: string): void => {
    writeFileSync(join(dir, name), content, { mode: 0o600 });
    chmodSync(join(dir, name), 0o600);
  };
  put("cases.md", markdown);
  const temp = join(dir, "aggregates.json.tmp");
  try {
    writeFileSync(temp, json, { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, join(dir, "aggregates.json"));
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}
