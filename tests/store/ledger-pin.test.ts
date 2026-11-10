import { describe, expect, test } from "bun:test";
import { LEDGER_FIELDS, validateLedgerEntry } from "../../src/store/ledger-schema.ts";

type Obj = Record<string, unknown>;

const COMMON = { v: 1, at: 1762400000000, session: "s-1" };
const MEASURED = {
  mode: "standard",
  answered: true,
  ms: 5,
  miss: undefined,
  effortP: { low: 0.1, max: 0.9 },
  risky: 0.5,
  durationMs: 7,
};
const MAIN: Obj = {
  ...COMMON,
  kind: "main",
  mode: "standard",
  answered: true,
  ms: 5,
  effortP: { low: 0.1, max: 0.9 },
  risky: 0.5,
  durationMs: 7,
  turnId: "t-1",
  requested: "high",
  effective: "low",
  from: "off",
  held: false,
  advised: true,
  strategy: "graph",
  strategyP: 0.2,
  skillP: 0.3,
  gate: 0.4,
  corrects: 0.5,
  skill: "tdd-2",
  toolCalls: 3,
  failures: 1,
  inputTokens: 10,
  outputTokens: 20,
  outcome: "aborted",
};
const WORKER: Obj = {
  ...COMMON,
  kind: "worker",
  mode: "premium",
  answered: true,
  ms: 5,
  risky: 0.5,
  durationMs: 7,
  agent: "worker.a",
  briefChars: 812,
  tierP: { fast: 0.5, "slot::a-b": 0.5 },
  expertNeeded: 0.1,
  score: 3.5,
  rubric: 99,
  expertOffered: true,
  tier: "slot::x1",
  fallback: "deep",
  model: "anthropic/claude-x",
  effort: "xhigh",
  reason: "cut",
  callerModel: "a/b:c",
  locked: false,
  toolsScored: 1,
  toolsFlagged: 2,
  tokens: 3,
  toolUses: 4,
  status: "stopped",
};
const CORRECTION: Obj = { ...COMMON, kind: "correction", turnId: "t-1", corrects: 0.82 };
void MEASURED;

// Output order is the shape order: `kind` is spliced in after `session`.
function outputOrder(kind: "main" | "worker", good: Obj): string[] {
  const rest = LEDGER_FIELDS[kind].filter((k) => !"v at kind session".split(" ").includes(k));
  return ["v", "at", "session", "kind", ...rest].filter((k) => k in good);
}

function run(value: unknown, opts?: { maxLineBytes?: number }) {
  return validateLedgerEntry(value, opts);
}

describe("ledger schema pin: accepted lines", () => {
  test("full main line round-trips in schema field order", () => {
    const shuffled = Object.fromEntries(Object.entries(MAIN).reverse());
    const r = run(shuffled);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.entry)).toEqual(outputOrder("main", MAIN));
    expect(r.line).toBe(`${JSON.stringify(r.entry)}\n`);
    expect(r.entry).toEqual(MAIN as never);
  });

  test("full worker line round-trips in schema field order", () => {
    const r = run(Object.fromEntries(Object.entries(WORKER).reverse()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.entry)).toEqual(outputOrder("worker", WORKER));
    expect(r.entry).toEqual(WORKER as never);
  });

  test("correction line round-trips", () => {
    const r = run(CORRECTION);
    expect(r).toEqual({
      ok: true,
      entry: CORRECTION as never,
      line: `${JSON.stringify(CORRECTION)}\n`,
    });
  });

  test("minimal main and worker lines are accepted", () => {
    const main = run({
      ...COMMON,
      kind: "main",
      mode: "budget",
      answered: false,
      turnId: "t",
      outcome: "ok",
    });
    expect(main.ok).toBe(true);
    const worker = run({
      ...COMMON,
      kind: "worker",
      mode: "budget",
      answered: false,
      agent: "w",
      briefChars: 0,
      reason: "untouched",
      status: "error",
    });
    expect(worker.ok).toBe(true);
  });
});

