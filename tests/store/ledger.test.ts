import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  appendLedger,
  type LedgerHooks,
  type LedgerRead,
  readLedger,
} from "../../src/store/ledger.ts";
import { tempDir } from "../helpers.ts";
import { entry } from "./ledger-fixtures.ts";

const isRoot = process.getuid?.() === 0;
const roots: string[] = [];

function mk(): { root: string; dir: string } {
  const root = tempDir("jev-ledger-");
  roots.push(root);
  return { root, dir: root };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    try {
      chmodSync(root, 0o700);
    } catch {
      // ignore
    }
    rmSync(root, { recursive: true, force: true });
  }
});

function fill(dir: string, n: number, hooks?: LedgerHooks): void {
  for (let i = 0; i < n; i++) {
    const r = appendLedger(dir, entry(i), hooks);
    if (!r.ok) throw new Error(`append ${i} failed`);
  }
}

function lines(file: string): string[] {
  return readFileSync(file, "utf8").split("\n").filter(Boolean);
}

describe("append", () => {
  test("lines accumulate in order", () => {
    const { dir } = mk();
    fill(dir, 3);
    const got = lines(join(dir, "ledger.jsonl")).map((l) => JSON.parse(l));
    expect(got).toEqual([entry(0), entry(1), entry(2)]);
    expect(readdirSync(dir).some((n) => n.endsWith(".tmp"))).toBe(false);
  });

  test("first append creates the file", () => {
    const { root } = mk();
    const dir = join(root, "jev");
    expect(appendLedger(dir, entry(0)).ok).toBe(true);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, "ledger.jsonl")).mode & 0o777).toBe(0o600);
  });

  test("long text field rejected", () => {
    const { dir } = mk();
    const sentence = "Please refactor the whole authentication module and then ".repeat(6);
    const r = appendLedger(dir, { ...entry(0), agent: sentence });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(sentence);
    expect(existsSync(join(dir, "ledger.jsonl"))).toBe(false);
  });

  test("prompt field rejected", () => {
    const { dir } = mk();
    const r = appendLedger(dir, { ...entry(0), prompt: "hi" });
    expect(r.ok).toBe(false);
    expect(existsSync(join(dir, "ledger.jsonl"))).toBe(false);
  });

  test("non-object entry rejected", () => {
    const { dir } = mk();
    for (const v of [null, "x", []]) expect(appendLedger(dir, v).ok).toBe(false);
    expect(existsSync(join(dir, "ledger.jsonl"))).toBe(false);
  });

  test("throwing getter never throws", () => {
    const { dir } = mk();
    const evil = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("boom");
        },
        get() {
          throw new Error("boom");
        },
      },
    );
    expect(appendLedger(dir, evil).ok).toBe(false);
  });
});

describe("failures", () => {
  test.skipIf(isRoot)("read-only directory", () => {
    const { dir } = mk();
    chmodSync(dir, 0o500);
    const r = appendLedger(dir, entry(0));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0]?.path).toBe("");
      expect(r.issues[0]?.message).toMatch(/EACCES/);
    }
  });

  test("directory cannot be created", () => {
    const { root } = mk();
    const file = join(root, "afile");
    writeFileSync(file, "x");
    const r = appendLedger(file, entry(0));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0]?.path).toBe("");
      expect(r.issues[0]?.message).toMatch(/ENOTDIR|EEXIST/);
    }
  });
});

