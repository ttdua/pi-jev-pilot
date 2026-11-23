import { chmodSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import {
  FLOOR_BANDS,
  FLOOR_PARAMETER,
  FLOOR_RANGES,
  type FloorBand,
} from "../shared/turn-floors.ts";
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

export type TuningParameter = "timeoutMs" | `turnFloor.${FloorBand}`;

export type FloorState = {
  changedAt: number;
  tuned?: { value: number; base: number };
  pending?: {
    from: number;
    to: number;
    at: number;
    before: { runs: number; exhausted: number };
  };
  block?: { value: number; at: number };
};

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
  turnFloors?: Partial<Record<FloorBand, FloorState>>;
  history?: Array<{
    at: number;
    parameter: TuningParameter;
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

/** `second` may not exceed `first`; the issue is reported at the `second` path. */
function pairValidator<A extends string, B extends string>(
  first: A,
  second: B,
  firstMax: number,
  secondMax: number,
): V<Record<A | B, number>> {
  const inner = object(
    {
      [first]: integer({ min: 0, max: firstMax }),
      [second]: integer({ min: 0, max: secondMax }),
    },
    { required: [first, second] },
  ) as unknown as V<Record<A | B, number>>;
  return (value, path, issues) => {
    const v = inner(value, path, issues);
    if (v === undefined) return undefined;
    if (v[second] > v[first]) {
      issues.push({ path: joinPath(path, second), message: `expected at most ${first}` });
      return undefined;
    }
    return v;
  };
}

const beforeValidator = () => pairValidator("asked", "timeouts", 40, 40);
const runsValidator = () => pairValidator("runs", "exhausted", 200, 200);

function floorStateValidator(band: FloorBand): V<FloorState> {
  const value = integer(FLOOR_RANGES[band]);
  return object(
    {
      changedAt: at,
      tuned: object({ value, base: value }, { required: ["value", "base"] }),
      pending: object(
        { from: value, to: value, at, before: runsValidator() },
        { required: ["from", "to", "at", "before"] },
      ),
      block: object({ value, at }, { required: ["value", "at"] }),
    },
    { required: ["changedAt"] },
  ) as V<FloorState>;
}

function turnFloorsValidator(): V<Partial<Record<FloorBand, FloorState>>> {
  const shape = Object.fromEntries(FLOOR_BANDS.map((b) => [b, floorStateValidator(b)]));
  return object(shape) as V<Partial<Record<FloorBand, FloorState>>>;
}

const FLOOR_PARAMETERS = FLOOR_BANDS.map(FLOOR_PARAMETER);

/** Checks `from`/`to` against the range of the entry's own `parameter`. */
function entryValidator(floors: boolean): V<NonNullable<TuningDocument["history"]>[number]> {
  const parameters: readonly TuningParameter[] = floors
    ? ["timeoutMs", ...FLOOR_PARAMETERS]
    : ["timeoutMs"];
  const byParameter = (range: { min: number; max: number }) =>
    object(
      {
        at,
        parameter: oneOf(parameters),
        from: integer(range),
        to: integer(range),
        cause: oneOf(CAUSES),
      },
      { required: ["at", "parameter", "from", "to", "cause"] },
    );
  const forTimeout = byParameter({ min: 300, max: 5000 });
  const forBand = new Map(
    FLOOR_BANDS.map((b) => [FLOOR_PARAMETER(b), byParameter(FLOOR_RANGES[b])]),
  );
  return ((value, path, issues) => {
    const parameter = (value as { parameter?: unknown } | null)?.parameter;
    const inner = (typeof parameter === "string" && forBand.get(parameter as never)) || forTimeout;
    return inner(value, path, issues);
  }) as V<NonNullable<TuningDocument["history"]>[number]>;
}

function tuningValidator(version: unknown): V<TuningDocument & { version: 1 | 2 }> {
  const floors = version === 2;
  const floorsField: V<unknown> = floors
    ? turnFloorsValidator()
    : (_value, path, issues) => {
        issues.push({ path, message: "unknown key" });
        return undefined;
      };
  return object(
    {
      version: integer({ min: 1, max: 2 }),
      off: boolean(),
      timeoutMs: object({ value: timeout, base: timeout }, { required: ["value", "base"] }),
      pending: object(
        { from: timeout, to: timeout, at, before: beforeValidator() },
        { required: ["from", "to", "at", "before"] },
      ),
      block: object({ value: timeout, at }, { required: ["value", "at"] }),
      turnFloors: floorsField,
      history: array(entryValidator(floors), { max: HISTORY_MAX }),
      seenAt: at,
    },
    { required: ["version"] },
  ) as V<TuningDocument & { version: 1 | 2 }>;
}

function versionOf(doc: unknown): unknown {
  return typeof doc === "object" && doc !== null
    ? (doc as { version?: unknown }).version
    : undefined;
}

/** Validates a candidate tuning.json document (including `version`). */
export function validateTuning(doc: unknown): Issue[] {
  const issues: Issue[] = [];
  tuningValidator(versionOf(doc))(doc, "", issues);
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
  const parsed = tuningValidator(versionOf(raw))(raw, "", issues);
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

function hasFloorData(doc: TuningDocument): boolean {
  return (
    doc.turnFloors !== undefined || (doc.history?.some((h) => h.parameter !== "timeoutMs") ?? false)
  );
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
  const { turnFloors, ...rest } = next;
  const kept = turnFloors && Object.keys(turnFloors).length > 0 ? { turnFloors } : {};
  const withoutVersion: TuningDocument = { ...rest, ...kept };
  const document = { version: hasFloorData(withoutVersion) ? 2 : 1, ...withoutVersion };
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
