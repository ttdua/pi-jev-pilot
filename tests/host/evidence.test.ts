import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, tempDir } from "../helpers";
import { assertProbeReportClean } from "./harness";

const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), "utf8");
const REPORT = "docs/evidence/2026-11-05-host-seams.md";
const MARKER_PREFIX = "JEV-MARKER-";

function tableRows(text: string): string[][] {
  return text
    .split("\n")
    .filter((l) => /^\|\s*Q[1-8]\s*\|/.test(l))
    .map((l) =>
      l
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim()),
    );
}

describe("host seam evidence", () => {
  test("report answers every question", () => {
    const rows = tableRows(read(REPORT));
    for (let n = 1; n <= 8; n++) {
      const row = rows.find((r) => r[0] === `Q${n}`);
      expect(row, `WG-02 Q${n} has a table row`).toBeDefined();
      const [, , answer = "", evidence = "", level = ""] = row ?? [];
      expect(
        answer.startsWith("Unsettled:") || /^(Unit|Contract|Host|Replay|Field)$/.test(level),
        `WG-02 Q${n} level or unsettled`,
      ).toBe(true);
      if (n <= 7) expect(evidence, `WG-02 Q${n} cites a test`).toContain("tests/host/");
    }
  });

  test("no verify marker for settled seams", () => {
    const report = read(REPORT);
    const arch = read("docs/architecture.md");
    const seams = [
      ["message_end", "Q2"],
      ["tool_call", "Q1"],
      ["subagents:child:session-created", "Q4"],
      ["selectedTools", "Q3"],
    ] as const;
    const rows = arch.split("\n").filter((l) => l.startsWith("|"));
    for (const [needle, q] of seams) {
      const unsettled = tableRows(report)
        .find((r) => r[0] === q)?.[2]
        ?.startsWith("Unsettled:");
      if (unsettled) continue;
      for (const row of rows.filter((l) => l.includes(needle))) {
        expect(row, `WG-02 ${q} row still marked verify`).not.toContain("**Verify**");
        expect(row.toLowerCase(), `WG-02 ${q} row still marked verify`).not.toContain("**verify**");
      }
    }
  });

  test("roadmap shows WG-02 done", () => {
    const row = read("docs/roadmap.md")
      .split("\n")
      .find((l) => l.startsWith("| WG-02 "));
    expect(row, "WG-02 roadmap row").toBeDefined();
    expect(row?.trim().endsWith("| Done |")).toBe(true);
  });

  test("report holds no markers or bodies", () => {
    const report = read(REPORT);
    expect(report).not.toContain(MARKER_PREFIX);
    expect(report).not.toContain('"messages"');
  });

  test("report has a heading per question", () => {
    const report = read(REPORT);
    for (let n = 1; n <= 8; n++) {
      expect(new RegExp(`^## Q${n}$`, "m").test(report), `WG-02 Q${n} heading`).toBe(true);
    }
  });

  test("report holds no email address", () => {
    expect(read(REPORT)).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });

  test("pinned tests name their question", () => {
    const files = readdirSync(join(REPO_ROOT, "tests", "host")).filter((f) =>
      /^q.*\.test\.ts$/.test(f),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const text = read(`tests/host/${f}`);
      expect(/expect\([^\n]*"WG-02 Q\d/.test(text), `${f} names WG-02 Q in an assertion`).toBe(
        true,
      );
    }
  });

  test("probe records hold no markers", () => {
    const dir = tempDir("jev-evidence-");
    const clean = join(dir, "clean.jsonl");
    const dirty = join(dir, "dirty.jsonl");
    writeFileSync(clean, '{"probe":"p","event":"e","seq":1,"t":1}\n');
    writeFileSync(
      dirty,
      `{"probe":"p","event":"e","seq":1,"t":1,"data":{"x":"${MARKER_PREFIX}1"}}\n`,
    );
    expect(() => assertProbeReportClean(clean)).not.toThrow();
    expect(() => assertProbeReportClean(dirty)).toThrow();
    expect(() => assertProbeReportClean(join(dir, "missing.jsonl"))).not.toThrow();
  });
});
