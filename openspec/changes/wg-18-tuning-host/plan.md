# Tuning Host Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md`.

**Goal:** Wire the merged tuning rules into the host. That covers the step at `agent_settled`, the tuned value in the settings snapshot, the change and session-start lines with `seenAt`, `/jev tune` with its subcommands, and the per-mode signals.

**Architecture:** Every unit has one responsibility (design D1):
- **Pure code.** `src/policy/tuning-signals.ts` computes the signals. `src/policy/tuning.ts` gains two `seenAt` helpers. `src/host/tuning-text.ts` builds every tuning string.
- **Side effects.** Three host modules share one `TuningDeps`. `tuning-step.ts` runs at settle, `tuning-seen.ts` runs at session start, and `tune-command.ts` handles `/jev tune`.
- **Snapshot.** `readiness.ts` reads `tuning.json` into the snapshot, so every reader of `timeoutMs` gets the tuned value with no change at its call site.
- **Wiring.** `setup.ts` calls the modules from the existing handlers. `commands.ts` delegates `tune` forms the way it delegates slot forms.

**Tech Stack:** TypeScript run by Pi, Bun test, oxlint, oxfmt. No new dependency.

**Order:** Plan tasks follow dependency order, not `tasks.md` numbering. Task 4 (texts, `issueLines`) and Task 5 (`untunedTimeout`) come before Task 6 (snapshot), because the snapshot needs both.

## Global Constraints

- **Boundaries.** `policy/` imports only itself and `shared/`. `store/` imports only itself and `shared/`. No Pi import outside `host/`. `bun run lint` enforces all three. `policy/` therefore declares its own mode list and cannot import `MODES`.
- **Surface.** No new Pi event handler, flag, shortcut, command or tool (spec `package-loading`).
- **Network.** Tuning makes no Jev or network call. Tests use loopback only and need no secrets.
- **Files.** Tuning never writes `config.json`, `state.json` or the ledger. It stores numbers, the cause enum, `off` and `seenAt` only.
- **Failures.** Every tuning failure is swallowed. It never changes the run, the ledger line, the status line or the thinking level.
- **Output.** `ctx.ui.notify` only when `ctx.hasUI`. Nothing is printed in print or JSON mode, and nothing is added to the session.
- **Texts.** `→` is U+2192 everywhere. Exact strings are in `specs/tuning-host` and `specs/tune-command`.
- **Window.** The signal window is the latest 200 decisions per mode.
- **Gate.** `bun run typecheck`, `bun run lint`, `bun run fmt:check` and `bun test` all pass.

## Review Focus

