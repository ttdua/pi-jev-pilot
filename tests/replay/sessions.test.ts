import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { branchTo, readLedgerLines, readSessionFile } from "../../scripts/replay/sessions.ts";

const dir = join(import.meta.dir, "../fixtures/replay/sessions");

describe("sessions", () => {
  test("skips corrupt lines", () => {
    const { header, entries } = readSessionFile(join(dir, "main.jsonl"))!;
    expect(header).toEqual({ id: "s-main", cwd: "/work/alpha" });
    expect(entries).toHaveLength(10);
  });

  test("reads parentSession from a child header", () => {
    expect(readSessionFile(join(dir, "child.jsonl"))!.header.parentSession).toBe(
      "/sessions/main.jsonl",
    );
  });

  test("branch follows parentId", () => {
    const { entries } = readSessionFile(join(dir, "main.jsonl"))!;
    expect(branchTo(entries, "u3").map((e) => e.id)).toEqual(["u1", "c1", "a1", "u3"]);
    expect(branchTo(entries, "nope")).toEqual([]);
  });

  test("headerless file yields undefined", () => {
    expect(readSessionFile(join(dir, "bad.jsonl"))).toBeUndefined();
  });

  test("entries with non-string ids are dropped of those fields", () => {
    const { entries } = readSessionFile(join(dir, "main.jsonl"))!;
    expect(entries.every((e) => e.id === undefined || typeof e.id === "string")).toBe(true);
  });

  test("branchTo terminates on a parentId cycle", () => {
    const cyc = [
      { type: "message", id: "a", parentId: "b" },
      { type: "message", id: "b", parentId: "a" },
    ];
    expect(branchTo(cyc, "a").map((e) => e.id)).toEqual(["b", "a"]);
  });

  test("ledger lines parsed, bad lines skipped", () => {
    const ledger = readLedgerLines(dir);
    expect([...ledger.keys()].sort()).toEqual(["turn-1", "turn-2"]);
    expect(ledger.get("turn-2")).toEqual({ effective: "medium", strategy: "auto", from: "low" });
  });
});