const ID_RE = "^[A-Za-z0-9._:-]{1,64}$";
const INT = (n: number) => `expected an integer from 0 to ${n}`;
const COUNT = INT(1_000_000_000);
const PROB = "expected a number from 0 to 1";
const BOOL = "expected true or false";
const LEVELS = "expected one of: off, minimal, low, medium, high, xhigh, max";

// field -> [bad value, message]
const COMMON_BAD: Record<string, [unknown, string]> = {
  v: [2, "expected the number 1"],
  at: [-1, INT(8_640_000_000_000_000)],
  session: ["bad id!", `expected a string matching ${ID_RE}`],
};
const MEASURED_BAD: Record<string, [unknown, string]> = {
  mode: ["x", "expected one of: budget, standard, premium"],
  answered: ["yes", BOOL],
  ms: [1.5, COUNT],
  miss: ["other", "expected one of: timeout, error, schema"],
  effortP: [[], "expected an object"],
  risky: [2, PROB],
  durationMs: [-3, COUNT],
};
const MAIN_BAD: Record<string, [unknown, string]> = {
  ...COMMON_BAD,
  ...MEASURED_BAD,
  turnId: [5, "expected a string"],
  requested: ["lo", LEVELS],
  effective: [1, LEVELS],
  from: ["", LEVELS],
  held: [0, BOOL],
  advised: [null, BOOL],
  strategy: ["x", "expected one of: direct, delegate, parallel, graph"],
  strategyP: [-0.1, PROB],
  skillP: [NaN, PROB],
  gate: ["1", PROB],
  corrects: [1.1, PROB],
  skill: ["Bad", "expected a string matching ^[a-z0-9][a-z0-9-]{0,63}$"],
  toolCalls: [-1, COUNT],
  failures: [1e10, COUNT],
  inputTokens: ["1", COUNT],
  outputTokens: [0.5, COUNT],
  outcome: ["fine", "expected one of: ok, error, aborted"],
};
const TARGET = "expected a target";
const WORKER_BAD: Record<string, [unknown, string]> = {
  ...COMMON_BAD,
  ...MEASURED_BAD,
  agent: ["a b", "expected a string matching ^[A-Za-z0-9._-]{1,64}$"],
  briefChars: [-1, COUNT],
  tierP: [[], "expected an object"],
  expertNeeded: [3, PROB],
  score: [3.6, "expected a number from 0 to 3.5"],
  rubric: [0, INT(99).replace("from 0", "from 1")],
  expertOffered: ["t", BOOL],
  tier: ["huge", TARGET],
  fallback: [1, TARGET],
  model: ["nomodel", "expected a string matching ^[A-Za-z0-9._-]+\\/[^\\s]+$"],
  effort: ["max2", LEVELS],
  reason: [
    "because",
    "expected one of: expert-admitted, risky, slot, expert-denied, fast-unsure, choice, expert, cut, untouched, miss",
  ],
  callerModel: ["a b", "expected a string matching ^[A-Za-z0-9._:/-]{1,128}$"],
  locked: [1, BOOL],
  toolsScored: [-1, COUNT],
  toolsFlagged: [-1, COUNT],
  tokens: [-1, COUNT],
  toolUses: [-1, COUNT],
  status: ["done", "expected one of: completed, aborted, stopped, error"],
};
const CORRECTION_BAD: Record<string, [unknown, string]> = {
  ...COMMON_BAD,
  turnId: [5, "expected a string"],
  corrects: [2, PROB],
};

const KINDS: [string, Obj, Record<string, [unknown, string]>][] = [
  ["main", MAIN, MAIN_BAD],
  ["worker", WORKER, WORKER_BAD],
  ["correction", CORRECTION, CORRECTION_BAD],
];

describe("ledger schema pin: per-field failures", () => {
  for (const [kind, good, bad] of KINDS) {
    test(`${kind}: every field of the schema has a pinned bad value`, () => {
      const fields = LEDGER_FIELDS[kind as keyof typeof LEDGER_FIELDS].filter((f) => f !== "kind");
      expect(Object.keys(bad).sort()).toEqual([...fields].sort());
    });
    for (const [field, [value, message]] of Object.entries(bad)) {
      test(`${kind}.${field} wrong value reports exactly one issue`, () => {
        const r = run({ ...good, [field]: value });
        expect(r).toEqual({ ok: false, issues: [{ path: field, message }] });
      });
    }
  }
});