1. **The same settle seen twice, or two processes settling together.** The update recomputes, so no second change is added and no line is shown. Pinned in Task 7 as "second settle with same ledger is a no-op" and "Another process changed it first".
2. **A hand-edited `tuning.json` with a valid shape but a stale base**, because the config changed while Pi was closed. The report shows the untuned value and `undo` says there is nothing to undo. The next settle supersedes the value with one line. Pinned in Task 9 ("Stale tuned value") and Task 11 ("superseded at first settle after restart").
3. **A large ledger (2000 lines) on every settle.** Pinned in Task 7: "settle with 2000 ledger lines reads the ledger once and finishes within 1 s", using the real `readLedger` on a temp dir.
4. **Child sessions.** A worker's `agent_settled` and `session_start` must leave `tuning.json` byte-identical and notify nothing. Pinned in Task 10 (`setup.test.ts`).
5. **Signal lines with equal `at`.** At the 200-line cutoff, ordering by `at` and then by recursively key-sorted JSON keeps results independent of input order. Pinned in Task 3 under "Input order irrelevant": 201 lines share one `at` and differ only in `status`.

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `tuning.json` | modified | adds optional `seenAt: int` (0–8640000000000000); `version` stays `1`; all other keys unchanged | public (file format) |
| `TuningDocument` (`src/store/tuning-file.ts`) | modified | adds `seenAt?: number` | no |
| `TuningRecord` (`src/policy/tuning.ts`) | modified | adds `seenAt?: number` | no |
| `markSeen` | new | `markSeen(record: TuningRecord, at: number): TuningRecord`; result `seenAt = Math.max(record.seenAt ?? at, at)` | no |
| `unseenEntries` | new | `unseenEntries(record: TuningRecord): HistoryEntry[]`; entries with `at > seenAt` (all of them when `seenAt` is absent), in history order | no |
| `SignalLine` (`src/policy/tuning-signals.ts`) | new | `{ kind: string; at: number; mode?: string; turnId?: string; tier?: string; effort?: string; effective?: string; status?: string; toolCalls?: number; failures?: number; outcome?: string }` | no |
| `Signal` | new | `{ count: number; of: number }` | no |
| `ModeSignals` | new | `{ mode: string; lowWorkerErrors: Signal; corrected: Signal; largeAtLow: Signal; highSmall: Signal }` | no |
| `SIGNAL_WINDOW`, `SIGNAL_MODES` | new | `200`; `["budget", "standard", "premium"] as const` (local to `policy/`) | no |
| `signalsByMode` | new | `signalsByMode(lines: readonly SignalLine[]): ModeSignals[]`; one entry per mode in `SIGNAL_MODES` order that has at least one decision; other or absent `mode` ignored | no |
| `untunedTimeout` (`src/store/settings.ts`) | new | `untunedTimeout(config: Config): number` = `config.classifier?.timeoutMs ?? DEFAULTS.classifier.timeoutMs` | no |
| `Snapshot` (`src/host/readiness.ts`) | modified | adds `tuning: { kind: TuningRead["kind"]; issues: Issue[]; record: TuningDocument }` and `untunedTimeoutMs: number` | no |
| `buildSnapshot` | modified | input adds optional `tuningRead?: TuningRead` (default `{ kind: "missing", record: {} }`); the tuning layer reaches `resolveSettings` only when `configRead.kind === "ok"` | no |
| `issueLines` (`src/host/tuning-text.ts`) | modified (moved from `commands.ts`) | `issueLines(label: string, issues: readonly Issue[]): string[]`, unchanged output `  <label> <path or (file)>: <message>` | no |
| `TuneView` (`src/host/tuning-text.ts`) | new | `{ off: boolean; effective: number; tunedFrom?: number; configValid: boolean; pending?: { from: number; to: number; since: number }; block?: { value: number; remaining: number }; history: readonly HistoryEntry[]; signals: readonly ModeSignals[] \| "ledger-unreadable"; problems: readonly string[] }` | no |
| Text functions | new | `changeLine(e: TuningEvent): string \| undefined` (`undefined` for `kept`); `sessionStartLine(unseen: readonly HistoryEntry[]): string`; `tuneReport(v: TuneView): string`; `undoneMessage(from: number, to: number): string`; `resetMessage(untuned: number): string`; constants `NOTHING_TO_UNDO`, `OFF_MESSAGE`, `ON_MESSAGE` | no |
| `UiCtx` (`src/host/tuning-deps.ts`) | new | `Pick<ExtensionContext, "hasUI" \| "ui">` | no |
| `TuningDeps` (`src/host/tuning-deps.ts`) | new | `{ dir: string; now: () => number; load: () => Snapshot; updateTuning: (dir: string, mutate: (r: TuningDocument) => TuningDocument) => WriteResult; readLedger: (dir: string) => LedgerRead }` | no |
| `settleTuning` | new | `settleTuning(deps: TuningDeps, ctx: UiCtx): void`; never throws | no |
| `showUnseenTuning` (`src/host/tuning-seen.ts`) | new | `showUnseenTuning(deps: TuningDeps, ctx: UiCtx): void`; never throws | no |
| `TuneSub`, `TuneOutcome` (`src/host/tune-command.ts`) | new | `"report" \| "undo" \| "reset" \| "on" \| "off"`; `{ ok: boolean; message: string }` | no |
| `buildTuneView` | new | `buildTuneView(snapshot: Snapshot, ledger: LedgerRead): TuneView` | no |
| `runTune` | new | `runTune(deps: TuningDeps, sub: TuneSub, ctx: UiCtx): TuneOutcome`; never throws | no |
| `JevArgs` (`src/host/commands.ts`) | modified | adds `{ kind: "tune"; sub: TuneSub }` | no |
| `runJev` deps | modified | adds optional `tune?: (sub: TuneSub, ctx: UiCtx) => TuneOutcome`; when a `tune` form arrives and `tune` is absent, `runJev` notifies the usage text as a warning, as before this change | no |
| `/jev tune [undo\|reset\|on\|off]` | new | command form: nothing or exactly one of the four words after `tune`, case-sensitive; anything else is usage text | public (command) |
| `seedLedger`, `seedCorrections`, `writeConfigFile`, `command`, `uiRequests`, `notifies` (`tests/host/rpc-helpers.ts`) | new | test helpers, see Task 11 | no |
| `tuning-fakes` (`tests/host/tuning-fakes.ts`) | new | `fakeDeps(o)`, `fakeCtx(hasUI, throwing?)`, `firing(from?)`, `quiet()`; see Task 7 | no |

---

## Task 1: Seen marker in the store — implements 1.1

**Files:** Modify `src/store/tuning-file.ts`, and `src/policy/tuning.ts` (type only). Test: `tests/store/tuning-file.test.ts`.

**Interfaces:** Produces `TuningDocument.seenAt` and `TuningRecord.seenAt`.

- [ ] **Step 1: Write the failing tests.**
  - "Seen marker read": `{"version":1,"seenAt":1000}` reads `ok` with `seenAt` 1000.
  - "Bad seen marker": `seenAt` `-1`, and then `1.5`, each reads `malformed` with a problem at `seenAt`.
- [ ] **Step 2: Run** `bun test tests/store/tuning-file.test.ts`. Expected: FAIL (unknown key).
- [ ] **Step 3: Implement.** Add `seenAt: at` to the validator object, and `seenAt?: number` to both types.
- [ ] **Step 4: Run** `bun test tests/store tests/policy && bun run typecheck`. Expected: PASS, including "TuningRecord and TuningDocument are mutually assignable".
- [ ] **Step 5: Commit** `feat(tuning-file): add the seenAt marker`.

## Task 2: Seen helpers — implements 1.2

**Files:** Modify `src/policy/tuning.ts`. Test: `tests/policy/tuning.test.ts`.

**Interfaces:** Produces `markSeen` and `unseenEntries`.

