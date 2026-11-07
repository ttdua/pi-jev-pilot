import { afterEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitCounts } from "../../src/host/git.ts";
import { recordGitCounts } from "../../src/host/git-record.ts";

const roots: string[] = [];
const temp = (name = "jev-rec-"): string => {
  const d = mkdtempSync(join(tmpdir(), name));
  roots.push(d);
  return d;
};
afterEach(() => {
  for (const d of roots.splice(0)) {
    try {
      chmodSync(d, 0o700);
    } catch {
      /* gone */
    }
    rmSync(d, { recursive: true, force: true });
  }
});

const counts = (changed_files = 2, diff_lines = 9) =>
  Promise.resolve({ changed_files, diff_lines });
const input = (dir: string, c: ReturnType<typeof counts> | Promise<undefined> = counts()) => ({
  dir,
  at: 1234,
  session: "sess-1",
  turnId: "turn-1",
  counts: c,
});
const file = (dir: string): string => join(dir, "replay-git.jsonl");

describe("recordGitCounts", () => {
  test("line written", async () => {
    const dir = join(temp(), "jev");
    await recordGitCounts(input(dir));
    const line = JSON.parse(readFileSync(file(dir), "utf8").trim()) as Record<string, unknown>;
    expect(Object.keys(line).sort()).toEqual(
      ["at", "changedFiles", "diffLines", "session", "turnId", "v"].sort(),
    );
    expect(line).toEqual({
      v: 1,
      at: 1234,
      session: "sess-1",
      turnId: "turn-1",
      changedFiles: 2,
      diffLines: 9,
    });
  });

  test("no names stored", async () => {
    const root = temp("JEV-MARKER-DIR-");
    const run = (args: string[]) => {
      const r = Bun.spawnSync(["git", ...args], { cwd: root });
      expect(r.exitCode).toBe(0);
    };
    run(["init", "-q"]);
    run(["config", "user.email", "t@t"]);
    run(["config", "user.name", "t"]);
    writeFileSync(join(root, "JEV-MARKER-FILE.ts"), "a\n");
    run(["add", "."]);
    run(["commit", "-qm", "x"]);
    writeFileSync(join(root, "JEV-MARKER-FILE.ts"), "a\nb\nc\n");
    const exec = async (cmd: string, args: string[], o: { cwd: string }) => {
      const r = Bun.spawnSync([cmd, ...args], { cwd: o.cwd });
      return { stdout: r.stdout.toString(), code: r.exitCode };
    };
    const dir = temp();
    await recordGitCounts(input(dir, gitCounts(exec, root) as never));
    const text = readFileSync(file(dir), "utf8");
    expect(text).not.toContain("JEV-MARKER-DIR");
    expect(text).not.toContain("JEV-MARKER-FILE");
    expect(JSON.parse(text)).toMatchObject({ changedFiles: 1, diffLines: 2 });
  });

  test("owner-only", async () => {
    const dir = join(temp(), "jev");
    await recordGitCounts(input(dir));
    expect(statSync(file(dir)).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  test("unknown counts write nothing", async () => {
    const dir = join(temp(), "jev");
    await recordGitCounts(input(dir, Promise.resolve(undefined)));
    expect(existsSync(file(dir))).toBe(false);
  });

  test("rejecting counts write nothing and do not throw", async () => {
    const dir = join(temp(), "jev");
    await recordGitCounts(input(dir, Promise.reject(new Error("x")) as never));
    expect(existsSync(file(dir))).toBe(false);
  });

  test("write failure swallowed", async () => {
    const root = temp();
    const dir = join(root, "jev");
    mkdirSync(dir);
    chmodSync(dir, 0o500);
    await expect(recordGitCounts(input(dir))).resolves.toBeUndefined();
    expect(existsSync(file(dir))).toBe(false);
  });

  test("cap reached", async () => {
    const dir = temp();
    writeFileSync(file(dir), "{}\n".repeat(5000));
    await recordGitCounts(input(dir));
    expect(readFileSync(file(dir), "utf8").split("\n").length - 1).toBe(5000);
  });

  test("a file at the size bound counts as full", async () => {
    const dir = temp();
    writeFileSync(file(dir), "x".repeat(5000 * 512));
    await recordGitCounts(input(dir));
    expect(statSync(file(dir)).size).toBe(5000 * 512);
  });

  test("below the cap still appends", async () => {
    const dir = temp();
    writeFileSync(file(dir), "{}\n".repeat(4999));
    await recordGitCounts(input(dir));
    expect(readFileSync(file(dir), "utf8").split("\n").length - 1).toBe(5000);
  });

  test("two appends give two whole lines", async () => {
    const dir = temp();
    await recordGitCounts(input(dir));
    await recordGitCounts(input(dir, counts(3, 4)));
    const lines = readFileSync(file(dir), "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => (JSON.parse(l) as { changedFiles: number }).changedFiles)).toEqual([
      2, 3,
    ]);
    appendFileSync(file(dir), "");
  });
});
