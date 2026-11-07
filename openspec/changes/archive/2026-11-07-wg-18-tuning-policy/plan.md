# Tuning Policy Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md`.

**Goal:** Build the pure `timeoutMs` tuning rules and the `tuning.json` store, and make the settings resolver honour a tuned value only while its base still matches.

**Architecture:** `src/policy/tuning-window.ts` holds pure counting helpers over plain `DecisionLine`s. `src/policy/tuning.ts` holds the rules over a plain `TuningRecord`: a step that only composes named helpers, plus the undo, reset and off transitions. `src/store/tuning-file.ts` validates and atomically writes the same record shape as `tuning.json`, following `src/store/state-file.ts`. `src/store/settings.ts` takes `{ timeoutMs: { value, base } }` as its tuning layer. Nothing calls the new code until the WG-18 host change.

**Tech Stack:** TypeScript run by Pi, Bun test, oxlint, oxfmt. No new dependency.

## Global Constraints

- `policy/` imports nothing outside itself and `shared/`; `store/` imports nothing outside itself and `shared/`; no Pi import outside `host/` (enforced on `src/` by `bun run lint`).
- Fail open: a malformed or unreadable `tuning.json` never makes the package inert; it reads as nothing tuned.
- Never store prompt text, tool arguments or tool output; `tuning.json` holds numbers, the cause enum and `off` only.
- Problem messages name the field path, never the value found.
- Only `timeoutMs` may change; the range is 300–5000. `config.json` is never written.
- Thresholds (verbatim from the specs): window 40 decisions, at least 20 asked, fire when `timeouts × 10 > asked`, step `max(current + 200, ceil100(p90 × 1.25))`, cooldown 40, block 200 decisions at `blocked − 100`, history ≤ 50.
- Tests need no secrets, paid calls or network beyond loopback.
- Gate: `bun run typecheck`, `bun run lint`, `bun run fmt:check`, `bun test` all pass.

## Review Focus

