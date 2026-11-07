// Ledger line schema. Pure validation, no I/O.
import { MODES, TIERS, type Mode } from "./defaults.ts";
import {
  boolean,
  integer,
  joinPath,
  object,
  oneOf,
  string,
  type Issue,
  type V,
} from "./validate.ts";

export type LedgerKind = "main" | "worker" | "correction";

export type Level = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";
export type Miss = "timeout" | "error" | "schema";
export type Strategy = "direct" | "delegate" | "parallel" | "graph";
export type WorkerReason =
  | "expert-admitted"
  | "risky"
  | "slot"
  | "expert-denied"
  | "fast-unsure"
  | "choice"
  | "untouched"
  | "miss";

type Common = {
  v: 1;
  at: number;
  session: string;
};

type Measured = {
  mode: Mode;
  answered: boolean;
  ms?: number;
  miss?: Miss;
  effortP?: Partial<Record<EffortLevel, number>>;
  risky?: number;
  durationMs?: number;
};

export type MainEntry = Common &
  Measured & {
    kind: "main";
    turnId: string;
    requested?: Level;
    effective?: Level;
    from?: Level;
    held?: boolean;
    advised?: boolean;
    strategy?: Strategy;
    strategyP?: number;
    skillP?: number;
    gate?: number;
    corrects?: number;
    skill?: string;
    toolCalls?: number;
    failures?: number;
    inputTokens?: number;
    outputTokens?: number;
    outcome: "ok" | "error" | "aborted";
  };

export type WorkerEntry = Common &
  Measured & {
    kind: "worker";
    agent: string;
    briefChars: number;
    tierP?: Record<string, number>;
    expertNeeded?: number;
    tier?: string;
    fallback?: string;
    model?: string;
    effort?: Level;
    reason: WorkerReason;
    callerModel?: string;
    locked?: boolean;
    toolsScored?: number;
    toolsFlagged?: number;
    tokens?: number;
    toolUses?: number;
    status: "completed" | "aborted" | "stopped" | "error";
  };

export type CorrectionEntry = Common & {
  kind: "correction";
  turnId: string;
  corrects: number;
};

export type LedgerEntry = MainEntry | WorkerEntry | CorrectionEntry;

const COMMON = ["v", "at", "kind", "session"] as const;
const MEASURED = ["mode", "answered", "ms", "miss", "effortP", "risky", "durationMs"] as const;

export const LEDGER_FIELDS: Readonly<Record<LedgerKind, readonly string[]>> = {
  main: [
    ...COMMON,
    ...MEASURED,
    "turnId",
    "requested",
    "effective",
    "from",
    "held",
    "advised",
    "strategy",
    "strategyP",
    "skillP",
    "gate",
    "corrects",
    "skill",
    "toolCalls",
    "failures",
    "inputTokens",
    "outputTokens",
    "outcome",
  ],
  worker: [
    ...COMMON,
    ...MEASURED,
    "agent",
    "briefChars",
    "tierP",
    "expertNeeded",
    "tier",
    "fallback",
    "model",
    "effort",
    "reason",
    "callerModel",
    "locked",
    "toolsScored",
    "toolsFlagged",
    "tokens",
    "toolUses",
    "status",
  ],
  correction: [...COMMON, "turnId", "corrects"],
};

export const LEDGER_MAX_LINE_BYTES = 4096;

export type LedgerValidation =
  | { ok: true; entry: LedgerEntry; line: string }
  | { ok: false; issues: Issue[] };

const ID = /^[A-Za-z0-9._:-]{1,64}$/;
const AGENT = /^[A-Za-z0-9._-]{1,64}$/;
const SKILL = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MODEL = /^[A-Za-z0-9._-]+\/[^\s]+$/;
const CALLER_MODEL = /^[A-Za-z0-9._:/-]{1,128}$/;
const SLOT = /^slot::[a-z][a-z0-9-]{0,23}$/;

const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
const DECIDING_REASONS: readonly string[] = [
  "expert-admitted",
  "risky",
  "slot",
  "expert-denied",
  "fast-unsure",
  "choice",
];
const MAX_TARGETS = 12;

function fail(issues: Issue[], path: string, message: string): undefined {
  issues.push({ path, message });
  return undefined;
}

function probability(): V<number> {
  return (value, path, issues) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
      ? value
      : fail(issues, path, "expected a number from 0 to 1");
}

function target(): V<string> {
  const named = oneOf<string>(TIERS);
  return (value, path, issues) => {
    if (typeof value === "string" && SLOT.test(value)) return value;
    const before = issues.length;
    named(value, path, issues);
    if (issues.length !== before) {
      issues.length = before;
      return fail(issues, path, "expected a target");
    }
    return value as string;
  };
}

