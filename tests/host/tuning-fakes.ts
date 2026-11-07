// Shared fakes for the tuning host tests.
import { buildSnapshot, type Snapshot } from "../../src/host/readiness.ts";
import type { TuningDeps, UiCtx } from "../../src/host/tuning-deps.ts";
import type { LedgerRead } from "../../src/store/ledger.ts";
import type { MainEntry } from "../../src/store/ledger-schema.ts";
import type { TuningDocument, TuningRead } from "../../src/store/tuning-file.ts";
import type { Issue, WriteResult } from "../../src/store/validate.ts";

export type Notify = [message: string, level: string | undefined];

export type FakeOptions = {
  /** Record in the snapshot handed to `load`. */
  record?: TuningDocument;
  /** Record in the fake store; defaults to a copy of `record`. */
  stored?: TuningDocument;
  configTimeoutMs?: number;
  configValid?: boolean;
  tuningKind?: TuningRead["kind"];
  /** Issues for a `malformed` or `unreadable` read; defaults to one message naming the kind. */
  tuningIssues?: Issue[];
  /** `load` reflects the fake store instead of the fixed `record`. */
  loadFromStore?: boolean;
  ledger?: LedgerRead | readonly MainEntry[] | "throw";
  /** `{ok:false}` refuses the write without calling `mutate`; a function replaces the stored record first. */
  update?: WriteResult | ((stored: TuningDocument) => TuningDocument);
  now?: number;
};

export type FakeDeps = TuningDeps & {
  /** Current fake store. */
  stored: () => TuningDocument;
  /** Number of `updateTuning` calls. */
  updates: () => number;
  /** Number of `readLedger` calls. */
  ledgerReads: () => number;
  /** What the last `mutate` returned. */
  lastResult: () => TuningDocument | undefined;
};

const invalidIssues: Issue[] = [{ path: "", message: "bad config" }];

function snapshotOf(o: FakeOptions, record: TuningDocument): Snapshot {
  const config =
    o.configTimeoutMs === undefined ? {} : { classifier: { timeoutMs: o.configTimeoutMs } };
  const kind = o.tuningKind ?? "ok";
  const tuningRead = (
    kind === "ok"
      ? { kind, record }
      : kind === "missing"
        ? { kind, record: {} }
        : { kind, record: {}, issues: o.tuningIssues ?? [{ path: "", message: kind }] }
  ) as TuningRead;
  return buildSnapshot({
    configRead:
      o.configValid === false
        ? { kind: "invalid", issues: invalidIssues }
        : { kind: "ok", present: true, config },
    stateRead: { kind: "missing", state: {} },
    tuningRead,
    env: {},
    toolNames: [],
  });
}

function ledgerOf(o: FakeOptions): LedgerRead {
  const l = o.ledger ?? [];
  if (l === "throw") throw new Error("ledger exploded");
  return Array.isArray(l) ? { kind: "ok", entries: [...l], skipped: 0 } : (l as LedgerRead);
}

export function fakeDeps(o: FakeOptions = {}): FakeDeps {
  const record = o.record ?? {};
  let store: TuningDocument = structuredClone(o.stored ?? record);
  let updates = 0;
  let ledgerReads = 0;
  let last: TuningDocument | undefined;
  return {
    dir: "/fake/jev",
    now: () => o.now ?? 5000,
    load: () => snapshotOf(o, o.loadFromStore ? store : record),
    readLedger: () => {
      ledgerReads++;
      return ledgerOf(o);
    },
    updateTuning: (_dir, mutate) => {
      updates++;
      if (typeof o.update === "object" && !o.update.ok) return o.update;
      if (typeof o.update === "function") store = o.update(store);
      last = mutate(store);
      store = last;
      return { ok: true };
    },
    stored: () => store,
    updates: () => updates,
    ledgerReads: () => ledgerReads,
    lastResult: () => last,
  };
}

export type FakeCtx = UiCtx & { notifies: Notify[] };

export function fakeCtx(hasUI: boolean, throwing = false): FakeCtx {
  const notifies: Notify[] = [];
  const ui = {
    notify: (message: string, level?: string) => {
      notifies.push([message, level]);
      if (throwing) throw new Error("notify exploded");
    },
  };
  return { hasUI, ui, notifies } as unknown as FakeCtx;
}

function main(at: number, answered: boolean, timeout: boolean): MainEntry {
  return {
    v: 1,
    at,
    kind: "main",
    session: "s-1",
    turnId: `t-${at}`,
    mode: "standard",
    answered,
    ...(answered ? { ms: 1000 } : timeout ? { miss: "timeout" as const } : {}),
    outcome: "ok",
  };
}

/** 40 main lines from `from`: 10 timeouts, 30 answered. Fires the rule. */
export function firing(from = 1): MainEntry[] {
  return Array.from({ length: 40 }, (_, i) => main(from + i, i >= 10, i < 10));
}

/** `count` answered main lines from `from`. */
export function quiet(count = 10, from = 1): MainEntry[] {
  return Array.from({ length: count }, (_, i) => main(from + i, true, false));
}
