import { chmodSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { migrateLegacyNames } from "../../../src/host/platform/migrate.ts";
import { readConfig } from "../../../src/store/config.ts";
import { tempDir } from "../../helpers.ts";

const isRoot = process.getuid?.() === 0;
const dirs: string[] = [];

function jev(config?: string, state?: string): string {
  const dir = tempDir("jev-migrate-");
  dirs.push(dir);
  if (config !== undefined) writeFileSync(join(dir, "config.json"), config);
  if (state !== undefined) writeFileSync(join(dir, "state.json"), state);
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) {
    chmodSync(d, 0o700);
    rmSync(d, { recursive: true, force: true });
  }
});

const OLD_CONFIG =
  '{"classifier":{"timeoutMs":1500},"tiers":{"fast":"a/x","deep":"a/y","expert":"a/z"}}';
const read = (dir: string, name: string) => readFileSync(join(dir, name), "utf8");

describe("migrateLegacyNames", () => {
  test("Config migrated at start", () => {
    const dir = jev(OLD_CONFIG);
    const file = join(dir, "config.json");
    chmodSync(file, 0o640);
    const notes: string[] = [];
    migrateLegacyNames(dir, (m) => notes.push(m));
    const raw = JSON.parse(read(dir, "config.json"));
    expect(Object.keys(raw)).toEqual(["classifier", "tiers"]);
    expect(raw.tiers).toEqual({ basic: "a/x", deep: "a/y", frontier: "a/z" });
    expect(Object.keys(raw.tiers)).toEqual(["basic", "deep", "frontier"]);
    expect(statSync(file).mode & 0o777).toBe(0o640);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("tiers.fast → tiers.basic");
    expect(notes[0]).toContain("tiers.expert → tiers.frontier");
    expect(notes[0]).toContain(file);
  });

  test("State migrated at start", () => {
    const dir = jev(undefined, '{"version":1,"switches":{"expert":false,"skills":false}}');
    const notes: string[] = [];
    migrateLegacyNames(dir, (m) => notes.push(m));
    expect(JSON.parse(read(dir, "state.json"))).toEqual({
      version: 1,
      switches: { skills: false, frontier: false },
    });
    expect(Object.keys(JSON.parse(read(dir, "state.json")).switches)).toEqual([
      "skills",
      "frontier",
    ]);
  });

  test("Legacy frontier slot kept", () => {
    const text = JSON.stringify({
      tiers: { fast: "a/x" },
      crew: { slots: [{ name: "frontier", model: "a/y", when: "Choose it." }] },
    });
    const dir = jev(text);
    migrateLegacyNames(dir, () => {});
    const raw = JSON.parse(read(dir, "config.json"));
    expect(raw.tiers).toEqual({ basic: "a/x" });
    expect(raw.crew.slots[0].name).toBe("frontier");
    const r = readConfig(dir);
    expect(r.kind === "ok" ? r.notices : []).toEqual([
      'crew.slots "frontier" uses a reserved name; rename it',
    ]);
  });

  test("Nothing to migrate", () => {
    const config = '{"tiers":{"basic":"a/x"}}';
    const state = '{"version":1,"switches":{"frontier":false}}';
    const dir = jev(config, state);
    const old = new Date(2020, 0, 1);
    for (const f of ["config.json", "state.json"]) utimesSync(join(dir, f), old, old);
    const before = ["config.json", "state.json"].map((f) => statSync(join(dir, f)).mtimeMs);
    const notes: string[] = [];
    migrateLegacyNames(dir, (m) => notes.push(m));
    expect(read(dir, "config.json")).toBe(config);
    expect(read(dir, "state.json")).toBe(state);
    expect(["config.json", "state.json"].map((f) => statSync(join(dir, f)).mtimeMs)).toEqual(
      before,
    );
    expect(notes).toEqual([]);
  });

  test("Missing files are nothing to migrate", () => {
    const notes: string[] = [];
    migrateLegacyNames(jev(), (m) => notes.push(m));
    expect(notes).toEqual([]);
  });

  test("Conflicting keys left alone", () => {
    const text = '{"tiers":{"expert":"a/x","frontier":"a/y"}}';
    const dir = jev(text);
    const notes: string[] = [];
    migrateLegacyNames(dir, (m) => notes.push(m));
    expect(read(dir, "config.json")).toBe(text);
    expect(notes).toEqual([]);
    const r = readConfig(dir);
    expect(r.kind === "invalid" ? r.issues.map((i) => i.path) : []).toEqual(["tiers.expert"]);
  });

  test("Migration refuses an invalid file", () => {
    const text = '{"tiers":{"fast":"a/x"},"classifier":{"timeoutMs":100}}';
    const dir = jev(text);
    migrateLegacyNames(dir, () => {});
    expect(read(dir, "config.json")).toBe(text);
  });

  test.skipIf(isRoot)("Write failure", () => {
    const dir = jev(OLD_CONFIG, '{"version":1,"switches":{"expert":false}}');
    chmodSync(dir, 0o500);
    const notes: string[] = [];
    expect(() => migrateLegacyNames(dir, (m) => notes.push(m))).not.toThrow();
    expect(read(dir, "config.json")).toBe(OLD_CONFIG);
    expect(notes).toEqual([]);
    const r = readConfig(dir);
    expect(r.kind === "ok" ? r.config.tiers : undefined).toEqual({
      basic: "a/x",
      deep: "a/y",
      frontier: "a/z",
    });
  });

  test("A notify that throws never escapes", () => {
    const dir = jev(OLD_CONFIG);
    expect(() =>
      migrateLegacyNames(dir, () => {
        throw new Error("ui gone");
      }),
    ).not.toThrow();
  });
});