- [ ] **Step 1: Write the failing tests.**
  - `markSeen({}, 5).seenAt` is 5.
  - `markSeen({ seenAt: 9 }, 5).seenAt` is 9.
  - `markSeen` keeps the other fields and does not mutate its input (deep-equal to a copy).
  - `unseenEntries` with no `seenAt` returns all entries.
  - With `seenAt` 1000 and entries at 1000, 2000 and 3000, it returns those at 2000 and 3000.
  - `undoTuning`, `resetTuning`, `setTuningOff` and `stepTuning` each keep `seenAt: 7`.
- [ ] **Step 2: Run** `bun test tests/policy/tuning.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** both functions per Contracts.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(tuning-rules): seen helpers`.

## Task 3: Signals per mode — implements 2.1, 2.2

**Files:**
- Create `src/policy/tuning-signals.ts`.
- Test: `tests/policy/tuning-signals.test.ts`, and modify `tests/policy/tuning-seam.test.ts`.

**Interfaces:** Produces `SignalLine`, `Signal`, `ModeSignals`, `SIGNAL_WINDOW`, `SIGNAL_MODES` and `signalsByMode`.

- [ ] **Step 1: Write the seam test** "ledger entries are signal lines": `const s: readonly SignalLine[] = [] as LedgerEntry[]`.
- [ ] **Step 2: Write the failing tests**, one per `tuning-signals` scenario, with the spec's inputs and counts.
  - **Window per mode:** 250 `standard` lines and 10 `budget` lines. `standard` counts over the latest 200 (its `of` values are at most 200), and `budget` over its 10.
  - **Modes never mixed:** `budget` has 1/1 `lowWorkerErrors` and `standard` has 0/0.
  - **Empty mode left out**, and **Input unchanged**.
  - **Input order irrelevant:** 201 `standard` worker lines with `tier: fast` and a shared `at`, differing only in `status`. The input and its reverse give equal results.
  - **Signal counts:**
    - Counted and denominator: `lowWorkerErrors` {1, 3}.
    - Correction points at a main line: `corrected` {1, 4}.
    - Correction for a turn outside the window: unchanged.
    - Threshold: `largeAtLow` {2, 3}.
    - Small high turns: `highSmall` {1, 4}, with one `high` line that has `toolCalls` 1 and no `failures`, which stays uncounted.
- [ ] **Step 3: Run** `bun test tests/policy/tuning-signals.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 4: Implement.**
  - **Sorting.** Sort by `at`, then by a stable key: `JSON.stringify` of a recursively key-sorted copy. A replacer array is not enough, because it drops nested keys such as `effortP`.
  - **Corrections.** Collect `turnId`s from every `correction` line in the input.
  - **Low effort.** `LOW = ["off", "minimal", "low"]`.
  - **Structure.** One named helper per signal. `signalsByMode` only composes them.
- [ ] **Step 5: Run** `bun test tests/policy && bun run lint`. Expected: PASS with no boundary violation.
- [ ] **Step 6: Commit** `feat(tuning-signals): observed signals per mode`.

## Task 4: Tuning texts — implements 4.1

**Files:**
- Create `src/host/tuning-text.ts`, and modify `src/host/commands.ts` (import `issueLines`, remove the local copy).
- Test: `tests/host/tuning-text.test.ts`.

**Interfaces:**
- Consumes `TuningEvent`, `HistoryEntry`, `ModeSignals` and `Issue`.
- Produces `issueLines`, `TuneView` and the text functions.

- [ ] **Step 1: Write the failing tests with exact strings.**
  - `issueLines("tuning (malformed)", [{ path: "", message: "m" }])` equals `["  tuning (malformed) (file): m"]`.
  - Change lines:
    - `changeLine` for `applied` 1500→1700, `reverted` 1700→1500 and `superseded` 1700→2000 gives the three spec strings.
    - `kept` gives `undefined`.
  - Session-start line:
    - One unseen change gives `… timeoutMs 1500→1700 (1 change) · /jev tune`.
    - Several unseen changes give `1700→2100 (2 changes)`.
    - Changes that cancel out give `1500→1500 (2 changes)`.
  - Messages:
    - `undoneMessage(1700, 1500)` and `resetMessage(1500)` give the spec strings.
    - `NOTHING_TO_UNDO`, `OFF_MESSAGE` and `ON_MESSAGE` equal the spec strings.
  - `tuneReport`:
    - **Not tuned:** `tuning: on`, `timeoutMs: 1500 (not tuned)`, `history: none`, `signals: no decisions yet`.
    - **Pending change:** `pending: 1500→1700, 12/40 decisions since`.
    - **Pending count capped:** a view with `since: 40` (the cap is applied in `buildTuneView`) prints `40/40`.
    - **Active block:** `block: raises to 1700 or above held back for 150 more decisions`.
    - **Neither pending nor blocked.**
    - **Invalid config in the report:** `tuning paused: config error` follows the `timeoutMs` line.
    - **History newest first:** `  2026-11-07T11:30Z undo 1700→1500` comes before `  2026-11-07T10:00Z rule 1500→1700`.
    - **Only five shown.**
    - **Signals shown:** header `signals (observed, not applied; latest 200 decisions per mode):`, then `  standard: lowWorkerErrors 1/3 · corrected 0/4 · largeAtLow 0/0 · highSmall 0/0`.
    - **Ordering:** `ledger unreadable` comes before `history:`, and `problems:` comes last.
- [ ] **Step 2: Run** `bun test tests/host/tuning-text.test.ts tests/host/commands.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** pure builders. The time is `new Date(at).toISOString().slice(0, 16) + "Z"`. Move `issueLines` here.
- [ ] **Step 4: Run** the same command. Expected: PASS, with the `formatStatus` tests unchanged.
- [ ] **Step 5: Commit** `feat(tune-command): tuning texts`.