1. **Ledger deleted or rotated during a pending change:** decisions are counted by `at`, so the evaluation waits for 40 new decisions and compares with the stored `before` counts. Pinned in Task 6: "pending survives an empty ledger".
2. **Lines with equal `at` from concurrent processes:** the tie-break keeps the result independent of input order. Pinned in Task 4 and Task 7: "Line order does not matter" and its step variant, with shared `at`.
3. **Hand-edited `tuning.json` with a valid shape but an inconsistent record** (for example `pending` with no `timeoutMs`): the step must not throw and must not apply a value outside 300–5000. Pinned in Task 7: "inconsistent record does not throw".
4. **Untuned value outside 300–5000:** impossible from a valid config. If it is passed anyway, `stepTuning` and `resetTuning` neither fire nor add a history entry, so the record stays valid for `updateTuning` (design D5a). Pinned in Task 7 ("untuned value out of range is not tuned", with a superseded value) and Task 8 ("reset with untuned out of range").
5. **The host calls the step twice with the same inputs:** the second call must be a no-op, so no double apply. Pinned in Task 7: "idempotent on same inputs".

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `Tuning` (`src/store/settings.ts`) | modified | `type Tuning = { timeoutMs?: { value?: unknown; base?: unknown } }` (replaces `{ classifier?: { timeoutMs?: unknown } }`) | no |
| `resolveSettings` | modified | same signature; the tuned value applies only when `value` and `base` are integers 300–5000 and `base === (config.classifier?.timeoutMs ?? DEFAULTS.classifier.timeoutMs)` | no |
| `tuning.json` | new | `{ version: 1, off?: boolean, timeoutMs?: { value: int, base: int }, pending?: { from: int, to: int, at: int, before: { asked: int, timeouts: int } }, block?: { value: int, at: int }, history?: Array<{ at: int, parameter: "timeoutMs", from: int, to: int, cause: "rule" \| "revert" \| "undo" \| "reset" \| "superseded" }> }`; timeout ints are 300–5000, `at` 0–8640000000000000, `asked`/`timeouts` 0–40 with `timeouts ≤ asked`, history ≤ 50 | public (file format) |
| `TuningDocument` (`src/store/tuning-file.ts`) | new | an explicit type for `tuning.json` without `version`, with every inner key required (not derived from `object()`'s `Out<S>`, whose keys are all optional) | no |
| `TuningRead` | new | `{ kind: "ok"; record: TuningDocument } \| { kind: "missing"; record: {} } \| { kind: "malformed"; record: {}; issues: Issue[] } \| { kind: "unreadable"; record: {}; issues: Issue[] }` | no |
| `readTuning` | new | `readTuning(dir: string): TuningRead` | no |
| `updateTuning` | new | `updateTuning(dir: string, mutate: (r: TuningDocument) => TuningDocument): WriteResult` | no |
| `TuningRecord` (`src/policy/tuning.ts`) | new | same shape as `TuningDocument`, declared in `policy/` | no |
| `DecisionLine` (`src/policy/tuning-window.ts`) | new | `{ kind: string; at: number; session?: string; answered?: boolean; miss?: string; ms?: number }` (a ledger line read structurally; extra fields ignored) | no |
| `TuningEvent` | new | `{ kind: "superseded" \| "kept" \| "reverted" \| "applied"; from: number; to: number }` | no |
| `stepTuning` | new | `stepTuning(input: { record: TuningRecord; untuned: number; lines: readonly DecisionLine[]; now: number }): { record: TuningRecord; events: TuningEvent[] }` | no |
| `undoTuning` | new | `undoTuning(record: TuningRecord, now: number): { kind: "undone"; record: TuningRecord; from: number; to: number } \| { kind: "nothing"; record: TuningRecord }` | no |
| `resetTuning` | new | `resetTuning(record: TuningRecord, untuned: number, now: number): TuningRecord` | no |
| `setTuningOff` | new | `setTuningOff(record: TuningRecord, off: boolean): TuningRecord` | no |
| Tuning constants | new | `TUNING = { window: 40, minAsked: 20, shareDenominator: 10, cooldown: 40, blockFor: 200, step: 200, p90Factor: 1.25, roundTo: 100, min: 300, max: 5000, history: 50 }` exported from `src/policy/tuning.ts` | no |

`undoTuning` takes no `untuned`: the record's `timeoutMs.base` is the base. The host runs `stepTuning` first, so a superseded value is already gone.

---

## Task 1: Settings resolver honours the base — implements 1.1

**Files:**
- Modify: `src/store/settings.ts` (`Tuning`, `tunedTimeout`)
- Test: `tests/store/settings.test.ts`

**Interfaces:**
- Produces: `Tuning`, `resolveSettings` (see Contracts).

- [ ] **Step 1: Update the failing tests** in `tests/store/settings.test.ts`. Rewrite "Tuning over config" to `config { classifier: { timeoutMs: 2000 } }` with `tuning { timeoutMs: { value: 2200, base: 2000 } }` → `2200`. Rewrite "Non-integer tuning ignored" (value `1800.5`, base `1500`) and "Out-of-range tuning ignored" (value `9000`, base `1500`) → untuned. Add:
  - "Config edited after tuning": config `2000`, tuning `{ value: 1700, base: 1500 }` → `2000`.
  - "Tuned from the default": no config, `{ value: 1700, base: 1500 }` → `1700`.
  - "Invalid base ignored": no config, `{ value: 1700, base: 1500.5 }` → `1500`.
  - "Missing base ignored": `{ value: 1700 }` → `1500`.
- [ ] **Step 2: Run** `bun test tests/store/settings.test.ts`. Expected: FAIL (type error or wrong value).
- [ ] **Step 3: Implement** `tunedTimeout(tuning, untuned)`: return `value` only when `value` and `base` pass the existing integer-range check and `base === untuned`.
- [ ] **Step 4: Run** `bun test tests/store/settings.test.ts && bun run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(settings): apply a tuned timeout only while its base matches`.

---

## Task 2: Tuning file read — implements 2.1

**Files:**
- Create: `src/store/tuning-file.ts`
- Test: `tests/store/tuning-file.test.ts` (with a `withDir` helper like `tests/store/state-file.test.ts`)

**Interfaces:**
- Consumes: `object`, `integer`, `oneOf`, `boolean`, `array`, `refine`, `Issue` from `src/store/validate.ts`.
- Produces: `TuningDocument`, `TuningRead`, `readTuning`, `validateTuning(doc: unknown): Issue[]` (internal, used by Task 3).

Declare `TuningDocument` explicitly and cast the validator `as V<TuningDocument & { version: 1 }>`, as `stateValidator` does. Build it from `object(..., { required })` with every inner key required, and use `array(entry, { max: 50 })` for history. For `before`, write a small local `V`: validate with `object`, then when `timeouts > asked`, push the issue at `joinPath(path, "timeouts")`. Bare `refine` would report `pending.before`. Read and parse following `readState`, with the same error-code text (`cannot read tuning.json (<code>)`, `tuning.json is not valid JSON`).

- [ ] **Step 1: Write the failing tests**:
  - "Valid file read": the spec's JSON returns `{ kind: "ok", record }` equal to it without `version`.
  - "Other parameter rejected": `riskFloor` gives paths `["riskFloor"]`.
  - "Missing inner key": `timeoutMs: { value: 1700 }` gives `["timeoutMs.base"]`.
  - "Out of range": `timeoutMs.value 9000` gives `["timeoutMs.value"]`.
  - "Too much history": 51 valid entries give a path including `history`.
  - "Unknown cause": index 3 `cause: "manual"` gives `["history[3].cause"]`.
  - "More timeouts than asked": `before {asked:10,timeouts:11}` gives exactly `["pending.before.timeouts"]`.
  - "No file": `{ kind: "missing", record: {} }`.
  - "Bad JSON": a truncated file is `malformed` with path `""`, record `{}`.
  - "Partly valid file is not salvaged": a valid `timeoutMs` with bad `history` is `malformed`, record `{}`.
  - "Value not echoed": `base: "secret-123"`, and no message contains `secret-123`.
  - "Permission denied (read)" (skipped when root): mode `0000` is `unreadable` with a message containing `EACCES`.
  - "future version": `version: 2` gives `["version"]`.
- [ ] **Step 2: Run** `bun test tests/store/tuning-file.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `readTuning(dir: string): TuningRead` and the validator in `src/store/tuning-file.ts`.
- [ ] **Step 4: Run** `bun test tests/store/tuning-file.test.ts && bun run lint`. Expected: PASS (`lint` enforces the `src/` import boundaries).
- [ ] **Step 5: Commit** `feat(tuning-file): read and validate tuning.json`.

---

## Task 3: Tuning file update — implements 2.2

**Files:**
- Modify: `src/store/tuning-file.ts`
- Test: `tests/store/tuning-file.test.ts`

**Interfaces:**
- Consumes: `readTuning`, the validator (Task 2), `writeFileAtomic` from `src/store/atomic.ts`.
- Produces: `updateTuning` (see Contracts).

Mirror `updateState`: refuse when unreadable; catch a throwing `mutate` and return `[{ path: "", message: "update failed" }]`; validate `{ version: 1, ...next }`; move a malformed file to `tuning.json.bad` and chmod it `0600`; then write atomically.

- [ ] **Step 1: Write the failing tests**:
  - "Change persists": in a fresh subdirectory that does not exist yet, set `timeoutMs {1700,1500}`. The read returns it, the file mode is `0600` and the directory mode is `0700`.
  - "Bad file moved aside": a malformed file, then set `off: true`. The `.bad` file holds the old bytes with mode `0600`, and the new file is exactly `{version:1, off:true}`.
  - "Invalid update refused": setting value `9000` gives the issue path `timeoutMs.value`, and the file bytes are unchanged.
  - "Throwing change refused": the issue path is `""` and the file is unchanged.
  - "Permission denied (update)" (skipped when root): the update returns the `EACCES` issue, no `.bad` file exists, and the file is still mode `0000` with the same bytes.
  - "Other files untouched": `config.json` and `state.json` keep the same bytes and `mtimeMs` after an update.
- [ ] **Step 2: Run** `bun test tests/store/tuning-file.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `updateTuning`.
- [ ] **Step 4: Run** `bun test tests/store/tuning-file.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(tuning-file): atomic update with bad-file recovery`.

---

## Task 4: Decision counting — implements 3.1

**Files:**
- Create: `src/policy/tuning-window.ts` and `src/policy/tuning.ts` (types and `TUNING` only for now)
- Test: `tests/policy/tuning-window.test.ts` and `tests/policy/tuning.test.ts`, sharing a `tests/policy/tuning-lines.ts` builder (`line(at, opts)` for `main` lines, `lines(n, from, opts)` for runs)

**Interfaces:**
- Produces: `TuningRecord`, `TuningEvent`, `TUNING` in `tuning.ts`, and `DecisionLine` in `tuning-window.ts` (see Contracts). `tuning-window.ts` also exports these helpers for later tasks and tests:
  - `decisions(lines): DecisionLine[]`: only `main` and `worker` lines, sorted by `at`, then `kind`, `session`, `answered`, `miss`, `ms` (`undefined` first).
  - `after(ds, at): DecisionLine[]`: lines with `at` strictly after the given time.
  - `counts(ds): { asked: number; timeouts: number }`.
  - `p90(ds): number | undefined`: nearest rank, `sorted[Math.ceil((9 * n) / 10) - 1]` (an integer numerator, so no float error), over answered lines with a finite `ms`.
  - `shareAbove(a, b): boolean`: `a.timeouts × b.asked > b.timeouts × a.asked`.

- [ ] **Step 1: Write the failing tests**:
  - "Correction lines ignored": `decisions` drops `correction` lines.
  - "Line order does not matter": a shuffled input with 5 lines sharing one `at` gives a deep-equal result.
  - "Unasked decisions are not counted": 20 asked with 3 timeouts and 20 unasked gives `counts` `{asked:20,timeouts:3}`.
  - "Nearest-rank p90": `ms` 100..2000 gives `1800`.
  - "Answered lines without ms": 30 answered, 10 of them without `ms`, plus 10 timeouts. `p90` uses the 20 values, and `counts.asked` is 40.
  - "`after` is strict": a line at exactly the given `at` is excluded.
  - "`shareAbove` integers": `{40,8}` vs `{40,6}` gives true, and `{40,8}` vs `{40,8}` gives false.
  - "p90 rank for every n": for n = 1..40, `p90` equals an integer reference `sorted[floor((9n + 9) / 10) - 1]`.
- [ ] **Step 2: Run** `bun test tests/policy/tuning.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the types and helpers. Pure: copy before sorting and never mutate the inputs. Both files import nothing outside `src/policy/` and `src/shared/`.
- [ ] **Step 4: Run** `bun test tests/policy && bun run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(tuning): decision counting helpers`.

---

## Task 5: Timeout rule, new value and block — implements 3.2

**Files:**
- Modify: `src/policy/tuning.ts`
- Test: `tests/policy/tuning.test.ts`

**Interfaces:**
- Consumes: the helpers from Task 4.
- Produces, exported for Task 7 and for tests:
  - `fires(window: readonly DecisionLine[]): boolean`
  - `blockActive(block: TuningRecord["block"], ds: readonly DecisionLine[]): boolean`: true while fewer than 200 decisions in `ds` are after `block.at`.
  - `nextValue(current: number, window: readonly DecisionLine[], block: { value: number } | undefined): number | undefined`: the caller passes the block only when `blockActive`. `undefined` means no change.

`fires` needs `window.length === 40`, `asked ≥ 20` and `timeouts × 10 > asked`. `nextValue` takes `max(current + 200, ceil100(p90 × 1.25))`, clamps it to 300–5000, applies the block (`≥ block.value` becomes `block.value − 100`), and returns `undefined` when the result is `≤ current`. `ceil100(x) = Math.ceil(x / 100) × 100`.

- [ ] **Step 1: Write the failing tests** named after the spec scenarios, with the exact values from `specs/tuning-rules/spec.md`: "Fires on timeouts", "Exactly 10% does not fire", "Other misses do not count", "Too few asked", "Step of 200", "p90 wins", "Clamped to the ceiling", "Already at the ceiling", "Blocked raise lowered", "Blocked raise dropped", "Block at the ceiling", "Block expired" (`blockActive` false at 200, true at 199).
- [ ] **Step 2: Run** `bun test tests/policy/tuning.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the three functions.
- [ ] **Step 4: Run** `bun test tests/policy/tuning.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(tuning): timeout rule and new value`.

---

## Task 6: Apply, evaluation, revert and supersede — implements 3.3

**Files:**
- Modify: `src/policy/tuning.ts`
- Test: `tests/policy/tuning.test.ts`

**Interfaces:**
- Consumes: Task 4 helpers.
- Produces, exported for Task 7 and for tests:
  - `pushHistory(history: TuningRecord["history"], entry: HistoryEntry): HistoryEntry[]`: keeps the latest 50.
  - `applyChange(record: TuningRecord, c: { from: number; to: number; base: number; before: { asked: number; timeouts: number }; now: number }): TuningRecord`
  - `evaluatePending(record: TuningRecord, ds: readonly DecisionLine[], now: number): { record: TuningRecord; event?: TuningEvent }`: no event when not yet judged.
  - `supersede(record: TuningRecord, untuned: number, now: number): { record: TuningRecord; event?: TuningEvent }`

A revert's block is `{ value: pending.to, at: now }`. A revert drops `timeoutMs` when `pending.from === base`.

- [ ] **Step 1: Write the failing tests**: "First change recorded", "Second step", "Worse is judged a revert", "Equal, kept", "Too few asked, kept", "Not yet judged", "Revert to the untuned value", "Revert to an earlier tuned value", "Oldest dropped", "Operator edits config" and "Matching base untouched" (on `supersede`), plus "pending survives an empty ledger": with `[]` lines there is no event; once 40 new lines follow `at`, they are judged against the stored `before`.
- [ ] **Step 2: Run** `bun test tests/policy/tuning.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the four functions.
- [ ] **Step 4: Run** `bun test tests/policy/tuning.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(tuning): apply, evaluation, revert and supersede`.

---

## Task 7: The step — implements 3.4

**Files:**
- Modify: `src/policy/tuning.ts`
- Test: `tests/policy/tuning.test.ts`

**Interfaces:**
- Consumes: Task 4, 5 and 6 functions.
- Produces: `stepTuning` (see Contracts).

`stepTuning` only composes the named helpers, one line per stage. Order (design D3):
1. `off` → return `{ record, events: [] }`.
2. `supersede`.
3. `evaluatePending`. A revert returns at once.
4. Cooldown: 40 decisions after the latest history `at` (0 when there is no history).
5. Fire window: the latest 40 of those decisions.
6. `nextValue`, with the block only when `blockActive`.
7. `applyChange`.

The current value is `timeoutMs.value` when tuned, else `untuned`. An untuned value outside 300–5000 skips stages 2–7: no fire and no `superseded` entry (design D5a, Review Focus 4). A `pending` without `timeoutMs` is dropped with no event (Review Focus 3).

- [ ] **Step 1: Write the failing tests**:
  - "Nothing to do".
  - "Inputs unchanged": `structuredClone` before the call and `toEqual` after.
  - "Inside the cooldown", "Cooldown passed", "Decisions before the change do not count".
  - "Kept, then the rule fires": events `kept` 1500→1700, then `applied` 1700→higher.
  - "No fire right after a revert".
  - "No change right after superseding".
  - "Off stops everything".
  - "Correction lines ignored (step)": 40 `correction` lines plus 39 decisions after the latest entry give no events.
  - "Line order does not matter (step)": the same lines, several sharing one `at`, in two orders give equal records and events.
  - "inconsistent record does not throw": `pending` with no `timeoutMs`.
  - "untuned value out of range is not tuned": untuned `9000`, with and without a tuned value whose base is 1500, gives no events, and the record is unchanged.
  - "idempotent on same inputs": stepping the returned record again with the same lines and `now` gives no events.
- [ ] **Step 2: Run** `bun test tests/policy/tuning.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `stepTuning`.
- [ ] **Step 4: Run** `bun test tests/policy/tuning.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(tuning): compose the tuning step`.

---

## Task 8: Undo, reset, off, and type parity — implements 3.5, 3.6

**Files:**
- Modify: `src/policy/tuning.ts`
- Test: `tests/policy/tuning.test.ts`, `tests/store/tuning-file.test.ts` (type parity)

**Interfaces:**
- Consumes: `pushHistory` (Task 6), `TuningDocument` (Task 2).
- Produces: `undoTuning`, `resetTuning`, `setTuningOff` (see Contracts).

Undo target: the latest `rule` entry with `to === timeoutMs.value`. Use its `from`, or drop the value when there is no such entry or `from === base`. The block is `{ value: timeoutMs.value, at: now }`. Reset adds `reset` from the tuned value to `untuned` only when a value was tuned and `untuned` is within 300–5000 (design D5a).

- [ ] **Step 1: Write the failing tests**:
  - "Undo a change", "Undo after a revert", "Second undo", "Nothing to undo".
  - "Reset after changes", and "reset with untuned out of range" (`9000`), which removes the value and adds no entry.
  - "Turning off keeps the tuned value".
  - Type parity in `tests/store/tuning-file.test.ts`: `const a: TuningRecord = {} as TuningDocument; const b: TuningDocument = {} as TuningRecord;`. It is checked by `bun run typecheck`, not by a failing run. The test file may import both modules.
- [ ] **Step 2: Run** `bun test tests/policy/tuning.test.ts`. Expected: FAIL (the parity check is verified in step 4 by `typecheck`).
- [ ] **Step 3: Implement** the three transitions.
- [ ] **Step 4: Run** `bun test tests/policy tests/store && bun run typecheck && bun run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(tuning): undo, reset and off transitions`.

---

## Task 9: Docs and full gate — implements 4.1, 4.2

**Files:**
- Modify: `docs/domain-model.md`, `docs/configuration.md`, `docs/usage-guide.md`, `docs/workflow.md`, `docs/roadmap.md`

- [ ] **Step 1: Update the docs:**
  - `docs/domain-model.md`, Tuning section:
    - "Fires when more than 10% of at least 20 asked requests timed out (`miss: timeout`; errors and schema misses do not count)".
    - The block: 200 decisions after a revert or undo, with the next raise at most `blocked − 100`.
    - The base value rule.
    - The `TuningChange` class in the diagram: rename its fields to the pending-change fields (`from`, `to`, `at`, `before`) and add `base`.
  - `docs/configuration.md`: a `tuning.json` subsection listing the fields from Contracts, its rows in the missing/malformed table (like `state.json`), and the precedence note that a tuned value applies only while config matches its base.
  - `docs/usage-guide.md`, Tuning section: one sentence that editing `timeoutMs` in config replaces a tuned value, and one that undo also stops the same raise for 200 decisions.
  - `docs/workflow.md` §5: add the "config no longer matches base" check before the pending evaluation, and the block in the fire branch.
  - `docs/roadmap.md`, WG-18: note the split into `wg-18-tuning-policy` (rules, `tuning.json`) and the host change (`agent_settled`, `/jev tune`, change line, signals).
- [ ] **Step 2: Run the gate** `bun run typecheck && bun run lint && bun run fmt:check && bun test`. Expected: all pass, 0 failures.
- [ ] **Step 3: Commit** `docs(tuning): document the tuning rules and tuning.json`.

---

## Scenario → test

**settings-resolution** (`tests/store/settings.test.ts`, Task 1)
- Everything defaulted → existing "Everything defaulted"
- Config over default → existing "Config over default"
- Tuning over config → "Tuning over config" (rewritten)
- Forked launch from config → existing "Forked launch from config"
- Non-integer tuning ignored → "Non-integer tuning ignored" (rewritten)
- Out-of-range tuning ignored → "Out-of-range tuning ignored" (rewritten)
- Config edited after tuning → "Config edited after tuning"
- Tuned from the default → "Tuned from the default"
- Invalid base ignored → "Invalid base ignored"
- Missing base ignored → "Missing base ignored"

**tuning-file** (`tests/store/tuning-file.test.ts`, Tasks 2–3)
- Valid file read → "Valid file read"
- Other parameter rejected → "Other parameter rejected"
- Missing inner key → "Missing inner key"
- Out of range → "Out of range"
- Too much history → "Too much history"
- Unknown cause → "Unknown cause"
- More timeouts than asked → "More timeouts than asked"
- No file → "No file"
- Bad JSON → "Bad JSON"
- Partly valid file is not salvaged → "Partly valid file is not salvaged"
- Value not echoed → "Value not echoed"
- Permission denied → "Permission denied (read)" and "Permission denied (update)"
- Change persists → "Change persists"
- Bad file moved aside → "Bad file moved aside"
- Invalid update refused → "Invalid update refused"
- Throwing change refused → "Throwing change refused"
- Other files untouched → "Other files untouched"

**tuning-rules** (`tests/policy/tuning-window.test.ts` and `tests/policy/tuning.test.ts`, Tasks 4–8)
- Nothing to do → "Nothing to do" (Task 7)
- Inputs unchanged → "Inputs unchanged" (Task 7)
- Correction lines ignored → "Correction lines ignored" (Task 4) and "Correction lines ignored (step)" (Task 7)
- Line order does not matter → "Line order does not matter" (Task 4) and "Line order does not matter (step)" (Task 7)
- Fires on timeouts → "Fires on timeouts" (Task 5)
- Exactly 10% does not fire → "Exactly 10% does not fire" (Task 5)
- Other misses do not count → "Other misses do not count" (Task 5)
- Too few asked → "Too few asked" (Task 5)
- Unasked decisions are not counted → "Unasked decisions are not counted" (Task 4)
- Step of 200 → "Step of 200" (Task 5)
- p90 wins → "p90 wins" (Task 5)
- Nearest-rank p90 → "Nearest-rank p90" (Task 4)
- Answered lines without ms → "Answered lines without ms" (Task 4)
- Clamped to the ceiling → "Clamped to the ceiling" (Task 5)
- Already at the ceiling → "Already at the ceiling" (Task 5)
- First change recorded → "First change recorded" (Task 6)
- Second step → "Second step" (Task 6)
- Inside the cooldown → "Inside the cooldown" (Task 7)
- Cooldown passed → "Cooldown passed" (Task 7)
- Decisions before the change do not count → "Decisions before the change do not count" (Task 7)
- Worse is judged a revert → "Worse is judged a revert" (Task 6)
- Equal, kept → "Equal, kept" (Task 6)
- Too few asked, kept → "Too few asked, kept" (Task 6)
- Not yet judged → "Not yet judged" (Task 6)
- Kept, then the rule fires → "Kept, then the rule fires" (Task 7)
- Revert to the untuned value → "Revert to the untuned value" (Task 6)
- Revert to an earlier tuned value → "Revert to an earlier tuned value" (Task 6)
- No fire right after a revert → "No fire right after a revert" (Task 7)
- Blocked raise lowered → "Blocked raise lowered" (Task 5)
- Blocked raise dropped → "Blocked raise dropped" (Task 5)
- Block at the ceiling → "Block at the ceiling" (Task 5)
- Block expired → "Block expired" (Task 5)
- Operator edits config → "Operator edits config" (Task 6)
- No change right after superseding → "No change right after superseding" (Task 7)
- Matching base untouched → "Matching base untouched" (Task 6)
- Off stops everything → "Off stops everything" (Task 7)
- Turning off keeps the tuned value → "Turning off keeps the tuned value" (Task 8)
- Undo a change → "Undo a change" (Task 8)
- Undo after a revert → "Undo after a revert" (Task 8)
- Second undo → "Second undo" (Task 8)
- Nothing to undo → "Nothing to undo" (Task 8)
- Reset after changes → "Reset after changes" (Task 8)
- Oldest dropped → "Oldest dropped" (Task 6)