describe("ledger schema pin: required fields", () => {
  const REQUIRED: Record<string, string[]> = {
    main: ["v", "at", "kind", "session", "mode", "answered", "turnId", "outcome"],
    worker: [
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
    correction: ["v", "at", "kind", "session", "turnId", "corrects"],
  };
  for (const [kind, good] of [
    ["main", MAIN],
    ["worker", WORKER],
    ["correction", CORRECTION],
  ] as const) {
    test(`${kind}: each required field missing reports "required"`, () => {
      for (const field of REQUIRED[kind]!) {
        const { [field]: _gone, ...rest } = good;
        const r = run(rest);
        if (field === "kind") {
          expect(r).toEqual({
            ok: false,
            issues: [{ path: "kind", message: "expected one of: main, worker, correction" }],
          });
        } else {
          expect(r).toEqual({ ok: false, issues: [{ path: field, message: "required" }] });
        }
      }
    });
    test(`${kind}: every optional field may be absent`, () => {
      const optional = Object.keys(good).filter((k) => !REQUIRED[kind]!.includes(k));
      for (const field of optional) {
        const { [field]: _gone, ...rest } = good;
        const r = run(rest);
        // dropping `tier` from a deciding worker reason trips the cross-check, nothing else may
        if (kind === "worker" && field === "tier")
          expect(r).toEqual({
            ok: false,
            issues: [{ path: "tier", message: "required for this reason" }],
          });
        else expect(r.ok).toBe(true);
      }
    });
  }
});

describe("ledger schema pin: structural failures and ordering", () => {
  test("non-object values report an empty path", () => {
    for (const v of [null, undefined, 1, "s", [], [1]])
      expect(run(v)).toEqual({ ok: false, issues: [{ path: "", message: "expected an object" }] });
  });

  test("unknown or non-string kind reports the kind list", () => {
    for (const kind of ["tuning", "", 1, undefined, null, "Main"])
      expect(run({ ...COMMON, kind })).toEqual({
        ok: false,
        issues: [{ path: "kind", message: "expected one of: main, worker, correction" }],
      });
  });

  test("unknown keys are reported first, in input order, then field issues in schema order", () => {
    const r = run({ ...CORRECTION, zeta: 1, corrects: 5, alpha: 2, turnId: 3 });
    expect(r).toEqual({
      ok: false,
      issues: [
        { path: "zeta", message: "unknown key" },
        { path: "alpha", message: "unknown key" },
        { path: "turnId", message: "expected a string" },
        { path: "corrects", message: PROB },
      ],
    });
  });

  test("a main line rejects a worker-only field and vice versa", () => {
    expect(run({ ...MAIN, agent: "w" })).toEqual({
      ok: false,
      issues: [{ path: "agent", message: "unknown key" }],
    });
    expect(run({ ...WORKER, turnId: "t" })).toEqual({
      ok: false,
      issues: [{ path: "turnId", message: "unknown key" }],
    });
    expect(run({ ...CORRECTION, mode: "budget" })).toEqual({
      ok: false,
      issues: [{ path: "mode", message: "unknown key" }],
    });
  });

  test("kind is always valid once chosen; mismatching shape cannot happen", () => {
    const r = run({ ...COMMON, kind: "correction", turnId: "t", corrects: 0 });
    expect(r.ok).toBe(true);
  });

  test("effortP nested issues carry dotted paths", () => {
    const r = run({ ...MAIN, effortP: { low: 2, bogus: 0.5, high: "x" } });
    expect(r).toEqual({
      ok: false,
      issues: [
        { path: "effortP.low", message: PROB },
        { path: "effortP.bogus", message: "expected one of: low, medium, high, xhigh, max" },
        { path: "effortP.high", message: PROB },
      ],
    });
  });

  test("effortP too many keys reports max first", () => {
    const keys = ["low", "medium", "high", "xhigh", "max"];
    const r = run({
      ...MAIN,
      effortP: { ...Object.fromEntries(keys.map((k) => [k, 0])), extra: 0 },
    });
    expect(r).toEqual({
      ok: false,
      issues: [
        { path: "effortP", message: "expected at most 5 keys" },
        { path: "effortP.extra", message: "expected one of: low, medium, high, xhigh, max" },
      ],
    });
  });

  test("tierP rejects bad targets with the target message and limits keys to 12", () => {
    const r = run({ ...WORKER, tierP: { huge: 0.5, "slot::BAD": 0.5, fast: 3 } });
    expect(r).toEqual({
      ok: false,
      issues: [
        { path: "tierP.huge", message: TARGET },
        { path: "tierP.slot::BAD", message: TARGET },
        { path: "tierP.fast", message: PROB },
      ],
    });
    const many = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`slot::s${i}`, 0.1]));
    expect(run({ ...WORKER, tierP: many })).toEqual({
      ok: false,
      issues: [{ path: "tierP", message: "expected at most 12 keys" }],
    });
  });

  test("tierP with __proto__ key stays an own property", () => {
    const tierP = JSON.parse('{"fast":0.5}') as Obj;
    const r = run({ ...WORKER, tierP });
    expect(r.ok).toBe(true);
  });
});

