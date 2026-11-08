import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic.ts";
import { MODES, type Mode } from "./defaults.ts";
import { integer, object, oneOf, type Issue, type V, type WriteResult } from "./validate.ts";

/** Project-relative path of the directory mode file. */
export const LOCAL_MODE_FILE = ".pi/jev-mode.json";

const PI_DIR = ".pi";
const FILE_NAME = "jev-mode.json";

export type LocalModeRead =
  | { kind: "missing" }
  | { kind: "ok"; mode: Mode }
  | { kind: "malformed" | "unreadable"; issues: Issue[] };

const localModeValidator = object(
  {
    version: integer({ min: 1, max: 1 }),
    mode: oneOf(MODES),
  },
  { required: ["version", "mode"] },
) as V<{ version?: 1; mode?: Mode }>;

function errorCode(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" ? code : "EIO";
}

function parseLocalMode(text: string): LocalModeRead {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {
      kind: "malformed",
      issues: [{ path: "", message: "jev-mode.json is not valid JSON" }],
    };
  }
  const issues: Issue[] = [];
  const parsed = localModeValidator(raw, "", issues);
  if (issues.length > 0 || parsed?.mode === undefined) {
    return { kind: "malformed", issues };
  }
  return { kind: "ok", mode: parsed.mode };
}

/** Reads `<cwd>/.pi/jev-mode.json`. Never throws. */
export function readLocalMode(cwd: string): LocalModeRead {
  let text: string;
  try {
    text = readFileSync(join(cwd, LOCAL_MODE_FILE), "utf8");
  } catch (err) {
    const code = errorCode(err);
    if (code === "ENOENT") return { kind: "missing" };
    return {
      kind: "unreadable",
      issues: [{ path: "", message: `cannot read ${LOCAL_MODE_FILE} (${code})` }],
    };
  }
  return parseLocalMode(text);
}

/** Atomically writes `<cwd>/.pi/jev-mode.json`, creating `.pi/` when missing. Never throws. */
export function writeLocalMode(cwd: string, mode: Mode): WriteResult {
  const document = { version: 1, mode };
  const written = writeFileAtomic(
    join(cwd, PI_DIR),
    FILE_NAME,
    JSON.stringify(document, null, 2) + "\n",
  );
  if (!written.ok) {
    return {
      ok: false,
      issues: [{ path: "", message: `cannot write ${LOCAL_MODE_FILE} (${written.code})` }],
    };
  }
  return { ok: true };
}

/** Removes `<cwd>/.pi/jev-mode.json`; a missing file counts as removed. Never throws. */
export function clearLocalMode(cwd: string): WriteResult {
  try {
    rmSync(join(cwd, LOCAL_MODE_FILE), { force: true });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      issues: [{ path: "", message: `cannot remove ${LOCAL_MODE_FILE} (${errorCode(err)})` }],
    };
  }
}