function record(keys: V<string>, value: V<number>, max: number): V<Record<string, number>> {
  return (raw, path, issues) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      return fail(issues, path, "expected an object");
    const src = raw as Record<string, unknown>;
    const names = Object.keys(src);
    const before = issues.length;
    if (names.length > max) fail(issues, path, `expected at most ${max} keys`);
    const out: Record<string, number> = {};
    for (const key of names) {
      const p = joinPath(path, key);
      const k = keys(key, p, issues);
      const v = value(src[key], p, issues);
      if (k === undefined || v === undefined) continue;
      Object.defineProperty(out, k, {
        value: v,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return issues.length === before ? out : undefined;
  };
}

const count = (): V<number> => integer({ min: 0, max: 1_000_000_000 });
const level = (): V<(typeof LEVELS)[number]> => oneOf(LEVELS);

const versionOne: V<1> = (value, path, issues) =>
  value === 1 ? 1 : fail(issues, path, "expected the number 1");

const commonShape = {
  v: versionOne,
  at: integer({ min: 0, max: 8_640_000_000_000_000 }),
  session: string({ pattern: ID }),
};

const measuredShape = {
  mode: oneOf(MODES),
  answered: boolean(),
  ms: count(),
  miss: oneOf(["timeout", "error", "schema"] as const),
  effortP: record(oneOf(EFFORT_LEVELS), probability(), EFFORT_LEVELS.length),
  risky: probability(),
  durationMs: count(),
};

function shapeFor(kind: LedgerKind) {
  const head = { ...commonShape, kind: oneOf([kind] as const) };
  if (kind === "main")
    return object(
      {
        ...head,
        ...measuredShape,
        turnId: string({ pattern: ID }),
        requested: level(),
        effective: level(),
        from: level(),
        held: boolean(),
        advised: boolean(),
        strategy: oneOf(["direct", "delegate", "parallel", "graph"] as const),
        strategyP: probability(),
        skillP: probability(),
        gate: probability(),
        corrects: probability(),
        skill: string({ pattern: SKILL }),
        toolCalls: count(),
        failures: count(),
        inputTokens: count(),
        outputTokens: count(),
        outcome: oneOf(["ok", "error", "aborted"] as const),
      },
      { required: ["v", "at", "kind", "session", "mode", "answered", "turnId", "outcome"] },
    );
  if (kind === "worker")
    return object(
      {
        ...head,
        ...measuredShape,
        agent: string({ pattern: AGENT }),
        briefChars: count(),
        tierP: record(target(), probability(), MAX_TARGETS),
        expertNeeded: probability(),
        tier: target(),
        fallback: target(),
        model: string({ pattern: MODEL, max: 128 }),
        effort: level(),
        reason: oneOf([...DECIDING_REASONS, "untouched", "miss"] as const),
        callerModel: string({ pattern: CALLER_MODEL }),
        locked: boolean(),
        toolsScored: count(),
        toolsFlagged: count(),
        tokens: count(),
        toolUses: count(),
        status: oneOf(["completed", "aborted", "stopped", "error"] as const),
      },
      {
        required: [
          "v",
          "at",
          "kind",
          "session",
          "mode",
          "answered",
          "agent",
          "briefChars",
          "reason",
          "status",
        ],
      },
    );
  return object(
    { ...head, turnId: string({ pattern: ID }), corrects: probability() },
    { required: ["v", "at", "kind", "session", "turnId", "corrects"] },
  );
}

export function validateLedgerEntry(
  value: unknown,
  opts?: { maxLineBytes?: number },
): LedgerValidation {
  const issues: Issue[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, issues: [{ path: "", message: "expected an object" }] };
  }
  const kind = (value as Record<string, unknown>)["kind"];
  if (kind !== "main" && kind !== "worker" && kind !== "correction") {
    return {
      ok: false,
      issues: [{ path: "kind", message: "expected one of: main, worker, correction" }],
    };
  }
  const out = shapeFor(kind)(value, "", issues) as Record<string, unknown> | undefined;
  if (out === undefined) return { ok: false, issues };
  if (
    kind === "worker" &&
    DECIDING_REASONS.includes(out["reason"] as string) &&
    out["tier"] === undefined
  )
    issues.push({ path: "tier", message: "required for this reason" });
  if (kind !== "correction" && out["miss"] !== undefined && out["answered"] !== false)
    issues.push({ path: "miss", message: "expected answered to be false" });
  if (issues.length > 0) return { ok: false, issues };
  const line = `${JSON.stringify(out)}\n`;
  if (Buffer.byteLength(line) > (opts?.maxLineBytes ?? LEDGER_MAX_LINE_BYTES))
    return { ok: false, issues: [{ path: "", message: "line exceeds the size limit" }] };
  return { ok: true, entry: out as LedgerEntry, line };
}
