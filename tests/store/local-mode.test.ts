import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  LOCAL_MODE_FILE,
  clearLocalMode,
  readLocalMode,
  writeLocalMode,
} from "../../src/store/local-mode.ts";
import { tempDir } from "../helpers.ts";

const isRoot = process.getuid?.() === 0;

function withCwd(fn: (cwd: string) => void): void {
  const cwd = tempDir("jev-local-mode-");
  try {
    fn(cwd);
  } finally {
    chmodSync(cwd, 0o700);
    rmSync(cwd, { recursive: true, force: true });
  }
}

function put(cwd: string, text: string): void {
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(join(cwd, LOCAL_MODE_FILE), text);
}

function paths(r: ReturnType<typeof readLocalMode>): string[] {
  return "issues" in r ? r.issues.map((i) => i.path) : [];
}

describe("directory mode file content", () => {
  test("File content: write creates .pi and stores exactly version and mode", () =>
    withCwd((cwd) => {
      expect(writeLocalMode(cwd, "budget")).toEqual({ ok: true });
      const parsed = JSON.parse(readFileSync(join(cwd, LOCAL_MODE_FILE), "utf8"));
      expect(parsed).toEqual({ version: 1, mode: "budget" });
      expect(readLocalMode(cwd)).toEqual({ kind: "ok", mode: "budget" });
    }));

  test("missing: no file reads as missing", () =>
    withCwd((cwd) => {
      expect(readLocalMode(cwd)).toEqual({ kind: "missing" });
    }));

  test("Unknown mode name is malformed at mode", () =>
    withCwd((cwd) => {
      put(cwd, '{"version":1,"mode":"ultra"}');
      const r = readLocalMode(cwd);
      expect(r.kind).toBe("malformed");
      expect(paths(r)).toEqual(["mode"]);
    }));

  test("readLocalMode rejects extra keys and other versions", () =>
    withCwd((cwd) => {
      for (const text of [
        '{"version":2,"mode":"budget"}',
        '{"version":1,"mode":"budget","x":1}',
        '{"version":1,"mode":null}',
      ]) {
        put(cwd, text);
        expect(readLocalMode(cwd).kind).toBe("malformed");
      }
    }));

  test("invalid JSON is malformed at the (file) path", () =>
    withCwd((cwd) => {
      put(cwd, "{not json");
      const r = readLocalMode(cwd);
      expect(r.kind).toBe("malformed");
      expect(paths(r)).toEqual([""]);
    }));

  test.skipIf(isRoot)("unreadable: EACCES is named in the issue", () =>
    withCwd((cwd) => {
      put(cwd, '{"version":1,"mode":"budget"}');
      chmodSync(join(cwd, LOCAL_MODE_FILE), 0o000);
      const r = readLocalMode(cwd);
      expect(r.kind).toBe("unreadable");
      expect(JSON.stringify(r)).toContain("EACCES");
    }),
  );
});

describe("clearing and other project files", () => {
  test("clearLocalMode removes the file", () =>
    withCwd((cwd) => {
      expect(writeLocalMode(cwd, "premium")).toEqual({ ok: true });
      expect(clearLocalMode(cwd)).toEqual({ ok: true });
      expect(existsSync(join(cwd, LOCAL_MODE_FILE))).toBe(false);
      expect(readLocalMode(cwd)).toEqual({ kind: "missing" });
    }));

  test("clearLocalMode on a missing file is ok", () =>
    withCwd((cwd) => {
      expect(clearLocalMode(cwd)).toEqual({ ok: true });
    }));

  test("No other project file touched", () =>
    withCwd((cwd) => {
      const gitignore = "node_modules/\n.env\n";
      writeFileSync(join(cwd, ".gitignore"), gitignore);
      expect(writeLocalMode(cwd, "premium")).toEqual({ ok: true });
      clearLocalMode(cwd);
      expect(readFileSync(join(cwd, ".gitignore"), "utf8")).toBe(gitignore);
      expect(readdirSync(cwd).sort()).toEqual([".gitignore", ".pi"]);
    }));

  test.skipIf(isRoot)(
    "Directory not writable: .pi as a regular file fails with the path and code",
    () =>
      withCwd((cwd) => {
        writeFileSync(join(cwd, ".pi"), "not a directory");
        const r = writeLocalMode(cwd, "budget");
        expect(r.ok).toBe(false);
        if (r.ok) return;
        const message = r.issues.map((i) => i.message).join("\n");
        expect(message).toContain(".pi/jev-mode.json");
        expect(message).toMatch(/\(E[A-Z]+\)/);
      }),
  );
});
