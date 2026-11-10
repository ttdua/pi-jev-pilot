import { existsSync, rmSync, statSync } from "node:fs";
import { basename, dirname } from "node:path";
import { expect, test } from "bun:test";
import { makeOutDir, resolveModel } from "../../../src/host/review/codex.ts";
import type { Exec } from "../../../src/policy/review/index.ts";

const catalog = JSON.stringify({ models: [{ slug: "gpt-6-luna", visibility: "list" }] });
const answer =
  (stdout: string, code = 0, killed = false): Exec =>
  async () => ({ stdout, stderr: "", code, killed, truncated: false });

test("resolveModel leaves undefined and pinned models alone without calling exec", async () => {
  const exec: Exec = async () => {
    throw new Error("must not run");
  };
  expect(await resolveModel(exec, undefined, "/w", undefined)).toBeUndefined();
  expect(await resolveModel(exec, "gpt-5", "/w", undefined)).toBe("gpt-5");
});

test("resolveModel maps a tier through the catalog and falls back on any failure", async () => {
  expect(await resolveModel(answer(catalog), "luna", "/w", undefined)).toBe("gpt-6-luna");
  expect(await resolveModel(answer(catalog, 1), "luna", "/w", undefined)).toBe("luna");
  expect(await resolveModel(answer(catalog, 0, true), "luna", "/w", undefined)).toBe("luna");
  expect(await resolveModel(answer("{}"), "luna", "/w", undefined)).toBe("luna");
  const boom: Exec = () => Promise.reject(new Error("x"));
  expect(await resolveModel(boom, "luna", "/w", undefined)).toBe("luna");
});

test("makeOutDir creates a 0700 jev-review directory", () => {
  const dir = makeOutDir();
  try {
    expect(basename(dir).startsWith("jev-review-")).toBe(true);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(existsSync(dirname(dir))).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
