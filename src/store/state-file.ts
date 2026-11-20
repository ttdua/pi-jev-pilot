import { chmodSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic.ts";
import { FEATURES, MODES, type Feature, type Mode } from "./defaults.ts";
import {
  boolean,
  integer,
  object,
  oneOf,
  type Issue,
  type V,
  type WriteResult,
} from "./validate.ts";

export type State = {
  switches?: Partial<Record<Feature, boolean>>;
  mode?: Mode;
};

export type StateRead =
  | { kind: "ok"; state: State }
  | { kind: "missing"; state: {} }
  | { kind: "malformed"; state: {}; issues: Issue[] }
  | { kind: "unreadable"; state: {}; issues: Issue[] };

/** DEPRECATED(remove next minor): a retired field is accepted with any value and left out of the parsed state. */
const retiredField: V<undefined> = () => undefined;

function stateValidator(): V<State & { version: 1 }> {
  return object(
    {
      version: integer({ min: 1, max: 1 }),
      // `review` and `tools` are removed switches and `expert` is the old `frontier`: still accepted
      // on read, dropped or moved by parseState.
      switches: object(
        Object.fromEntries([...FEATURES, "review", "tools", "expert"].map((f) => [f, boolean()])),
      ),
      mode: oneOf(MODES),
      cliReview: retiredField,
      cliReviewEnabled: retiredField,
    },
    { required: ["version"] },
  ) as V<State & { version: 1 }>;
}

/**
 * Removes the retired `review` and `tools` switches, moves the legacy `expert` onto `frontier`
 * (`frontier` wins when both are set), and drops `switches` itself when nothing is left.
 */
function dropLegacySwitches(state: State): State {
  if (state.switches === undefined) return state;
  const {
    review: _review,
    tools: _tools,
    expert, // DEPRECATED(remove next minor)
    ...rest
  } = state.switches as Record<string, boolean>;
  if (expert !== undefined && rest.frontier === undefined) rest.frontier = expert;
  const { switches: _switches, ...others } = state;
  return Object.keys(rest).length === 0 ? others : { ...others, switches: rest };
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
  return { state: dropLegacySwitches(state) };
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

/** The raw object of a valid state.json; `undefined` when the file is missing, unreadable or not valid. */
function validRawState(dir: string): Record<string, unknown> | undefined {
  let text: string;
  try {
    text = readFileSync(join(dir, "state.json"), "utf8");
  } catch {
    return undefined;
  }
  if (!("state" in parseState(text))) return undefined;
  return JSON.parse(text) as Record<string, unknown>;
}

// DEPRECATED(remove next minor)
/**
 * Rewrites a valid state.json that still holds `switches.expert` (the read moves it onto
 * `frontier`, the write drops it); `false` when there is nothing to do or the file is not valid.
 */
export function migrateLegacySwitch(dir: string): boolean {
  const raw = validRawState(dir);
  const switches = raw?.switches as Record<string, unknown> | undefined;
  if (switches === undefined || !Object.hasOwn(switches, "expert")) return false;
  return updateState(dir, (state) => state).ok;
}

// DEPRECATED(remove next minor)
/**
 * Rewrites a valid state.json that still holds `cliReview` or `cliReviewEnabled`, which the read
 * drops and the write omits; `false` when there is nothing to do or the file is not valid.
 */
export function migrateRetiredStateFields(dir: string): boolean {
  const raw = validRawState(dir);
  if (raw === undefined) return false;
  if (!Object.hasOwn(raw, "cliReview") && !Object.hasOwn(raw, "cliReviewEnabled")) return false;
  return updateState(dir, (state) => state).ok;
}

export function resetState(dir: string): WriteResult {
  return updateState(dir, () => ({}));
}
