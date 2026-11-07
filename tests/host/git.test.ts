import { describe, expect, test } from "bun:test";
import { gitCounts } from "../../src/host/git.ts";

type R = { stdout: string; code: number; killed?: boolean; truncated?: boolean };
const ok: R = { stdout: " 2 files changed, 5 insertions(+), 1 deletion(-)\n", code: 0 };
const exec = (r: R | (() => Promise<R>)) => async () => (typeof r === "function" ? r() : r);

describe("gitCounts", () => {
  test("code 0 parses", async () => {
    expect(await gitCounts(exec(ok), "/x")).toEqual({ changed_files: 2, diff_lines: 6 });
  });
  test("code 128 omits", async () => {
    const r = { stdout: "", code: 128 };
    expect(await gitCounts(exec(r), "/x")).toBeUndefined();
  });
  test("killed omits", async () => {
    expect(await gitCounts(exec({ ...ok, killed: true }), "/x")).toBeUndefined();
  });
  test("truncated omits", async () => {
    expect(await gitCounts(exec({ ...ok, truncated: true }), "/x")).toBeUndefined();
  });
  test("throw omits", async () => {
    const boom = async (): Promise<R> => {
      throw new Error("boom");
    };
    expect(await gitCounts(exec(boom), "/x")).toBeUndefined();
  });
  test("slow exec omits after 500 ms", async () => {
    const slow = () => new Promise<R>((resolve) => setTimeout(() => resolve(ok), 2000));
    const start = Date.now();
    expect(await gitCounts(exec(slow), "/x")).toBeUndefined();
    expect(Date.now() - start).toBeLessThan(600);
  });
});