describe("rotation", () => {
  test("rotation at 2000 lines", () => {
    const { dir } = mk();
    fill(dir, 2000);
    expect(lines(join(dir, "ledger.1.jsonl"))).toHaveLength(2000);
    const active = join(dir, "ledger.jsonl");
    expect(!existsSync(active) || readFileSync(active, "utf8") === "").toBe(true);
    expect(existsSync(join(dir, "ledger.rotate.lock"))).toBe(false);
  });

  test("oldest segment dropped", () => {
    const { dir } = mk();
    fill(dir, 4500);
    const old = lines(join(dir, "ledger.1.jsonl"));
    const cur = lines(join(dir, "ledger.jsonl"));
    expect(old.length + cur.length).toBe(2500);
    const values = [...old, ...cur].map((l) => JSON.parse(l).briefChars as number);
    expect(values[0]).toBe(2000);
    expect(values[values.length - 1]).toBe(4499);
  });

  test("another process rotated first", () => {
    const { dir } = mk();
    fill(dir, 1999);
    let snapshot = "";
    const hooks: LedgerHooks = {
      beforeRotateLock: () => {
        renameSync(join(dir, "ledger.jsonl"), join(dir, "ledger.1.jsonl"));
        const three = [0, 1, 2].map((i) => JSON.stringify(entry(i)) + "\n").join("");
        writeFileSync(join(dir, "ledger.jsonl"), three);
        snapshot = readFileSync(join(dir, "ledger.1.jsonl"), "utf8");
      },
    };
    expect(appendLedger(dir, entry(1999), hooks).ok).toBe(true);
    expect(readFileSync(join(dir, "ledger.1.jsonl"), "utf8")).toBe(snapshot);
  });

  test("held lock skips rotation", () => {
    const { dir } = mk();
    fill(dir, 1999);
    const lock = join(dir, "ledger.rotate.lock");
    writeFileSync(lock, "");
    fill(dir, 1);
    expect(existsSync(join(dir, "ledger.1.jsonl"))).toBe(false);
    expect(existsSync(lock)).toBe(true);
  });

  test("stale lock cleared", () => {
    const { dir } = mk();
    fill(dir, 1999);
    const lock = join(dir, "ledger.rotate.lock");
    writeFileSync(lock, "");
    const old = new Date(Date.now() - 61_000);
    utimesSync(lock, old, old);
    expect(appendLedger(dir, entry(1999)).ok).toBe(true);
    expect(existsSync(lock)).toBe(false);
    expect(existsSync(join(dir, "ledger.1.jsonl"))).toBe(false);
    expect(readdirSync(dir).some((n) => n.endsWith(".stale"))).toBe(false);
    expect(appendLedger(dir, entry(2000)).ok).toBe(true);
    expect(existsSync(join(dir, "ledger.1.jsonl"))).toBe(true);
  });

  test("failed rotation keeps the append", () => {
    const { dir } = mk();
    fill(dir, 1999);
    const blocker = join(dir, "ledger.1.jsonl");
    mkdirSync(blocker);
    writeFileSync(join(blocker, "x"), "x");
    expect(appendLedger(dir, entry(1999)).ok).toBe(true);
    const last = lines(join(dir, "ledger.jsonl")).pop() ?? "";
    expect(JSON.parse(last)).toEqual(entry(1999));
    expect(existsSync(join(dir, "ledger.rotate.lock"))).toBe(false);
  });

  test("rotated segment keeps owner-only mode", () => {
    const { dir } = mk();
    fill(dir, 2001);
    expect(statSync(join(dir, "ledger.1.jsonl")).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "ledger.jsonl")).mode & 0o777).toBe(0o600);
  });

  test("lock is owner-only", () => {
    const { dir } = mk();
    fill(dir, 1999);
    let mode = -1;
    const hooks: LedgerHooks = {
      whileRotateLocked: () => {
        mode = statSync(join(dir, "ledger.rotate.lock")).mode & 0o777;
      },
    };
    expect(appendLedger(dir, entry(1999), hooks).ok).toBe(true);
    expect(mode).toBe(0o600);
  });
});

