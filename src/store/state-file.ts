import { chmodSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic.ts";
import { FEATURES, MODES, type Feature, type Mode } from "./defaults.ts";
import {
  boolean,
  integer,
  object,
  oneOf,
  refine,
  string,
  type Issue,
  type V,
  type WriteResult,
} from "./validate.ts";

export type State = {
  switches?: Partial<Record<Feature, boolean>>;
  mode?: Mode;
  cliReview?: { cli: "codex" | "opencode"; model?: string; effort?: string };
};

export type StateRead =
  | { kind: "ok"; state: State }
  | { kind: "missing"; state: {} }
  | { kind: "malformed"; state: {}; issues: Issue[] }
  | { kind: "unreadable"; state: {}; issues: Issue[] };

const notDefault = (text: string): boolean => text !== "default";
const NOT_DEFAULT_MESSAGE = "expected a value other than default (omit the field instead)";

const cliModel = refine(
  string({ pattern: /^[A-Za-z0-9._][A-Za-z0-9._:/-]{0,127}$/ }),
  notDefault,
  NOT_DEFAULT_MESSAGE,
);

const cliEffort = refine(
  string({ pattern: /^[A-Za-z0-9._-]{1,64}$/ }),
  notDefault,
  NOT_DEFAULT_MESSAGE,
);

const cliReviewValidator = object(
  {
    cli: oneOf(["codex", "opencode"] as const),
    model: cliModel,
    effort: cliEffort,
  },
  { required: ["cli"] },
);

/** Validates a candidate cliReview object; issue paths are prefixed `cliReview`. */
export function validateCliReview(candidate: unknown): Issue[] {
  const issues: Issue[] = [];
  cliReviewValidator(candidate, "cliReview", issues);
  return issues;
}

function stateValidator(): V<State & { version: 1 }> {
  return object(
    {
      version: integer({ min: 1, max: 1 }),
      switches: object(Object.fromEntries(FEATURES.map((f) => [f, boolean()]))),
      mode: oneOf(MODES),
      cliReview: cliReviewValidator,
    },
    { required: ["version"] },
  ) as V<State & { version: 1 }>;
}

function parseState(text: string): { state: State } | { issues: Issue[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { issues: [{ path: "", message: "state.json is not valid JSON" }] };
  }
  const issues: Issue[] = [];
  const parsed = stateValidator()(raw, "", issues);
  if (issues.length > 0 || parsed === undefined) return { issues };
  const { version: _version, ...state } = parsed;
  return { state };
}

export function readState(dir: string): StateRead {
  let text: string;
  try {
    text = readFileSync(join(dir, "state.json"), "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "EIO";
    if (code === "ENOENT") return { kind: "missing", state: {} };
    return {
      kind: "unreadable",
      state: {},
      issues: [{ path: "", message: `cannot read state.json (${code})` }],
    };
  }
  const result = parseState(text);
  if ("issues" in result) return { kind: "malformed", state: {}, issues: result.issues };
  return { kind: "ok", state: result.state };
}

/** Reads, mutates, validates and atomically writes state.json. Never throws. */
export function updateState(dir: string, mutate: (s: State) => State): WriteResult {
  const read = readState(dir);
  if (read.kind === "unreadable") return { ok: false, issues: read.issues };
  let next: State;
  try {
    next = mutate(read.kind === "ok" ? read.state : {});
  } catch {
    return { ok: false, issues: [{ path: "", message: "update failed" }] };
  }
  const document = { version: 1, ...next };
  const issues: Issue[] = [];
  stateValidator()(document, "", issues);
  if (issues.length > 0) return { ok: false, issues };
  if (read.kind === "malformed") {
    const file = join(dir, "state.json");
    const bad = join(dir, "state.json.bad");
    try {
      renameSync(file, bad);
      chmodSync(bad, 0o600);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "EIO";
      return {
        ok: false,
        issues: [{ path: "", message: `cannot move state.json aside (${code})` }],
      };
    }
  }
  const written = writeFileAtomic(dir, "state.json", JSON.stringify(document, null, 2) + "\n");
  if (!written.ok) {
    return {
      ok: false,
      issues: [{ path: "", message: `cannot write state.json (${written.code})` }],
    };
  }
  return { ok: true };
}

export function resetState(dir: string): WriteResult {
  return updateState(dir, () => ({}));
}
