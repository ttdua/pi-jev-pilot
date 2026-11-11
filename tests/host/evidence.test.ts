import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { REPO_ROOT, tempDir } from "../helpers";
import { assertProbeReportClean } from "./harness";

const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), "utf8");
const REPORT = "docs/evidence/2026-11-05-host-seams.md";
const MARKER_PREFIX = "JEV-MARKER-";
const SUPERSEDED = ["Q1", "Q2", "Q7"] as const;
const PINNED = ["Q3", "Q4", "Q5", "Q6"] as const;
const REPLACING_TEST = "tests/host/launch-policy-evidence.test.ts";
// The report links the living spec of the requirement that replaces Q1, Q2 and Q7.
const LIVING_SPEC = "openspec/specs/executor-launch-policy/spec.md";
const REPORT_DIR = "docs/evidence";

/** Repo-relative targets of the report's markdown links to `executor-launch-policy`. */
function launchPolicyLinks(text: string): string[] {
  return [...text.matchAll(/\]\(([^)\s]*executor-launch-policy[^)\s]*)\)/g)].map((m) =>
    relative(REPO_ROOT, resolve(REPO_ROOT, REPORT_DIR, (m[1] ?? "").split("#")[0] ?? "")),
  );
}
const RETIRED = [
  "tests/host/q1-q7-worker-mutation.test.ts",
  "tests/host/q2-message-end-order.test.ts",
  "tests/host/probes/rewrite",
  "tests/host/probes/ordering",
];

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

  test("Q1, Q2 and Q7 superseded, answers kept, replacement linked", () => {
    const report = read(REPORT);
    const rows = tableRows(report);
    for (const q of SUPERSEDED) {
      const [, , answer = "", evidence = ""] = rows.find((r) => r[0] === q) ?? [];
      expect(answer, `WG-02 ${q} marked superseded`).toStartWith("Superseded:");
      expect(answer, `WG-02 ${q} keeps its recorded answer`).toContain("Yes");
      expect(evidence, `WG-02 ${q} links the replacing requirement`).toContain(
        "executor-launch-policy",
      );
      expect(evidence, `WG-02 ${q} links the replacing host test`).toContain(REPLACING_TEST);
      expect(new RegExp(`^## ${q}$\\n+\\*\\*Superseded\\.\\*\\*`, "m").test(report), q).toBe(true);
    }
    expect(existsSync(join(REPO_ROOT, REPLACING_TEST)), "replacing test exists").toBe(true);
  });

  test("replacing requirement linked at its living spec path, and the target exists", () => {
    const report = read(REPORT);
    const links = launchPolicyLinks(report);
    // Every superseded row and section links it: three rows, three sections.
    expect(links.length).toBeGreaterThanOrEqual(6);
    for (const link of links) expect(link, "links the living spec").toBe(LIVING_SPEC);
    expect(existsSync(join(REPO_ROOT, LIVING_SPEC)), "living spec exists").toBe(true);
    expect(read(LIVING_SPEC)).toContain("### Requirement: One launch policy slot");
  });

  test("Q3 to Q6 stay pinned by their host tests", () => {
    const rows = tableRows(read(REPORT));
    for (const q of PINNED) {
      const [, , answer = "", evidence = ""] = rows.find((r) => r[0] === q) ?? [];
      expect(answer, `WG-02 ${q} not superseded`).not.toStartWith("Superseded:");
      const file = /`(tests\/host\/q[^`]+\.test\.ts)`/.exec(evidence)?.[1];
      expect(file, `WG-02 ${q} cites a pinned test`).toBeDefined();
      expect(existsSync(join(REPO_ROOT, file ?? "")), `WG-02 ${q} test exists`).toBe(true);
      expect(read(file ?? ""), `WG-02 ${q} pinned in its test`).toContain(`"WG-02 ${q}`);
    }
  });

  test("retired Q1, Q2 and Q7 tests are gone", () => {
    for (const f of RETIRED) expect(existsSync(join(REPO_ROOT, f)), f).toBe(false);
  });

  test("no verify marker for settled seams", () => {
    const report = read(REPORT);
    const arch = read("docs/architecture.md");
    // Q1 and Q2 seams are superseded; the package no longer uses them.
    const seams = [
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