describe("read", () => {
  const J = (v: unknown): string => `${JSON.stringify(v)}\n`;
  const seq = (from: number, to: number): string => {
    let s = "";
    for (let i = from; i <= to; i++) s += J(entry(i));
    return s;
  };
  const chars = (r: LedgerRead): number[] =>
    r.kind === "ok" ? r.entries.map((e) => (e as { briefChars: number }).briefChars) : [];
  const active = (dir: string): string => join(dir, "ledger.jsonl");
  const old = (dir: string): string => join(dir, "ledger.1.jsonl");

  test("bad lines skipped", () => {
    const { dir } = mk();
    writeFileSync(
      active(dir),
      `${J(entry(1))}{"v":1,"kind":\n${J({ ...entry(2), v: 2 })}${J(entry(3))}`,
    );
    const r = readLedger(dir);
    expect(r.kind).toBe("ok");
    expect(chars(r)).toEqual([1, 3]);
    expect(r.kind === "ok" && r.skipped).toBe(2);
  });

  test("torn last line skipped", () => {
    const { dir } = mk();
    writeFileSync(active(dir), J(entry(1)) + JSON.stringify(entry(2)));
    const r = readLedger(dir);
    expect(chars(r)).toEqual([1]);
    expect(r.kind === "ok" && r.skipped).toBe(1);
  });

  test("both segments read in order", () => {
    const { dir } = mk();
    writeFileSync(old(dir), seq(1, 2000));
    writeFileSync(active(dir), seq(2001, 2300));
    const r = readLedger(dir);
    const c = chars(r);
    expect(c.length).toBe(2000);
    expect(c[0]).toBe(301);
    expect(c[1999]).toBe(2300);
    expect(r.kind === "ok" && r.skipped).toBe(0);
  });

  test("rotation during read", () => {
    const { dir } = mk();
    writeFileSync(old(dir), seq(1, 2000));
    writeFileSync(active(dir), seq(2001, 2100));
    let fired = 0;
    const r = readLedger(dir, {
      betweenSegments: () => {
        fired++;
        renameSync(active(dir), old(dir));
        writeFileSync(active(dir), seq(2101, 2105));
      },
    });
    const c = chars(r);
    expect(fired).toBe(1);
    expect(new Set(c).size).toBe(c.length);
    for (let i = 1; i < c.length; i++) expect(c[i]!).toBeGreaterThan(c[i - 1]!);
    expect(c[c.length - 1]).toBe(2105);
  });

  test("no ledger", () => {
    const { dir } = mk();
    expect(readLedger(dir)).toEqual({ kind: "ok", entries: [], skipped: 0 });
  });

  test("unreadable ledger", () => {
    const { dir } = mk();
    mkdirSync(active(dir));
    const r = readLedger(dir);
    expect(r.kind).toBe("unreadable");
    expect(r.kind === "unreadable" && r.issues[0]?.message).toContain("EISDIR");
  });

  test("unterminated line is skipped after a later append", () => {
    const { dir } = mk();
    writeFileSync(active(dir), JSON.stringify(entry(1)));
    expect(appendLedger(dir, entry(2)).ok).toBe(true);
    const r = readLedger(dir);
    expect(chars(r)).toEqual([]);
    expect(r.kind === "ok" && r.skipped).toBe(1);
    expect(appendLedger(dir, entry(3)).ok).toBe(true);
    expect(chars(readLedger(dir))).toEqual([3]);
  });

  test("oversized line rejected", () => {
    const { dir } = mk();
    const json = JSON.stringify(entry(1));
    const padded = `${json.slice(0, -1)}${" ".repeat(4100 - json.length)}}`;
    expect(Buffer.byteLength(padded)).toBe(4100);
    writeFileSync(active(dir), `${padded}\n${J(entry(2))}`);
    const r = readLedger(dir);
    expect(chars(r)).toEqual([2]);
    expect(r.kind === "ok" && r.skipped).toBe(1);
  });

  test("oversized multibyte line skipped", () => {
    const { dir } = mk();
    const line = JSON.stringify({ ...entry(1), model: `a/${"é".repeat(2100)}` });
    expect(line.length).toBeLessThan(4096);
    expect(Buffer.byteLength(line)).toBeGreaterThan(4096);
    writeFileSync(active(dir), `${line}\n${J(entry(2))}`);
    const r = readLedger(dir);
    expect(chars(r)).toEqual([2]);
    expect(r.kind === "ok" && r.skipped).toBe(1);
  });

  test("blank line skipped", () => {
    const { dir } = mk();
    writeFileSync(active(dir), `${J(entry(1))}\n${J(entry(2))}`);
    const r = readLedger(dir);
    expect(chars(r)).toEqual([1, 2]);
    expect(r.kind === "ok" && r.skipped).toBe(1);
  });

  test("empty active next to full old segment", () => {
    const { dir } = mk();
    writeFileSync(old(dir), seq(1, 2000));
    writeFileSync(active(dir), "");
    const r = readLedger(dir);
    expect(chars(r).length).toBe(2000);
    expect(r.kind === "ok" && r.skipped).toBe(0);
  });
});