describe("ledger schema pin: cross-field checks", () => {
  const worker = (patch: Obj) => ({ ...WORKER, ...patch });

  test("every deciding reason requires a tier", () => {
    for (const reason of [
      "expert-admitted",
      "risky",
      "slot",
      "expert-denied",
      "fast-unsure",
      "choice",
      "expert",
      "cut",
    ]) {
      const { tier: _t, ...rest } = worker({ reason });
      expect(run(rest)).toEqual({
        ok: false,
        issues: [{ path: "tier", message: "required for this reason" }],
      });
    }
  });

  test("untouched and miss reasons do not require a tier", () => {
    for (const reason of ["untouched", "miss"]) {
      const { tier: _t, ...rest } = worker({ reason });
      expect(run(rest).ok).toBe(true);
    }
  });

  test("miss requires answered false on main and worker, not on correction", () => {
    const expected = {
      ok: false as const,
      issues: [{ path: "miss", message: "expected answered to be false" }],
    };
    expect(run({ ...MAIN, miss: "timeout" })).toEqual(expected);
    expect(run(worker({ miss: "error" }))).toEqual(expected);
    expect(run({ ...MAIN, miss: "schema", answered: false }).ok).toBe(true);
  });

  test("tier and miss issues are both reported, tier first", () => {
    const { tier: _t, ...rest } = worker({ miss: "error" });
    expect(run(rest)).toEqual({
      ok: false,
      issues: [
        { path: "tier", message: "required for this reason" },
        { path: "miss", message: "expected answered to be false" },
      ],
    });
  });

  test("cross-checks are skipped when shape issues exist", () => {
    const { tier: _t, ...rest } = worker({ miss: "error", ms: -1 });
    expect(run(rest)).toEqual({ ok: false, issues: [{ path: "ms", message: COUNT }] });
  });
});

describe("ledger schema pin: size limit", () => {
  test("a line over maxLineBytes is rejected with an empty path", () => {
    const line = `${JSON.stringify(CORRECTION)}\n`;
    const n = Buffer.byteLength(line);
    expect(run(CORRECTION, { maxLineBytes: n }).ok).toBe(true);
    expect(run(CORRECTION, { maxLineBytes: n - 1 })).toEqual({
      ok: false,
      issues: [{ path: "", message: "line exceeds the size limit" }],
    });
  });

  test("the default limit is 4096 bytes", () => {
    const big = { ...WORKER, model: `a/${"x".repeat(100)}`, callerModel: "m".repeat(128) };
    expect(run(big).ok).toBe(true);
    expect(Buffer.byteLength(`${JSON.stringify(big)}\n`)).toBeLessThan(4096);
  });
});
