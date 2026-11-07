import { afterEach, describe, expect, test } from "bun:test";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseJevArgs } from "../../src/host/commands.ts";
import { parseSlotArgs, runSlot, type SlotArgs } from "../../src/host/slots.ts";

type FakeModel = { provider: string; id: string; reasoning: boolean; thinkingLevelMap?: undefined };

function fake(ids: string[], keyless: string[] = []): ModelRegistry {
  const models: FakeModel[] = ids.map((full) => {
    const [provider, ...rest] = full.split("/");
    return { provider: provider ?? "", id: rest.join("/"), reasoning: true };
  });
  const key = (m: FakeModel): string => `${m.provider}/${m.id}`;
  return {
    find: (p: string, id: string) => models.find((m) => m.provider === p && m.id === id),
    hasConfiguredAuth: (m: FakeModel) => !keyless.includes(key(m)),
    getAvailable: () => models.filter((m) => !keyless.includes(key(m))),
  } as unknown as ModelRegistry;
}

const registry = fake(
  [
    "fixture/fixture-review",
    "fixture/fixture-fast",
    "fixture/fixture-main",
    "fixture/fixture-balanced",
    "fixture/fixture-other",
    "fixture2/fixture-deep",
  ],
  ["fixture2/fixture-deep"],
);

const dirs: string[] = [];
function jevDir(config?: unknown, raw?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "jev-slots-"));
  dirs.push(dir);
  if (raw !== undefined) writeFileSync(join(dir, "config.json"), raw);
  else if (config !== undefined) writeFileSync(join(dir, "config.json"), JSON.stringify(config));
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      chmodSync(dir, 0o700);
    } catch {
      // already gone
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

const file = (dir: string): string => readFileSync(join(dir, "config.json"), "utf8");
const slotsOf = (dir: string): unknown =>
  (JSON.parse(file(dir)) as { crew?: { slots?: unknown } }).crew?.slots;
const slot = (name: string, model: string, when: string) => ({ name, model, when });
const set = (name: string, model: string, when?: string): SlotArgs =>
  when === undefined ? { kind: "set", name, model } : { kind: "set", name, model, when };

describe("parseSlotArgs", () => {
  test("Add with when", () => {
    expect(
      parseSlotArgs("reviewer fixture/fixture-review when Choose for reviews.  Not for fixing."),
    ).toEqual(set("reviewer", "fixture/fixture-review", "Choose for reviews.  Not for fixing."));
  });
  test("When text containing when", () => {
    expect(parseSlotArgs("r a/b when Choose when reviewing.")).toEqual(
      set("r", "a/b", "Choose when reviewing."),
    );
  });
  test("Third word not when", () => {
    expect(parseSlotArgs("r a/b for reviews")).toBe("usage");
    expect(parseSlotArgs("r a/b whenever x")).toBe("usage");
    expect(parseSlotArgs("r a/b when")).toBe("usage");
  });
  test("Empty when", () => {
    expect(parseSlotArgs("r a/b when \t ")).toBe("usage");
  });
  test("Reserved name", () => {
    expect(parseSlotArgs("review a/b when x")).toBeUndefined();
    expect(parseJevArgs("review a/b when x")).toEqual({ kind: "usage" });
    expect(parseSlotArgs("skills off")).toBeUndefined();
  });
  test("Remove forms", () => {
    expect(parseSlotArgs("remove reviewer")).toEqual({ kind: "remove", name: "reviewer" });
    expect(parseSlotArgs("remove reviewer now")).toBe("usage");
    expect(parseSlotArgs("remove")).toBe("usage");
    expect(parseSlotArgs("remove Bad")).toBe("usage");
  });
  test("Show and not-a-slot shapes", () => {
    expect(parseSlotArgs("reviewer")).toEqual({ kind: "show", name: "reviewer" });
    expect(parseSlotArgs("Colors off")).toBeUndefined();
    expect(parseSlotArgs("colors off")).toEqual(set("colors", "off"));
    expect(parseSlotArgs("")).toBeUndefined();
  });
});

describe("runSlot add", () => {
  test("Bad model shape reported before missing when", () => {
    const dir = jevDir();
    const out = runSlot(set("colors", "off"), registry, dir);
    expect(out).toMatchObject({ ok: false, usage: true });
    expect(out.message).toContain("not a provider/model");
    expect(out.message).not.toContain("Try:");
  });
  test("New slot without when", () => {
    const dir = jevDir({ tiers: { fast: "a/b" } });
    const before = file(dir);
    const out = runSlot(set("reviewer", "fixture/fixture-review"), registry, dir);
    expect(out.ok).toBe(false);
    expect(out.message).toContain("needs when");
    expect(out.message).toContain("Choose");
    expect(out.message).toContain("Not for");
    expect(file(dir)).toBe(before);
  });
  test("Missing when reported before an unknown model", () => {
    const dir = jevDir();
    const out = runSlot(set("reviewer", "fixture/unknown"), registry, dir);
    expect(out.message).toContain("needs when");
    expect(out.message).not.toContain("registry");
  });
  test("New slot appended", () => {
    const old = {
      tiers: { fast: "a/b" },
      crew: { slots: [slot("bulk", "fixture/fixture-fast", "Bulk.")] },
    };
    const dir = jevDir(old);
    const out = runSlot(set("reviewer", "fixture/fixture-review", "Reviews."), registry, dir);
    expect(out).toEqual({
      ok: true,
      message: "slot reviewer: fixture/fixture-review\nwhen: Reviews.",
    });
    const now = JSON.parse(file(dir)) as typeof old;
    expect(now.crew.slots.map((s) => s.name)).toEqual(["bulk", "reviewer"]);
    expect(now.tiers).toEqual(old.tiers);
  });
  test("Ninth slot", () => {
    const slots = Array.from({ length: 8 }, (_, i) => slot(`s${i}`, "fixture/fixture-fast", "x"));
    const dir = jevDir({ crew: { slots } });
    const before = file(dir);
    const out = runSlot(set("ninth", "fixture/fixture-fast", "x"), registry, dir);
    expect(out.ok).toBe(false);
    expect(out.message).toContain("crew.slots");
    expect(file(dir)).toBe(before);
  });
  test("Created from nothing", () => {
    const dir = jevDir();
    expect(runSlot(set("reviewer", "fixture/fixture-review", "Reviews."), registry, dir).ok).toBe(
      true,
    );
    expect(JSON.parse(file(dir))).toEqual({
      crew: { slots: [slot("reviewer", "fixture/fixture-review", "Reviews.")] },
    });
  });
  test.skipIf(process.getuid?.() === 0)("Write error", () => {
    const dir = jevDir({ tiers: { fast: "a/b" } });
    const before = file(dir);
    chmodSync(dir, 0o500);
    const out = runSlot(set("reviewer", "fixture/fixture-review", "Reviews."), registry, dir);
    expect(out.ok).toBe(false);
    expect(out.message).toContain("EACCES");
    expect(file(dir)).toBe(before);
  });
  test("Keyless model refused", () => {
    const dir = jevDir();
    const out = runSlot(set("r", "fixture2/fixture-deep", "x"), registry, dir);
    expect(out.ok).toBe(false);
    expect(out.message).toContain("no credentials");
    expect(out.message).not.toContain("fixture2/fixture-deep\n");
    expect(out.message).not.toMatch(/Try:.*fixture2\/fixture-deep/);
  });
  test("Typo suggests the right model", () => {
    const dir = jevDir();
    const out = runSlot(set("reviewer", "fixture/fixture-reviw", "Reviews."), registry, dir);
    expect(out.ok).toBe(false);
    expect(out.message).toContain("not in the model registry");
    const tryLine = out.message.split("\n").find((l) => l.startsWith("Try:"));
    expect(tryLine?.startsWith("Try: fixture/fixture-review")).toBe(true);
    expect(tryLine?.split(",").length).toBeLessThanOrEqual(3);
  });
  test("No usable model at all", () => {
    const out = runSlot(set("r", "x/y", "x"), fake([]), jevDir());
    expect(out.message).toContain("not in the model registry");
    expect(out.message).not.toContain("Try:");
  });
});

describe("runSlot replace", () => {
  const base = (): string =>
    jevDir({
      crew: {
        slots: [
          slot("reviewer", "fixture/fixture-review", "Choose for reviews."),
          slot("bulk", "fixture/fixture-fast", "Bulk."),
        ],
      },
    });
  test("Replace the model, keep when; position kept", () => {
    const dir = base();
    expect(runSlot(set("reviewer", "fixture/fixture-other"), registry, dir).ok).toBe(true);
    expect(slotsOf(dir)).toEqual([
      slot("reviewer", "fixture/fixture-other", "Choose for reviews."),
      slot("bulk", "fixture/fixture-fast", "Bulk."),
    ]);
  });
  test("Replace when", () => {
    const dir = base();
    runSlot(set("reviewer", "fixture/fixture-review", "Choose for audits."), registry, dir);
    expect((slotsOf(dir) as { when: string }[])[0]?.when).toBe("Choose for audits.");
  });
});

describe("runSlot show and remove", () => {
  test("Show", () => {
    const dir = jevDir({
      crew: { slots: [slot("reviewer", "fixture/fixture-review", "Reviews.")] },
    });
    const before = file(dir);
    const mtime = statSync(join(dir, "config.json")).mtimeMs;
    const out = runSlot({ kind: "show", name: "reviewer" }, registry, dir);
    expect(out).toEqual({
      ok: true,
      message: "slot reviewer: fixture/fixture-review\nwhen: Reviews.",
    });
    expect(file(dir)).toBe(before);
    expect(statSync(join(dir, "config.json")).mtimeMs).toBe(mtime);
  });
  test("Show unknown and Remove unknown", () => {
    const dir = jevDir({ tiers: { fast: "a/b" } });
    const shown = runSlot({ kind: "show", name: "reviewer" }, registry, dir);
    expect(shown).toMatchObject({ ok: false, usage: true });
    expect(shown.message).toContain("reviewer");
    const removed = runSlot({ kind: "remove", name: "bulk" }, registry, dir);
    expect(removed).toMatchObject({ ok: false, usage: true });
    expect(removed.message).toContain("bulk");
  });
  test("Remove the last slot", () => {
    const dir = jevDir({
      crew: { slots: [slot("reviewer", "fixture/fixture-review", "Reviews.")] },
    });
    const out = runSlot({ kind: "remove", name: "reviewer" }, registry, dir);
    expect(out).toEqual({ ok: true, message: "slot reviewer removed" });
    expect(JSON.parse(file(dir))).not.toHaveProperty("crew");
  });
});

describe("runSlot invalid config", () => {
  test("Add refused on an invalid file", () => {
    const dir = jevDir({ classifier: { timeoutMs: 1 } });
    const before = file(dir);
    const out = runSlot(set("r", "fixture/fixture-review", "x"), registry, dir);
    expect(out.ok).toBe(false);
    expect(out.message).toContain("classifier.timeoutMs");
    expect(file(dir)).toBe(before);
  });
  test("Show refused on an invalid file", () => {
    const dir = jevDir(undefined, "{nope");
    const out = runSlot({ kind: "show", name: "reviewer" }, registry, dir);
    expect(out.ok).toBe(false);
    expect(out.message).toContain("(file)");
    expect(file(dir)).toBe("{nope");
  });
});
