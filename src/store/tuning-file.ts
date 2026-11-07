import { chmodSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic.ts";
import {
  array,
  boolean,
  integer,
  joinPath,
  object,
  oneOf,
  type Issue,
  type V,
  type WriteResult,
} from "./validate.ts";

export type TuningCause = "rule" | "revert" | "undo" | "reset" | "superseded";

export type TuningDocument = {
  off?: boolean;
  seenAt?: number;
  timeoutMs?: { value: number; base: number };
  pending?: {
    from: number;
    to: number;
    at: number;
    before: { asked: number; timeouts: number };
  };
  block?: { value: number; at: number };
  history?: Array<{
    at: number;
    parameter: "timeoutMs";
    from: number;
    to: number;
    cause: TuningCause;
  }>;
};

export type TuningRead =
  | { kind: "ok"; record: TuningDocument }
  | { kind: "missing"; record: {} }
  | { kind: "malformed"; record: {}; issues: Issue[] }
  | { kind: "unreadable"; record: {}; issues: Issue[] };

const CAUSES = ["rule", "revert", "undo", "reset", "superseded"] as const;
const AT_MAX = 8_640_000_000_000_000;
const HISTORY_MAX = 50;

const timeout = integer({ min: 300, max: 5000 });
const at = integer({ min: 0, max: AT_MAX });

/** `timeouts` may not exceed `asked`; the issue is reported at the `timeouts` path. */
function beforeValidator(): V<{ asked: number; timeouts: number }> {
  const inner = object(
    { asked: integer({ min: 0, max: 40 }), timeouts: integer({ min: 0, max: 40 }) },
    { required: ["asked", "timeouts"] },
  ) as V<{ asked: number; timeouts: number }>;
  return (value, path, issues) => {
    const v = inner(value, path, issues);
    if (v === undefined) return undefined;
    if (v.timeouts > v.asked) {
      issues.push({ path: joinPath(path, "timeouts"), message: "expected at most asked" });
      return undefined;
    }
    return v;
  };
}

function tuningValidator(): V<TuningDocument & { version: 1 }> {
  const entry = object(
    {
      at,
      parameter: oneOf(["timeoutMs"] as const),
      from: timeout,
      to: timeout,
      cause: oneOf(CAUSES),
    },
    { required: ["at", "parameter", "from", "to", "cause"] },
  );
  return object(
    {
      version: integer({ min: 1, max: 1 }),
      off: boolean(),
      timeoutMs: object({ value: timeout, base: timeout }, { required: ["value", "base"] }),
      pending: object(
        { from: timeout, to: timeout, at, before: beforeValidator() },
        { required: ["from", "to", "at", "before"] },
      ),
      block: object({ value: timeout, at }, { required: ["value", "at"] }),
      history: array(entry, { max: HISTORY_MAX }),
      seenAt: at,
    },
    { required: ["version"] },
  ) as V<TuningDocument & { version: 1 }>;
}

/** Validates a candidate tuning.json document (including `version`). */
export function validateTuning(doc: unknown): Issue[] {
  const issues: Issue[] = [];
  tuningValidator()(doc, "", issues);
  return issues;
}

function parseTuning(text: string): { record: TuningDocument } | { issues: Issue[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { issues: [{ path: "", message: "tuning.json is not valid JSON" }] };
  }
  const issues: Issue[] = [];
  const parsed = tuningValidator()(raw, "", issues);
  // Load-bearing: `object` can return a value while issues exist.
  if (issues.length > 0 || parsed === undefined) return { issues };
  const { version: _version, ...record } = parsed;
  return { record };
}

export function readTuning(dir: string): TuningRead {
  let text: string;
  try {
    text = readFileSync(join(dir, "tuning.json"), "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "EIO";
    if (code === "ENOENT") return { kind: "missing", record: {} };
    return {
      kind: "unreadable",
      record: {},
      issues: [{ path: "", message: `cannot read tuning.json (${code})` }],
    };
  }
  const result = parseTuning(text);
  if ("issues" in result) return { kind: "malformed", record: {}, issues: result.issues };
  return { kind: "ok", record: result.record };
}

/** Reads, mutates, validates and atomically writes tuning.json. Never throws. */
export function updateTuning(
  dir: string,
  mutate: (r: TuningDocument) => TuningDocument,
): WriteResult {
  const read = readTuning(dir);
  if (read.kind === "unreadable") return { ok: false, issues: read.issues };
  let next: TuningDocument;
  try {
    next = mutate(read.kind === "ok" ? read.record : {});
  } catch {
    return { ok: false, issues: [{ path: "", message: "update failed" }] };
  }
  const document = { version: 1, ...next };
  const issues = validateTuning(document);
  if (issues.length > 0) return { ok: false, issues };
  if (read.kind === "malformed") {
    const bad = join(dir, "tuning.json.bad");
    try {
      renameSync(join(dir, "tuning.json"), bad);
      chmodSync(bad, 0o600);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "EIO";
      return {
        ok: false,
        issues: [{ path: "", message: `cannot move tuning.json aside (${code})` }],
      };
    }
  }
  const written = writeFileAtomic(dir, "tuning.json", JSON.stringify(document, null, 2) + "\n");
  if (!written.ok) {
    return {
      ok: false,
      issues: [{ path: "", message: `cannot write tuning.json (${written.code})` }],
    };
  }
  return { ok: true };
}
