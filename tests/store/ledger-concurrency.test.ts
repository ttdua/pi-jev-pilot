import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateLedgerEntry } from "../../src/store/ledger-schema.ts";
import { REPO_ROOT, tempDir } from "../helpers.ts";

const WRITER = join(REPO_ROOT, "tests", "fixtures", "ledger", "writer.ts");
const WRITERS = 8;
const PER_WRITER = 200;
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function rawLines(file: string): string[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean);
}

async function runWriters(dir: string): Promise<void> {
  const procs = Array.from({ length: WRITERS }, (_, id) =>
    Bun.spawn([process.execPath, WRITER, dir, String(id), String(PER_WRITER)], {
      stdout: "ignore",
      stderr: "pipe",
    }),
  );
  const deadline = Date.now() + 10000;
  const ready = () =>
    Array.from({ length: WRITERS }, (_, id) => existsSync(join(dir, `ready-${id}`)));
  while (!ready().every(Boolean)) {
    if (Date.now() > deadline) throw new Error("writers not ready in 10s");
    await Bun.sleep(5);
  }
  writeFileSync(join(dir, "go"), "");
  const codes = await Promise.all(procs.map((p) => p.exited));
  expect(codes).toEqual(Array.from({ length: WRITERS }, () => 0));
}

function checkAll(dir: string, expectedTotal: number): string[] {
  const all = [...rawLines(join(dir, "ledger.1.jsonl")), ...rawLines(join(dir, "ledger.jsonl"))];
  expect(all.length).toBe(expectedTotal);
  const ids = new Set<string>();
  const last = new Map<string, number>();
  for (const line of all) {
    const checked = validateLedgerEntry(JSON.parse(line));
    expect(checked.ok).toBe(true);
    if (!checked.ok) continue;
    const turnId = checked.entry.kind === "main" ? checked.entry.turnId : "";
    ids.add(turnId);
    const m = /^(\d+)-(\d+)$/.exec(turnId);
    if (m) {
      const seq = Number(m[2]);
      const prev = last.get(m[1] as string) ?? -1;
      expect(seq).toBeGreaterThan(prev);
      last.set(m[1] as string, seq);
    }
  }
  expect(ids.size).toBe(expectedTotal);
  expect(last.size).toBe(WRITERS);
  return all;
}

describe("concurrent writers", () => {
  test("parallel processes, no rotation", async () => {
    const dir = tempDir("jev-ledger-conc-");
    roots.push(dir);
    await runWriters(dir);
    checkAll(dir, WRITERS * PER_WRITER);
  }, 30000);

  test("parallel processes across a rotation", async () => {
    const dir = tempDir("jev-ledger-conc-");
    roots.push(dir);
    const pre: string[] = [];
    for (let i = 0; i < 1990; i++)
      pre.push(
        JSON.stringify({
          v: 1,
          at: 1762400000000 + i,
          kind: "main",
          session: "pre",
          mode: "standard",
          answered: false,
          turnId: `pre-${i}`,
          outcome: "ok",
        }),
      );
    writeFileSync(join(dir, "ledger.jsonl"), `${pre.join("\n")}\n`);
    await runWriters(dir);
    checkAll(dir, 1990 + WRITERS * PER_WRITER);
    expect(rawLines(join(dir, "ledger.1.jsonl")).length).toBeGreaterThanOrEqual(2000);
    expect(rawLines(join(dir, "ledger.jsonl")).length).toBeLessThan(2000);
  }, 30000);
});
