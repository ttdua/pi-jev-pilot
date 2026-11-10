import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { applyCommand } from "../../../src/host/commands/apply.ts";
import { readLocalMode } from "../../../src/store/local-mode.ts";
import { readState, type State } from "../../../src/store/state-file.ts";
import { tempDir } from "../../helpers.ts";

const roots: string[] = [];
function where() {
  const cwd = tempDir("apply-cwd-");
  const base = tempDir("apply-dir-");
  roots.push(cwd, base);
  return { cwd, dir: join(base, "jev") };
}
afterEach(() => {
  for (const d of roots.splice(0)) {
    try {
      chmodSync(join(d, ".pi"), 0o700);
    } catch {}
    rmSync(d, { recursive: true, force: true });
  }
});
const st = (dir: string) => readState(dir).state as State;

describe("applyCommand", () => {
  test("status changes nothing", () => {
    const w = where();
    expect(applyCommand({ kind: "status" }, w, undefined)).toEqual({ ok: true });
    expect(readState(w.dir).kind).toBe("missing");
  });
  test("a feature switch and `all` update the switches", () => {
    const w = where();
    expect(applyCommand({ kind: "set", feature: "skills", on: false }, w, undefined)).toEqual({
      ok: true,
    });
    expect(st(w.dir).switches?.skills).toBe(false);
    applyCommand({ kind: "all", on: false }, w, undefined);
    expect(st(w.dir).switches?.strategy).toBe(false);
  });
  test("a global mode is written to state, a local mode to the directory", () => {
    const w = where();
    applyCommand({ kind: "mode", mode: "premium", target: "global" }, w, undefined);
    expect(st(w.dir).mode).toBe("premium");
    applyCommand({ kind: "mode", mode: "budget", target: "local" }, w, undefined);
    expect(readLocalMode(w.cwd)).toEqual({ kind: "ok", mode: "budget" });
    expect(st(w.dir).mode).toBe("premium");
  });
  test("mode clear with no file is an info refusal", () => {
    expect(applyCommand({ kind: "mode-clear" }, where(), undefined)).toEqual({
      ok: false,
      message: "no directory mode set",
      level: "info",
    });
  });
  test("mode clear removes an existing directory mode", () => {
    const w = where();
    applyCommand({ kind: "mode", mode: "budget", target: "local" }, w, undefined);
    expect(applyCommand({ kind: "mode-clear" }, w, undefined)).toEqual({ ok: true });
    expect(readLocalMode(w.cwd).kind).toBe("missing");
  });
  test("a cli-review change stores the resolved choice and turns the review on", () => {
    const w = where();
    applyCommand({ kind: "cli-review", cli: "codex", model: "typed" }, w, {
      model: "resolved",
      effort: "high",
    });
    expect(st(w.dir)).toMatchObject({
      cliReviewEnabled: true,
      cliReview: { cli: "codex", model: "resolved", effort: "high" },
    });
  });
  test("a cli-review switch only flips the flag", () => {
    const w = where();
    applyCommand({ kind: "cli-review-switch", on: true }, w, undefined);
    expect(readState(w.dir).state).toEqual({ cliReviewEnabled: true });
  });
  test("reset also removes the directory mode", () => {
    const w = where();
    applyCommand({ kind: "mode", mode: "budget", target: "local" }, w, undefined);
    expect(applyCommand({ kind: "reset" }, w, undefined)).toEqual({ ok: true });
    expect(readLocalMode(w.cwd).kind).toBe("missing");
  });
  test.skipIf(process.getuid?.() === 0)("a failed directory cleanup is a partial reset", () => {
    const w = where();
    applyCommand({ kind: "mode", mode: "budget", target: "local" }, w, undefined);
    chmodSync(join(w.cwd, ".pi"), 0o500);
    const out = applyCommand({ kind: "reset" }, w, undefined);
    expect(out.ok).toBe(true);
    expect((out as { partialReset?: string }).partialReset).toMatch(
      /^global settings reset; directory mode not removed: .*EACCES/,
    );
  });
  test.skipIf(process.getuid?.() === 0)(
    "a refused directory write is an error and spares state",
    () => {
      const w = where();
      mkdirSync(join(w.cwd, ".pi"));
      chmodSync(join(w.cwd, ".pi"), 0o500);
      const out = applyCommand({ kind: "mode", mode: "budget", target: "local" }, w, undefined);
      expect(out).toMatchObject({ ok: false, level: "error" });
      expect(readState(w.dir).kind).toBe("missing");
    },
  );
});