## Task 5: Untuned timeout — implements 3.1

**Files:** Modify `src/store/settings.ts`. Test: `tests/store/settings.test.ts`.

- [ ] **Step 1: Write the failing test.** `untunedTimeout({})` is 1500, and `untunedTimeout({ classifier: { timeoutMs: 2000 } })` is 2000.
- [ ] **Step 2: Run** `bun test tests/store/settings.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, and make `resolveSettings` call it.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `refactor(settings): export untunedTimeout`.

## Task 6: Snapshot reads tuning.json — implements 3.2, 3.3

**Files:**
- Modify `src/host/readiness.ts`, `src/host/commands.ts` (`formatStatus`), `tests/host/worker-fakes.ts` and `tests/host/tools.test.ts`.
- Test: `tests/host/readiness.test.ts` and `tests/host/commands.test.ts`.

**Interfaces:** Consumes `readTuning`, `TuningRead`, `untunedTimeout` and `issueLines`. Produces `Snapshot.tuning`, `Snapshot.untunedTimeoutMs` and the new `buildSnapshot` input.

- [ ] **Step 1: Write the failing tests** in `readiness.test.ts`.
  - **"Tuned value in the snapshot":** `tuningRead` ok with `{ timeoutMs: { value: 1700, base: 1500 } }` and an empty config gives `settings.classifier.timeoutMs` 1700, `untunedTimeoutMs` 1500 and `tuning.kind` `ok`.
  - **"Tuning ignored with an invalid config":** gives 1500.
  - **"Malformed tuning ignored":** gives 1500, `tuning.kind` `malformed` and one issue at `""`.
  - **"reads the files and the tool list"** is extended so that a `tuning.json` on disk reaches the snapshot.

  In `commands.test.ts`, add "Malformed tuning reported": `formatStatus` lists `  tuning (malformed) (file): …` under `problems:`.
- [ ] **Step 2: Run** `bun test tests/host/readiness.test.ts tests/host/commands.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** per D3. `formatStatus` appends `issueLines(\`tuning (${s.tuning.kind})\`, s.tuning.issues)` after the state problems.
- [ ] **Step 4: Update the fixtures.** Rewrite `snap()` in `tests/host/worker-fakes.ts` and `tests/host/tools.test.ts` to call `buildSnapshot` with `ConfigRead`/`StateRead` built from their options, keeping their current option names, so new `Snapshot` fields need no further fixture edits.
- [ ] **Step 5: Run** `bun run typecheck && bun test tests/host`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(readiness-checks): read tuning.json into the snapshot`.

## Task 7: Step at settle — implements 5.1

**Files:**
- Create `src/host/tuning-deps.ts` (`UiCtx`, `TuningDeps` only) and `src/host/tuning-step.ts`.
- Test: `tests/host/tuning-fakes.ts` (shared with Tasks 8 and 9) and `tests/host/tuning-step.test.ts`.

**Interfaces:**
- **Consumes:** `stepTuning`, `markSeen`, `changeLine` and `Snapshot`.
- **Produces:** `UiCtx`, `TuningDeps` and `settleTuning`.

**Test setup.** There are two kinds of tests.

- **Fake deps.** `load` returns `buildSnapshot(...)` with the record under test. The fake `updateTuning(dir, mutate)` calls `mutate(stored)`, records the result, and returns `{ ok: true }`. It can be told to return `{ ok: false, issues }` instead, or to substitute another `stored` before calling `mutate`. `readLedger` returns `{ kind: "ok", entries, skipped: 0 }`. The fake `ctx` records `notify` calls, and `hasUI` is configurable.
- **Real stores.** Use a temp jev dir with the real `readTuning`, `updateTuning` and `readLedger` for four cases: malformed recovery, `chmod 0000` unreadable tuning file, `chmod 0000` ledger, and the 2000-line read. The `chmod` cases are skipped as root. `load` is `() => buildSnapshot({ configRead: { kind: "ok", config: {} }, stateRead: { kind: "missing", state: {} }, tuningRead: readTuning(dir), env: {}, toolNames: [] })`.

Ledger fixtures:
- **`firing`:** 40 `main` lines at `at` 1…40, `mode` `standard`. Ten have `answered: false` and `miss: "timeout"`; thirty have `answered: true` and `ms: 1000`.
- **`quiet`:** 10 answered lines.

`now` is 5000.

- [ ] **Step 1: Write the failing tests.**

  | Test | Record / setup | Ledger | hasUI | Expect |
  |---|---|---|---|---|
  | Rule fires at settle | `{}`, config without `timeoutMs` | `firing` | yes | stored `timeoutMs {1700,1500}`, `pending {from 1500,to 1700}`, last history `rule`, `seenAt` 5000 |
  | Nothing to change | `{}` | `quiet` | yes | `updateTuning` not called, no notify |
  | Applied line | as "Rule fires" | `firing` | yes | one notify `["Jev tune: timeoutMs 1500→1700 · /jev tune undo","info"]` |
  | Reverted line | `timeoutMs {1700,1500}`, `pending {1500,1700,at 0,before {40,1}}`, history `rule` at 0 | 40 lines after 0 with 10 timeouts | yes | notify carries the reverted text |
  | Superseded line | `timeoutMs {1700,1500}`, config `timeoutMs` 2000 | `quiet` | yes | notify carries the superseded text |
  | Kept is silent | `timeoutMs {1700,1500}`, `pending {from 1500,to 1700,at 0,before {40,10}}`, history `rule` at 0 | 40 answered lines after 0 | yes | `pending` cleared, `timeoutMs` kept, no notify |
  | Invalid config | `timeoutMs {1700,2000}`, config invalid | `firing` | yes | `updateTuning` not called |
  | Unreadable tuning file (real stores, `chmod 0000`) | `tuning.json` with `{1700,1500}` | `firing` | yes | `tuning.json` mode and bytes unchanged, no `tuning.json.bad`, no notify |
  | Unreadable ledger (real stores, `chmod 0000` on `ledger.jsonl`) | `{}` | `firing` | yes | no `tuning.json` created, no notify |
  | Throwing ledger read | `{}` | `readLedger` throws | yes | returns normally, nothing written |
  | Refused write | `{}` | `firing` | yes | `updateTuning` returns `{ok:false}`, no notify |
  | Throwing notify | `{}` | `firing` | yes, `notify` throws | returns normally, record stored |
  | Line shown | `{}` | `firing` | yes | `seenAt` 5000 |
  | No UI | `{}` | `firing` | no | stored change has no `seenAt`, no notify |
  | Another process changed it first | snapshot `{}`; the fake substitutes `stored` with the applied record (`timeoutMs {1700,1500}`, `pending.at` 5000, last history `rule` at 5000, no `seenAt`) | `firing` | yes | `mutate` returns that record unchanged (deep-equal, still no `seenAt`), no notify |
  | second settle with same ledger is a no-op | run twice with the fake keeping its stored record | `firing` | yes | one `rule` entry, one notify |
  | Malformed tuning file recovered (real stores) | `tuning.json` = `"{"` | `firing` written to `ledger.jsonl` | yes | `tuning.json.bad` holds `{`, `tuning.json` holds the change |
  | 2000 lines (real stores) | `{}` | 2000 answered lines | yes | `readLedger` spy called once, duration < 1000 ms |

- [ ] **Step 2: Run** `bun test tests/host/tuning-step.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `settleTuning` per D4. Use small named helpers: `shouldSkip(snapshot)`, `stepOnce(record, snapshot, lines, now)`, `persist(deps, …)` (which returns the events from the second pass) and `announce(ctx, events)`. Use one `try` around the whole call.
- [ ] **Step 4: Run** `bun test tests/host/tuning-step.test.ts && bun run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(tuning-host): step at settle and change lines`.

## Task 8: Session start line — implements 5.2

**Files:**
- Create `src/host/tuning-seen.ts`.
- Test: `tests/host/tuning-seen.test.ts`.

**Interfaces:**
- **Consumes:** `TuningDeps`, `unseenEntries`, `markSeen` and `sessionStartLine`.
- **Produces:** `showUnseenTuning`.

- [ ] **Step 1: Write the failing tests** with `tests/host/tuning-fakes.ts`.
  - **One unseen change:** no `seenAt`, one `rule` 1500→1700 at 1000. Expect one notify with the spec text, and `seenAt` stored as 1000.
  - **Several unseen changes:** `seenAt` 1000 with entries at 1000, 2000 and 3000. Expect `1700→2100 (2 changes)` and `seenAt` 3000.
  - **Changes that cancel out:** expect `1500→1500 (2 changes)`.
  - **Shown once:** a second call with the stored record shows nothing.
  - **Everything seen:** `updateTuning` is not called.
  - **No UI at start:** `updateTuning` is not called and there is no notify.
  - **Malformed file at start:** snapshot `tuning.kind` is `malformed`. Expect no write and no notify.
  - **Refused seen write:** `updateTuning` returns `{ ok: false }`. Expect no notify.
- [ ] **Step 2: Run** `bun test tests/host/tuning-seen.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** per D6: write first, notify after `{ ok: true }`, with one `try`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(tuning-host): session start line`.

## Task 9: `/jev tune` — implements 5.3

**Files:**
- Create `src/host/tune-command.ts`.
- Test: `tests/host/tune-command.test.ts`, using `tests/host/tuning-fakes.ts`. Real stores are used for the last two rows of Step 2.

**Interfaces:**
- **Consumes:** `TuningDeps`, `undoTuning`, `resetTuning`, `setTuningOff`, `markSeen`, `decisions`, `after`, `blockActive`, `TUNING`, `signalsByMode` and the text functions.
- **Produces:** `TuneSub`, `TuneOutcome`, `buildTuneView` and `runTune`.

- [ ] **Step 1: Write the failing `buildTuneView` tests.**

  | Test | Inputs | Expected view |
  |---|---|---|
  | Not tuned | empty | `effective` 1500, no `tunedFrom`, `history: []`, `signals: []` |
  | Pending change | `pending` at 1000, 12 decisions after | `pending.since` 12 |
  | Pending count capped | `pending` at 1000, `off`, 55 decisions after | `since` 40 |
  | Active block | block at 1000, 50 decisions after | `remaining` 150 |
  | Config edited | record `{1700,1500}`, config 2000 | `effective` 2000, no `tunedFrom` |
  | Off shown | `off: true` | `off` true |
  | Invalid config in the report | config invalid | `configValid` false |
  | Unreadable ledger | ledger `unreadable` | `signals` `"ledger-unreadable"` |
  | Malformed tuning file | `tuning.kind` `malformed` | `problems` holds one `tuning (malformed)` line |
  | Unreadable tuning file in the report | `tuning.kind` `unreadable`, issue `cannot read tuning.json (EACCES)` | `problems` holds a line containing `EACCES` |
  | Signals shown | standard lines | one `standard` entry |

- [ ] **Step 2: Write the failing `runTune` tests.**

  | Test | Setup | hasUI | Expect |
  |---|---|---|---|
  | Undo a change | `{1700,1500}` with `rule` 1500→1700 | yes | stored: no `timeoutMs`, `block {1700, 5000}`, `undo` entry, `seenAt` 5000; message = `undoneMessage(1700,1500)` |
  | Undo without a UI | same, no `seenAt` | no | stored has no `seenAt` |
  | Nothing to undo | `{}` | yes | `NOTHING_TO_UNDO`, `updateTuning` not called |
  | Stale tuned value | `{1700,1500}`, config 2000 | yes | `NOTHING_TO_UNDO`, no write |
  | Reset after changes | `{1900,1500}`, `pending`, `block`, `off: true` | yes | no `timeoutMs`, `pending` or `block`; `off` true; last entry `reset` 1900→1500; `resetMessage(1500)` |
  | Reset with nothing tuned | `{}` | yes | `resetMessage(1500)`, no write |
  | Invalid config | config invalid; `reset`, then `undo` | yes | `{ ok: false }`, no write |
  | Off keeps the tuned value | `{1700,1500}` | yes | `off` true, `timeoutMs` and `history` unchanged, `OFF_MESSAGE` |
  | On again | `off: true` | yes | `off` false, `ON_MESSAGE` |
  | Unreadable tuning file (real store, `chmod 0000`) | `off` | yes | `{ ok: false }`, message contains `EACCES`, no `.bad` |
  | Malformed file recovered by a change (real store) | `tuning.json` = `"{"`, `off` | yes | `.bad` holds `{`, `tuning.json` equals `{ version: 1, off: true }` |

- [ ] **Step 3: Run** `bun test tests/host/tune-command.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** `buildTuneView` (pure) and `runTune`.
  - `runTune` uses one small function per subcommand.
  - Refuse `undo` and `reset` while the config is invalid.
  - Report a stale base as nothing to undo.
  - `markSeen(now)` applies only with `hasUI`, for `undo` and `reset`.
  - A refused write returns `{ ok: false, message: issues joined }`.
- [ ] **Step 5: Run** `bun test tests/host/tune-command.test.ts && bun run lint`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(tune-command): report and subcommands`.

## Task 10: Wiring — implements 6.1, 6.2

**Files:**
- Modify `src/host/commands.ts`, `src/host/setup.ts` and `tests/host/jev-base.test.ts`.
- Test: `tests/host/commands.test.ts` and `tests/host/setup.test.ts`.

**Interfaces:**
- **Consumes:** `settleTuning`, `showUnseenTuning` and `runTune`.
- **Produces:** the `tune` `JevArgs` and the `runJev` `tune` dependency.

- [ ] **Step 1: Write the failing tests** in `commands.test.ts`.
  - `parseJevArgs("tune")` gives `{ kind: "tune", sub: "report" }`, and `parseJevArgs("tune off")` gives `sub: "off"`.
  - **Unknown subcommand:** `"tune apply"`, `"tune Undo"` and `"tune undo now"` each give usage.
  - **Replace "lists no later forms"** with "Usage lists the tune form": `usageText()` contains `/jev tune [undo|reset|on|off]`.
  - **Replace "Command from a later work group gets usage as warning"** with "Command from a later work group". `runJev("tune")` with a fake `tune` that returns `{ ok: true, message: "R" }` notifies `[["R","info"]]`, and `state.json` does not exist.
- [ ] **Step 2: Write the failing child-session test** in `setup.test.ts`, following its existing child-session tests.
  - Write `tuning.json` with an unseen `rule` entry, and write a `firing` `ledger.jsonl` under `PI_CODING_AGENT_DIR/jev`.
  - Fire `session_start` and `agent_settled` with a child session id.
  - Expect `tuning.json` to be byte-identical and `notify` never called. This covers "Worker session" and "Worker session start".
- [ ] **Step 3: Update `tests/host/jev-base.test.ts`.** In "unknown command notifies a warning", replace `/jev tune` with `/jev tunes`, which is still unknown.
- [ ] **Step 4: Run** `bun test tests/host/commands.test.ts tests/host/setup.test.ts`. Expected: FAIL.
- [ ] **Step 5: Implement.**
  - **Parsing.** Parse `tune` in `parseJevArgs` before the slot parser.
  - **Usage.** Add `"  /jev tune [undo|reset|on|off]   show or change tuning"` to `usageText`.
  - **`runJev`.** Call `deps.tune`, and notify `info` when `ok`, `error` otherwise. With no `deps.tune`, notify the usage text as a warning, so the existing "throwing notify" test (`commands.test.ts`) keeps its meaning.
  - **`setup.ts`.**
    - Build `TuningDeps` once, with `jevDir()`, `Date.now`, `() => loadSnapshot(pi)`, `updateTuning` and `readLedger`.
    - Call `settleTuning(deps, ctx)` after `await main.agentSettled(event)`, in its own `try`, inside the non-child branch.
    - Call `showUnseenTuning(deps, ctx)` after `drawStatus`, in its own `try`.
    - Pass `tune: (sub, ctx) => runTune(deps, sub, ctx)` to `runJev`.
- [ ] **Step 6: Run** `bun run typecheck && bun test tests/host`. Expected: PASS.
- [ ] **Step 7: Commit** `feat(jev-command): /jev tune and tuning at settle`.

## Task 11: Host tests — implements 7.1, 7.2

**Files:**
- Create `tests/host/rpc-helpers.ts` and `tests/host/tuning-host.test.ts`.
- Modify `tests/host/jev-base.test.ts` (import the helpers) and `tests/host/worker-routing.test.ts`.

**Interfaces:** Consumes `startHostSession` and `runOnce` with the `agentDir` option, `startJevFixture`, `startFixture`.

**Test setup.** Add these helpers to `tests/host/rpc-helpers.ts`:
- **Moved helpers.** Move `command`, `uiRequests` and `notifies` here from `jev-base.test.ts`.
- **`writeConfigFile(agentDir, config)`.** Writes `<agentDir>/jev/config.json`. It must run before `startHostSession`, so that `writeJevConfig`, which keeps an existing config, never adds a `timeoutMs`.
- **`seedLedger(agentDir, n, opts)`.** Writes `n` valid `main` lines to `<agentDir>/jev/ledger.jsonl`:
  - Each line is `{ v: 1, at: Date.now() - 100000 + i, kind: "main", session: "seed", mode: "standard", turnId: "seed-<i>", outcome: "ok", … }`.
  - A miss line adds `answered: false, miss: "timeout"`. An answered line adds `answered: true, ms: 1000`.
  - Every line must pass `validateLedgerEntry`.
- **`seedCorrections(agentDir, turnIds)`.** Appends `{ v: 1, at, kind: "correction", session: "seed", turnId, corrects: 0.9 }` for each id.

Each test follows the same order:
1. Start the Jev fixture.
2. Write the config with its URL and no `timeoutMs`.
3. Seed the ledger.
4. Start the session with the same `agentDir`.

`timeoutMs` stays at its default of 1500, so a hanging Jev takes 1.5 s per turn.

- [ ] **Step 1: Extract the helpers.** Run `bun test tests/host/jev-base.test.ts`. Expected: PASS.
- [ ] **Step 2: Write the host tests.**
  - **Rule fires at settle, RPC notify, Line shown:**
    - Setup: Jev `{ hang: true }`; seed 39 lines, 9 misses and 30 answered. The prompt adds the 40th line, a timeout.
    - Poll until `tuning.json` exists. It holds `timeoutMs {1700,1500}`, `pending`, a `rule` entry and `seenAt`.
    - One `notify` of type `info` carries `Jev tune: timeoutMs 1500→1700 · /jev tune undo`. No session message contains `Jev tune`.
  - **No Jev call:** record `jev.requests.length` after the turn's ledger line appears. After settle and a 300 ms sleep, the count is the same.
  - **Other files untouched:** `config.json` and `state.json` (`{ version: 1 }`) have the same bytes as before.
  - **Tuned value used by the next request:**
    - Setup: `tuning.json` with `{ version: 1, timeoutMs: { value: 2500, base: 1500 } }`, a hanging Jev, and no seed.
    - The main line has `miss: "timeout"` and `ms` in `[2450, 2700)`.
  - **Shown once:**
    - Setup: `tuning.json` with an unseen `rule` 1500→1700 at 1000.
    - The first session's notify carries the session-start line. Close it, and start a second session on the same `agentDir`: it shows no `Jev tune` notify.
  - **Off survives a restart, Off stops tuning:**
    - In the first session, `/jev tune off`. Close it.
    - In the second session on the same `agentDir`, `/jev tune` starts with `tuning: off`.
    - Seed the firing ledger and prompt with a hanging Jev. `tuning.json` has no `timeoutMs`.
  - **Print mode:**
    - `runOnce({ mode: "print", agentDir, … })` with the firing seed and a hanging Jev.
    - Poll up to 5 s until `tuning.json` holds the change. It has no `seenAt`, and stdout does not contain `Jev tune`.
  - **Signals never tune:**
    - Setup: Jev answers `okAnswer` (as in `verbose-log.test.ts`). Seed 60 answered lines, each with `effective: "low"` and `toolCalls: 30`, plus 60 `correction` lines from `seedCorrections`.
    - One prompt. `tuning.json` does not exist.
  - **Superseded at first settle after restart:**
    - Setup: `tuning.json` `{1700,1500}`, and a config with `classifier.timeoutMs` 2000.
    - One prompt with `okAnswer`. The notify carries `Jev tune: timeoutMs 1700→2000, your config value replaces the tuned one`.
- [ ] **Step 3: Write "Worker routing uses the tuned value"** in `worker-routing.test.ts`, following "Jev %s leaves the caller's model and thinking".
  - Setup: config `timeoutMs` 300, `tuning.json` `{ value: 600, base: 300 }`, and Jev `{ hang: true }`.
  - The worker line has `miss: "timeout"` and `ms` in `[550, 800)`.
- [ ] **Step 4: Red check.** These integration tests sit over code that Tasks 7–10 already unit-tested red-to-green, so they are expected to pass at once. For one red check, comment out the `settleTuning` call in `setup.ts`. Run "Rule fires at settle": it must FAIL. Then restore the call. Do not use `git stash`, since the stash stack is shared with other worktrees.
- [ ] **Step 5: Run** `bun test tests/host/tuning-host.test.ts tests/host/worker-routing.test.ts tests/host/jev-base.test.ts`. Expected: PASS.
- [ ] **Step 6: Commit** `test(tuning-host): host tests for tuning`.

## Task 12: Docs and gate — implements 8.1, 8.2

**Files:** `docs/usage-guide.md`, `docs/domain-model.md`, `docs/configuration.md`, `docs/workflow.md`, `docs/architecture.md`, `docs/roadmap.md`.

- [ ] **Step 1: `docs/usage-guide.md`.**
  - Add `/jev tune on`, the three line texts, and the session-start line.
  - Describe the signals as observed only.
  - Remove the sentence "until its work group adds it: `tune` (WG-18)" and update the "All commands" row.
- [ ] **Step 2: `docs/domain-model.md`.** Under Tuning:
  - Add the four signal definitions and the 200-decision window.
  - Add `seenAt`.
  - Add the skip conditions, including the invalid config.
- [ ] **Step 3: `docs/configuration.md`.** Add a `seenAt` row to the `tuning.json` table.
- [ ] **Step 4: `docs/workflow.md`.**
  - §5: add the skip conditions before "Tuning on?".
  - §8 step 6: say the line is written to `seenAt` first.
- [ ] **Step 5: `docs/architecture.md`.** List `policy/tuning-signals.ts`, `host/tuning-step.ts`, `host/tuning-seen.ts`, `host/tune-command.ts` and `host/tuning-text.ts`.
- [ ] **Step 6: `docs/roadmap.md`.** Mark WG-18 Done.
- [ ] **Step 7: Run** `bun run typecheck && bun run lint && bun run fmt:check && bun test`. Expected: all pass, 0 fail.
- [ ] **Step 8: Commit** `docs: tuning host`.

---

## Scenario → test

**tuning-file** (`tests/store/tuning-file.test.ts`)
- Valid file read, Other parameter rejected, Missing inner key, Out of range, Too much history, Unknown cause, More timeouts than asked → existing tests with the same names.
- Seen marker read, Bad seen marker → Task 1.

**readiness-checks**
- Hand edit picked up → `tests/host/readiness.test.ts` "reads the files and the tool list" (`state.json` mode `budget`).
- Invalid config keeps switches → `readiness.test.ts` "invalid config keeps switches".
- Invalid config uses the default key variable → `readiness.test.ts` "invalid config ignores its key variable".
- Tuned value in the snapshot, Tuning ignored with an invalid config, Malformed tuning ignored → Task 6.

**jev-command** (`tests/host/commands.test.ts` unless noted)
- Default status, CLI review default shown, No executor, Key name never value, Invalid config reported, Unknown mode, Usage lists the mode form, Unknown feature, Bad value, Extra words, Extra words after cli-review, Whitespace only, Usage lists the slot forms → existing tests in `commands.test.ts` and `jev-base.test.ts`. This change does not touch them. They are covered by the existing lower-case `jev-command` tests, which keep passing under the Task 12 gate.
- Malformed state reported → "malformed state".
- Empty tally → "empty tally".
- Tally after work → "tally after work".
- Malformed tuning reported → Task 6.
- Command from a later work group, Usage lists the tune form → Task 10.

**tuning-signals**
- Window per mode, Modes never mixed, Empty mode left out, Input order irrelevant, Input unchanged, Counted and denominator, Correction points at a main line, Correction for a turn outside the window, Threshold, Small high turns → Task 3 (`tests/policy/tuning-signals.test.ts`).
- Signals never tune → Task 11.

**tuning-host**
- Rule fires at settle, No Jev call, Other files untouched, RPC notify, Line shown, Print mode, Tuned value used by the next request, Shown once → Task 11. Rule fires, Line shown and Shown once are also unit-tested in Tasks 7 and 8.
- Worker routing uses the tuned value → Task 11 (`worker-routing.test.ts`).
- Worker session, Worker session start → Task 10 (`setup.test.ts`).
- Nothing to change, Another process changed it first, Invalid config, Unreadable tuning file, Unreadable ledger, Malformed tuning file recovered, Applied line, Reverted line, Superseded line, Kept is silent, Refused write, No UI, Throwing ledger read, Throwing notify → Task 7. The texts are also covered by Task 4.
- One unseen change, Several unseen changes, Changes that cancel out, Everything seen, No UI at start, Malformed file at start, Refused seen write → Task 8.

**tune-command**
- Unknown subcommand → Task 10.
- Other files untouched, Off stops tuning, Off survives a restart → Task 11.
- Not tuned, Pending change, Active block, Config edited, Neither pending nor blocked, History newest first, Only five shown, Signals shown, Off shown, Invalid config in the report, Pending count capped → Task 4 for the text and Task 9 for the view.
- Unreadable ledger, Unreadable tuning file in the report, Malformed tuning file → Task 9 (`buildTuneView`).
- Undo a change, Nothing to undo, Stale tuned value, Undo without a UI, Reset after changes, Reset with nothing tuned, Invalid config, Off keeps the tuned value, On again, Unreadable tuning file, Malformed file recovered by a change → Task 9 (`runTune`).
