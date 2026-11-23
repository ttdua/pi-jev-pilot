# Worker Turn Tuning Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md` (decisions D1–D12).

**Goal:** Tune the worker band floors (`medium`, `long`, `very_long`) from measured `turnsUsed` with the existing tuning guards, show per-band turn signals in `/jev tune`, and feed tuned floors to worker routing.

**Architecture:** A shared floor table (`src/shared/turn-floors.ts`) is read by store validation and resolution and by policy. A leaf module `src/policy/tuning/record.ts` holds the record types, `TUNING` and `pushHistory`, so `rules.ts` and the floor modules import it and never each other in a cycle. Pure floor rules (`floor-runs.ts`, `floor-rules.ts`) handle one band; `floor-step.ts` runs them over the three bands. `stepTuning` orchestrates `timeoutMs` and the three bands with at most one applied change per call. `tuning.json` gains `turnFloors` and is written as `version` 2 only once floor data exists. Settings resolve `turnFloors`, and worker routing passes them to `turnFloor`.

**Tech Stack:** TypeScript, Bun (`bun test`, `bun check`), oxlint, oxfmt. No new dependency.

## Global Constraints

- Built-in floors: `medium` 40, `long` 100, `very_long` 200. Ranges: `medium` 20–80, `long` 50–200, `very_long` 100–400.
- Window and cooldown: 200 counted runs per band. Judging: the first 200 runs after a pending change. Block: 400 counted runs.
- New value: nearest-rank p95 × 1.25, rounded up to 10. `exhausted × 20 > runs` forces `up`. `up = max(c+10, floor10(c×5/4))`, `down = min(c−10, ceil10(c×3/4))`. Order gap: 10. Integer arithmetic only.
- History: at most 50 entries, shared. `parameter` ∈ `timeoutMs`, `turnFloor.medium`, `turnFloor.long`, `turnFloor.very_long`.
- `policy/` stays pure: no I/O, no Jev calls, inputs never mutated. Only `host/` touches Pi. `store/` imports only `store` and `shared`. Capabilities are reached through their `index.ts` (`tests/import-graph.test.ts`).
- Never store or show prompt text, tool arguments or tool output. Everything in English.
- Tests need no secrets, paid calls or network beyond loopback.
- Every existing `timeoutMs` behaviour and text is unchanged, except where a delta spec says otherwise.

## Review Focus

1. **A ledger mixing old worker lines (no `turnsP`/`turnsUsed`) with new ones:** old lines are never counted, and no band changes until 200 new runs exist. Test in Task 4: 1274 old lines plus 199 counted `long` → no change.
2. **A record with a floor pending while `off` is set, then turned on:** judging resumes and nothing is lost. Test in Task 5.
3. **A hand-edited `tuning.json` with floors out of order:** routing uses 40/100/200 and the report shows `not tuned` for floors. Test in Task 2 (resolver) and Task 7 (report).
4. **A `version` 1 file written by today's package, read by the new one, then written back without floor data:** the bytes stay `version` 1 and an older package still reads them. Test in Task 3.
5. **Two settles racing (another process applied the floor first):** the second computation in `persist` returns no events and nothing is shown. Test in Task 7 (step test, floor variant of "Another process changed it first").

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `FloorBand` | new (`src/shared/turn-floors.ts`) | `"medium" \| "long" \| "very_long"` | no |
| `FLOOR_BANDS` | new | `readonly FloorBand[]` = `["medium","long","very_long"]` | no |
| `BandFloors` | new | `Readonly<Record<FloorBand, number>>` | no |
| `BUILTIN_FLOORS` | new | `BandFloors` = `{ medium: 40, long: 100, very_long: 200 }` | no |
| `FLOOR_RANGES` | new | `Readonly<Record<FloorBand, { min: number; max: number }>>` = 20–80, 50–200, 100–400 | no |
| `FLOOR_PARAMETER` | new | `(band: FloorBand) => \`turnFloor.${FloorBand}\`` | no |
| `inFloorRange`, `orderedFloors` | new (added during apply) | `(band: FloorBand, value: unknown) => value is number`; `(floors: BandFloors) => boolean` in `src/shared/turn-floors.ts`. Reason: the final review found `effectiveFloors` (policy) and `resolveTurnFloors` (store) applied different rules; one shared helper pair keeps them identical | no |
| `FLOOR_RUNS_MAX` | new (added during apply) | `200`, exported from `src/store/tuning-file.ts`, pinned to `FLOOR.runs` by a test. Reason: store cannot import policy, so the duplicated bound is guarded by a cross-check | no |
| `turnBand` | new (`src/policy/worker/turns.ts`) | `(probabilities: Readonly<Record<string, number>> \| undefined) => FloorBand \| undefined` | no |
| `turnFloor` | modified | `(answer: Answer \| undefined, floors: BandFloors) => number \| undefined` | no |
| `BAND_FLOOR` | removed | replaced by `BUILTIN_FLOORS`; drop it from `src/policy/worker/index.ts` | no |
| `RouteInput.floors` | new field | `floors: BandFloors` | no |
| `Tuning` (settings layer) | modified | `{ timeoutMs?: {value?: unknown; base?: unknown}; turnFloors?: Partial<Record<FloorBand, { tuned?: { value?: unknown; base?: unknown } }>> }` | no |
| `Settings.turnFloors` | new field | `BandFloors` (after `classifier` in key order) | no |
| `TuningParameter` | new | `"timeoutMs" \| \`turnFloor.${FloorBand}\`` | no |
| `FloorState` | new, declared twice by layer rule: `src/store/tuning-file.ts` and `src/policy/tuning/record.ts`, structurally equal | `{ changedAt: number; tuned?: { value: number; base: number }; pending?: { from: number; to: number; at: number; before: { runs: number; exhausted: number } }; block?: { value: number; at: number } }` | no |
| `TuningDocument` / `TuningRecord` | modified | adds `turnFloors?: Partial<Record<FloorBand, FloorState>>`; history `parameter: TuningParameter` | no |
| `tuning.json` file format | modified | `version` 1 or 2. `turnFloors` and floor history only in 2. Written as 2 iff `hasFloorData`: a non-empty `turnFloors` or a floor history entry. An empty `turnFloors` object is removed before writing | yes (on-disk file read by older versions) |
| `TuningEvent` | modified | `{ kind: "superseded" \| "kept" \| "reverted" \| "applied"; parameter: TuningParameter; from: number; to: number }` | no |
| `UndoResult` | modified | `{ kind: "undone"; record; parameter: TuningParameter; from; to } \| { kind: "nothing"; record }` | no |
| `undoTuning` | modified | `(record: TuningRecord, now: number, untuned?: number) => UndoResult`; with `untuned` omitted, `timeoutMs` applies when tuned (today's behaviour) | no |
| `changeLine` | modified | `(e: TuningEvent) => string \| undefined`, texts by `e.parameter` | no |
| `sessionStartLine` | modified | `(unseen: readonly HistoryEntry[]) => string`, grouped by parameter | no |
| `undoneMessage` | modified | `(parameter: TuningParameter, from: number, to: number) => string` | no |
| `resetMessage` | modified | `(untuned: number) => string`, ends `, turn floors 40/100/200).` | no |
| `policy/tuning/index.ts` exports | modified | Task 5 adds `countedRuns`, `latestEntryAt`, types `TuningParameter`, `FloorState`, `TuningLine`; Task 6 adds `turnSignals`, `TurnSignal` | no |
| `TuningLine` | new (`policy/tuning/record.ts`) | `DecisionLine & { status?: string; turnsP?: Readonly<Record<string, number>>; turnsUsed?: number; turnPhase?: string; turnFloor?: number }`; `stepTuning`, `countedRuns` and `turnSignals` take `readonly TuningLine[]` | no |
| `record.ts` module | new (`policy/tuning/record.ts`) | moves `TuningRecord`, `HistoryEntry`, `TuningEvent`, `TuningCause`, `TUNING`, `pushHistory` out of `rules.ts` and adds `TuningParameter`, `FloorState`, `latestEntryAt(history, parameter): number`; imports nothing from `rules.ts` or the floor modules | no |
| `CountedRun` | new (`policy/tuning/floor-runs.ts`) | `{ at: number; band: FloorBand; used: number; phase?: "within" \| "warned" \| "exhausted"; floor?: number; key: string }` | no |
| `TurnSignal` | new (`policy/tuning/turn-signals.ts`) | `{ band: FloorBand; runs: number; p90?: number; p95?: number; exhausted?: number; warned?: number; usedOverFloor?: number; suggested?: number }` | no |
| `TuneView` | modified | adds `floors: { band: FloorBand; value: number; tunedFrom?: number }[]`, `floorPending: { band; from; to; since }[]`, `floorBlocks: { band; value; remaining }[]`, `turnSignals: readonly TurnSignal[] \| "ledger-unreadable"` | no |
| `/jev tune` report and messages | modified | texts in `tune-command` and `tuning-host` deltas | yes (operator-visible text) |

---

## Task 1: Shared floor table and floors as route input — implements 1

**Covers:** 1.1, 1.2, 1.3
**Difficulty:** Normal
**Blocked by:** none

**Files:**
- Create: `src/shared/turn-floors.ts`, `tests/shared/turn-floors.test.ts`
- Modify: `src/policy/worker/turns.ts`, `src/policy/worker/index.ts`, `src/policy/worker/route.ts`, `tests/policy/worker/turns.test.ts`, `tests/policy/worker/route.test.ts`, `tests/policy/worker/route-pin.test.ts`, `src/host/worker/route.ts`, `scripts/replay/report-route.ts`, `scripts/replay/compare.ts`, `tests/replay/report-route.test.ts`, and any other caller found by `rg "BAND_FLOOR|turnFloor\(|routeLaunch\(" src tests scripts`

**Interfaces:**
- Produces: `FloorBand`, `FLOOR_BANDS`, `BandFloors`, `BUILTIN_FLOORS`, `FLOOR_RANGES`, `FLOOR_PARAMETER`, `turnBand`, `turnFloor(answer, floors)`, `RouteInput.floors`.

- [ ] **Step 1:** Write `tests/shared/turn-floors.test.ts`:
  - "Built-in values": `BUILTIN_FLOORS` equals `{ medium: 40, long: 100, very_long: 200 }`.
  - Each built-in floor lies within `FLOOR_RANGES[band]`.
  - `FLOOR_PARAMETER("long") === "turnFloor.long"`.
- [ ] **Step 2:** Run `bun test tests/shared/turn-floors.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Create `src/shared/turn-floors.ts` with the contract constants. It imports nothing.
- [ ] **Step 4:** In `tests/policy/worker/turns.test.ts`:
  - Pass `BUILTIN_FLOORS` to every `turnFloor` call.
  - Add "Tuned floors passed in": floors `{40, 80, 200}` with `short` .1, `medium` .2, `long` .6, `very_long` .1 → `turnFloor` 80 and `turnBand` `"long"`.
  - Add `turnBand` cases: `short` .7, `medium` .3 → `undefined`; `undefined` → `undefined`.
- [ ] **Step 5:** Implement `turnBand`. Make `turnFloor(answer, floors)` return `answer?.type === "choice" ? floors[turnBand(answer.probabilities)] : undefined`, keeping the 0.5 bar and the 1e-9 tolerance. Delete `BAND_FLOOR` and export `turnBand` from `index.ts`.
- [ ] **Step 6:** Add `floors: BandFloors` to `RouteInput`, use it in `withTurns`, and pass `BUILTIN_FLOORS` from every caller listed in Files (the host one is replaced in Task 2).
- [ ] **Step 7:** Run `bun test tests/policy/worker tests/shared tests/replay && bun run typecheck`. Expected: PASS.
- [ ] **Step 8:** Commit `refactor(worker-decision): pass band floors into the route`.

---

## Task 2: Settings resolve tuned floors — implements 2

**Covers:** 2.1, 2.2, 2.3
**Difficulty:** Normal
**Blocked by:** Task 1, Task 3 (the routing tests write a `version` 2 `tuning.json`)

**Files:**
- Modify: `src/store/settings.ts`, `src/store/settings-sections.ts`, `src/host/worker/route.ts`, `tests/store/settings-sections.test.ts`, `tests/store/settings.test.ts`, `tests/store/settings-pin.test.ts`, `tests/host/worker-routing.test.ts`

**Interfaces:**
- Consumes: `BUILTIN_FLOORS`, `FLOOR_RANGES`, `FLOOR_BANDS` (Task 1).
- Produces: `Settings.turnFloors: BandFloors`; `resolveTurnFloors(tuning: Tuning | undefined): BandFloors` in `settings-sections.ts`.

- [ ] **Step 1:** In `tests/store/settings-sections.test.ts`, write one test per `settings-resolution` "Tuned turn floors" scenario, using the exact values from the spec:
  - Built-in floors.
  - Tuned floor applies: long 80 base 100 → 80.
  - Base differs: base 90 → 100.
  - Out of range: medium 100 → 40.
  - Order broken: medium 80 and long 60 → 40/100/200.

  Add a check that non-integer values are ignored.
- [ ] **Step 2:** Run `bun test tests/store/settings-sections.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `resolveTurnFloors`:
  1. Resolve each band on its own: an integer `value` and `base`, both in range, and `base === BUILTIN_FLOORS[band]`.
  2. If the result is not strictly ordered, return `{ ...BUILTIN_FLOORS }`.

  Then extend `Tuning`, add `turnFloors` to `Settings` and `resolveSettings` right after `classifier`, and update the key order in `settings-pin.test.ts`.
- [ ] **Step 4:** Run `bun test tests/store`. Expected: PASS, including the unchanged `timeoutMs` scenarios.
- [ ] **Step 5:** In `tests/host/worker-routing.test.ts`, write these real-session tests in the style of "Worker routing uses the tuned value" (`writeFileSync` of `jev/tuning.json` before the prompt, loopback Jev fixture):
  - "Tuned floor written": `{"version":2,"turnFloors":{"long":{"changedAt":1,"tuned":{"value":120,"base":100}}}}`, `max_turns` 20 rated long → `recordedMaxTurns(session)` is 120 and the ledger line has `turnFloor` 120.
  - "Lowered floor never lowers a limit": long tuned to 80, `max_turns` 90 → no `maxTurns` and no `turnFloor`.
  - "Bad tuning file uses built-in floors": `tuning.json` holding `{"version":2,` (truncated) → `maxTurns` 100.
  - "Jev miss writes no floor": long tuned to 120, the fixture hangs past `timeoutMs` → no `maxTurns`.
  Run them. Expected: FAIL (the host still passes `BUILTIN_FLOORS`).
- [ ] **Step 6:** In `src/host/worker/route.ts`, pass `floors: settings.turnFloors`.
- [ ] **Step 7:** Run `bun test tests/host/worker-routing.test.ts tests/store && bun run typecheck`. Expected: PASS.
- [ ] **Step 8:** Commit `feat(settings-resolution): resolve tuned turn floors`.

---

## Task 3: Tuning file version 2 — implements 3

**Covers:** 3.1, 3.2, 3.3
**Difficulty:** Normal
**Blocked by:** Task 1

**Files:**
- Modify: `src/store/tuning-file.ts`, `tests/store/tuning-file.test.ts`

**Interfaces:**
- Consumes: `FLOOR_BANDS`, `FLOOR_RANGES`, `FloorBand` (Task 1).
- Produces: `FloorState`, `TuningParameter`, `TuningDocument.turnFloors`, `validateTuning` that accepts versions 1 and 2. `updateTuning` writes the version per the "Kept at version 1" and "Written as version 2" rules.

- [ ] **Step 1:** Add one test per new or changed `tuning-file` scenario, with the exact JSON and problem paths from the spec:
  - "Floor state read".
  - "Floors in a version 1 file" → `turnFloors`.
  - "Floor history in a version 1 file" → `history[0].parameter`.
  - "Written as version 2".
  - "Kept at version 1".
  - "Other parameter rejected" (v2).
  - "Floor out of its band range" → `turnFloors.medium.tuned.value`.
  - "History value out of its parameter range" → `history[0].to`.
  - "More exhausted than runs" → `turnFloors.long.pending.before.exhausted`.
  - "Unknown version" (`{"version":3}`) → `version`.
- [ ] **Step 2:** Run `bun test tests/store/tuning-file.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the changes:
  - A per-band `floorStateValidator(band)` with `changedAt` required and range validators taken from `FLOOR_RANGES`.
  - A `runsValidator` modelled on `beforeValidator` (`exhausted ≤ runs`, `runs` 0–200).
  - A history entry validator that checks `parameter`, then `from`/`to` against that parameter's range, and reports at `history[i].from|to`.
  - A top-level check: `version` ∈ {1, 2}. With `version` 1, a `turnFloors` key or a floor-parameter entry is an issue at `turnFloors` or `history[i].parameter`.
  - In `updateTuning`, remove an empty `turnFloors` object, then use `version: hasFloorData(next) ? 2 : 1`. Test: an update leaving `turnFloors: {}` writes `version` 1 with no `turnFloors` key.
- [ ] **Step 4:** Run `bun test tests/store`. Expected: PASS, with all existing tuning-file tests unchanged.
- [ ] **Step 5:** Commit `feat(tuning-file): store turn floor state in version 2`.

---

## Task 4: Pure floor rules — implements 4

**Covers:** 4.0, 4.1, 4.2, 4.3
**Difficulty:** Hard
**Blocked by:** Task 1, Task 3

**Files:**
- Create: `src/policy/tuning/record.ts`, `src/policy/tuning/order.ts`, `src/policy/tuning/floor-runs.ts`, `src/policy/tuning/floor-rules.ts`, `tests/policy/tuning/floor-runs.test.ts`, `tests/policy/tuning/floor-rules.test.ts`, `tests/policy/tuning/worker-lines.ts` (fixture builder for worker lines)
- Modify: `src/policy/tuning/signals.ts` (import `stableKey`/`compareByAtThenKey` from `order.ts`; behaviour unchanged), `src/policy/tuning/rules.ts` (types and `TUNING`/`pushHistory` move to `record.ts`, re-exported; behaviour unchanged), `src/policy/tuning/text.ts` (type imports from `record.ts`)

**Interfaces:**
- Consumes: `turnBand` (through `policy/worker/index.ts`), shared floor constants, and the `FloorState` shape (declared again in policy as for `TuningRecord`).
- Produces (all pure; `record.ts` imports only `shared/` and `window.ts`; the floor modules import `record.ts`, never `rules.ts`):
  - `record.ts`: the Contracts types, `TUNING`, `pushHistory(history, entry): HistoryEntry[]`, `latestEntryAt(history, parameter): number` (0 when none).
  - `countedRuns(lines: readonly TuningLine[], band: FloorBand): CountedRun[]`, sorted by `at` then `key`.
  - `nearestRank(sorted: readonly number[], pct: number): number | undefined`, value at `ceil(pct × n / 100) − 1`.
  - In `floor-rules.ts`: `floorSince(record: TuningRecord, band: FloorBand): number`, the later of `turnFloors[band].changedAt` and `latestEntryAt(history, FLOOR_PARAMETER(band))`.
  - `floorWindow(runs: readonly CountedRun[], since: number): CountedRun[] | undefined`, the latest 200 runs after `since` when there are at least 200.
  - `effectiveFloors(record: TuningRecord): BandFloors`, each band's `tuned.value` when its base equals the built-in floor, else built-in.
  - `orderBounds(band: FloorBand, effective: BandFloors, record: TuningRecord): { lower?: number; upper?: number }`. The lower neighbour is `max(from, to)` of its pending change, else its effective floor; the upper is `min(from, to)`, else effective; `undefined` beyond `medium`/`very_long`.
  - `blockActiveFloor(block: { at: number } | undefined, runs: readonly CountedRun[]): boolean`, true while fewer than 400 runs follow `block.at`.
  - In `floor-rules.ts` as well: `nextFloor(input: { band: FloorBand; current: number; window: readonly CountedRun[]; bounds: { lower?: number; upper?: number }; block?: { value: number } }): number | undefined`.
  - `applyFloor(record, c: { band; from: number; to: number; before: { runs: number; exhausted: number }; now: number }): TuningRecord`.
  - `judgeFloor(record, band, runs: readonly CountedRun[], now): { record: TuningRecord; event?: TuningEvent }`, which reverts through `revertFloor(record, band, now)`.
  - `supersedeFloor(record, band, now): { record; event? }`.

- [ ] **Step 0:** Create `record.ts` by moving the types, `TUNING` and `pushHistory` out of `rules.ts` (re-export them from `rules.ts` and `index.ts` so imports stay valid), add `TuningParameter`, `FloorState`, `TuningLine`, `latestEntryAt`. Run `bun test tests/policy/tuning tests/import-graph.test.ts && bun run typecheck`. Expected: PASS, no runtime cycle.
- [ ] **Step 1:** Write `tests/policy/tuning/worker-lines.ts`. It exports `run(at, band, used, opts?)`, which builds a worker line with `turnsP` peaked on `band`, `turnsUsed`, `status` `completed` and an optional `turnPhase`/`turnFloor`, and `runs(n, from, band, used | (i) => used, opts?)`.
- [ ] **Step 2:** In `floor-runs.test.ts`, write the six "Band of a run" scenarios, "Input order irrelevant", "Other bands do not count", and Review Focus 1 (1274 lines without `turnsP` plus 199 counted `long` → `floorWindow` is `undefined`). Run it. Expected: FAIL.
- [ ] **Step 3:** Implement `order.ts` by moving `sortKeys`/`stableKey`/`compareLines` from `signals.ts`, then `floor-runs.ts`. Run `bun test tests/policy/tuning`. Expected: PASS, with signals tests unchanged.
- [ ] **Step 4:** In `floor-rules.test.ts`, write a `nextFloor` table with one row per "New floor value", "Band order" and "Floor block" scenario. Use spec inputs and expected outputs: 80, 80, 120, 120, 90, no change, no change, 90, 20, no change, 150, 110, 90, no change, 80. Build windows with `runs(200, …)` whose sorted index 189 (= ceil(0.95·200) − 1) holds the stated p95. Run it. Expected: FAIL (`nextFloor` missing).
- [ ] **Step 5:** Implement `nextFloor` in this order:
  1. `wanted = ceil(p95*5/40)*10`.
  2. Exhausted push.
  3. Clamp to `[down, up]`.
  4. Clamp to the band range.
  5. Clamp to `[lower+10, upper−10]`.
  6. Apply the block by direction.
  7. Return `undefined` when the result equals `current`.

  Implement `orderBounds` with a lower neighbour's pending as `max(from, to)` and an upper neighbour's as `min(from, to)`.
- [ ] **Step 6:** Write the record-level tests:
  - "First floor change recorded", "More exhausted, reverted", "Equal, kept", "Not yet judged", "Revert a decrease".
  - "Block after a real revert": revert at 9000, then 250 runs giving 80 → 90.
  - "Block expired" (400 runs), "New built-in floor" (the state holds only `changedAt`), "Too few runs".
  - "Cooldown survives a trimmed history": `changedAt` 1000, no history entry, 100 runs before and 150 after → no change.

  Run them. Expected: FAIL.
- [ ] **Step 7:** Implement `applyFloor`, `judgeFloor`, `revertFloor` and `supersedeFloor` in `floor-rules.ts`, with history entries using `FLOOR_PARAMETER(band)` through `pushHistory` from `record.ts` (50-entry cap).
- [ ] **Step 8:** Run `bun test tests/policy/tuning tests/import-graph.test.ts && bun run typecheck && bun run lint`. Expected: PASS.
- [ ] **Step 9:** Commit `feat(tuning-rules): pure turn floor rules`.

---

## Task 5: Multi-parameter step, undo and reset — implements 5

**Covers:** 5.1, 5.2, 5.3, 5.4
**Difficulty:** Hard
**Blocked by:** Task 4

**Files:**
- Create: `src/policy/tuning/floor-step.ts`
- Modify: `src/policy/tuning/rules.ts`, `src/policy/tuning/index.ts` (exports `countedRuns`, `latestEntryAt` and the new types), `tests/policy/tuning/rules.test.ts`

**Interfaces:**
- Consumes: everything Task 4 produces.
- Produces:
  - `stepTuning(input: StepInput)`, same signature; events carry `parameter`.
  - `undoTuning(record, now, untuned?)` (Contracts), which returns `UndoResult` with `parameter`.
  - In `floor-step.ts` (imports `record.ts`, `floor-runs.ts`, `floor-rules.ts`): `supersedeFloors(record, now)`, `judgeFloors(record, lines, now)` and `applyFirstFloor(record, lines, now)`, each `{ record; events: TuningEvent[] }`; `pickUndoTarget(record, untuned, now): { parameter: TuningParameter; target: number } | undefined`.
  - `resetTuning(record, untuned, now)`, which clears every parameter.

- [ ] **Step 1:** Update the existing `rules.test.ts` expectations so events include `parameter: "timeoutMs"`. Existing `undoTuning(rec, 5000)` calls stay valid because `untuned` is optional. Run them and confirm they fail only on that field.
- [ ] **Step 2:** Add tests:
  - "Step order across parameters": "One applied change per step", "Floor applies when timeout does not", "Revert blocks every apply".
  - "Event names its parameter".
  - "Floor change does not hold back the timeout".
  - "Floors kept on a config edit".
  - "Off holds floors", "Timeout revert blocks a floor change".
  - "Reset floors too", "Shared across parameters".
  - The undo scenarios: "Latest change undone first", "Floor undo kept in order", "Floor undo against a pending neighbour", "Floor undo blocked by the order" (skips `long`, undoes `timeoutMs` 1700→1500).
  - Review Focus 2: a record with `off`, a `long` pending change and 200 runs after it → no events; with `off` cleared → `kept` or `reverted`.
- [ ] **Step 3:** Run `bun test tests/policy/tuning/rules.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 4:** In `rules.ts`, scope the timeout `cooledWindow` and judging to `latestEntryAt(history, "timeoutMs")` and add `parameter: "timeoutMs"` to every timeout event. Run the existing tests. Expected: PASS.
- [ ] **Step 5:** Implement `floor-step.ts`:
  - `supersedeFloors`, `judgeFloors` and `applyFirstFloor` loop over `FLOOR_BANDS` with the Task 4 functions.
  - `pickUndoTarget` ranks parameters by recency (`timeoutMs`: its latest entry; a band: `floorSince`; ties in the fixed order), clamps a band target with `orderBounds`, and skips a candidate whose clamped target equals its current value.
- [ ] **Step 6:** In `rules.ts`, make `stepTuning` the four phases of D5, calling `supersede`, then `supersedeFloors`; `evaluatePending`, then `judgeFloors`; return on any `reverted`; `fireRule`, then `applyFirstFloor` only when no `applied` yet. Make `undoTuning` use `pickUndoTarget` and apply the timeout or floor undo, setting a floor's block and `changedAt`. Make `resetTuning` drop `turnFloors` and add `reset` entries in the fixed order.
- [ ] **Step 7:** Run `bun test tests/policy/tuning tests/import-graph.test.ts && bun run typecheck && bun run lint`. Expected: PASS.
- [ ] **Step 8:** Commit `feat(tuning-rules): tune turn floors next to timeoutMs`.

---

## Task 6: Turn signals — implements 6

**Covers:** 6.1, 6.2
**Difficulty:** Normal
**Blocked by:** Task 4, Task 5 (both touch `src/policy/tuning/index.ts`, so they run one after the other)

**Files:**
- Create: `src/policy/tuning/turn-signals.ts`, `tests/policy/tuning/turn-signals.test.ts`
- Modify: `src/policy/tuning/index.ts` (export `turnSignals` and `TurnSignal`)

**Interfaces:**
- Consumes: `countedRuns`, `nearestRank`, `nextFloor`, `orderBounds` (Task 4).
- Produces: `turnSignals(lines, floors: BandFloors): TurnSignal[]`, always three entries in `FLOOR_BANDS` order.

- [ ] **Step 1:** Write the tests:
  - "Signal with a full window": 250 `long` runs, the latest 200 with p95 60 and 4 exhausted → `runs` 200, `p95` 60, `exhausted` 4, `suggested` 80.
  - "Too few runs suggest nothing": 120 runs → no `suggested`.
  - "No runs": `very_long` has only `{ band, runs: 0 }`.
  - "Used over floor": 0.75.
  - "Turn signal order irrelevant".
  - "Turn signal input unchanged" (deep-equal copy).
- [ ] **Step 2:** Run `bun test tests/policy/tuning/turn-signals.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `turnSignals(lines, floors)`. `suggested` is `nextFloor(...) ?? floors[band]` when the window has 200 runs, with `bounds` from the neighbours in `floors` (no pending, no block). `usedOverFloor` is the plain mean as a number; text rounds it.
- [ ] **Step 4:** Run `bun test tests/policy/tuning`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(tuning-signals): per-band turn signals`.

---

## Task 7: Texts, report and host — implements 7

**Covers:** 7.1, 7.2, 7.3
**Difficulty:** Hard
**Blocked by:** Task 2, Task 5, Task 6

**Files:**
- Modify: `src/policy/tuning/text.ts`, `src/policy/tuning/index.ts`, `src/host/tuning/command.ts`, `src/host/tuning/step.ts` (only if types require it), `src/host/tuning/seen.ts` (only if types require it), `tests/policy/tuning/text.test.ts`, `tests/host/tuning/command.test.ts`, `tests/host/tuning/step.test.ts`, `tests/host/tuning/seen.test.ts`, `tests/host/tuning-host.test.ts`, `tests/host/tuning-fakes.ts`, `tests/host/rpc-helpers.ts`
- Create: `src/host/tuning/floor-view.ts` (`floorsView`, `floorPendingOf`, `floorBlockOf`, used by `buildTuneView`)

**Interfaces:**
- Consumes: `TuningEvent.parameter`, `UndoResult.parameter`, `turnSignals`, `Settings.turnFloors`, `TuneView` (Contracts).
- Produces:
  - `changeLine(e)` and `sessionStartLine(unseen)`, parameter-aware.
  - `undoneMessage(parameter, from, to)`.
  - `resetMessage(untuned)`, which now ends `, turn floors 40/100/200).`
  - `tuneReport(v)`, with the floor lines.

- [ ] **Step 1:** In `text.test.ts`, assert each exact text from the specs:
  - The three floor change lines.
  - "Several parameters" session line: `Jev tune since your last session: timeoutMs 1500→1900, turnFloor.long 100→80 (3 changes) · /jev tune`.
  - The floor undo message, with 400 runs.
  - The reset message.
  - `turnFloor: medium 40 · long 80 (tuned from 100) · very_long 200`.
  - `pending turnFloor.long: 100→80, 37/200 runs since`.
  - `block turnFloor.long: 80 held back for 350 more runs`.
  - The floor history line.
  - The turn signal lines, including `no runs yet`, `used/floor -` and `needs 200 runs`.
  - Every existing `timeoutMs` text is unchanged.
- [ ] **Step 2:** Run it. Expected: FAIL. Implement the `text.ts` changes. The order of report sections follows the `tune-command` "Tune report" requirement. Run again: PASS.
- [ ] **Step 3:** In `command.test.ts`, add every `tune-command` scenario that is new or changed:
  - "Not tuned" (the full new report).
  - "Floor tuned and pending", "Floor block".
  - "Turn signals shown", "Not enough runs".
  - "Floor entry named".
  - "Invalid config in the report" (floors built-in plus floor pending from the record).
  - "Malformed tuning file" (built-in floors).
  - "Undo a floor change".
  - "Reset after changes", "Reset with nothing tuned" (new text).
  - "Reset only a floor block" (`changedAt` plus block → `turnFloors` removed, no history entry).
  - "Stale tuned value" (no floor tuned).
  - Review Focus 3: floors out of order in `tuning.json` → `turnFloor:` line shows 40/100/200 without `tuned from`.
  Run them. Expected: FAIL.
- [ ] **Step 4:** Implement `src/host/tuning/floor-view.ts` and call it from `buildTuneView`:
  - `tunedFrom` is set only while the config is valid and the snapshot's resolved floor equals the tuned value.
  - Floor pending and block come from the record, using `countedRuns` counts.
  - `turnSignals` uses `snapshot.settings.turnFloors`.
  - Route `undo` and `reset` through the new transitions. `isApplied` becomes "any parameter applies".
  - Reset writes when any band state exists.

  Run `bun test tests/host/tuning`. Expected: PASS.
- [ ] **Step 5:** In `step.test.ts` and `seen.test.ts`, add:
  - "Floor applied line", "Floor superseded line", "Floor reverted line".
  - "Several parameters" at session start.
  - Review Focus 5: the floor variant of "Another process changed it first".

  Extend `tuning-fakes.ts` with `workerRuns(n, { band, used, from? })`, building valid worker ledger entries (all `WORKER_REQUIRED` fields: `v`, `at`, `kind`, `session`, `mode`, `answered`, `agent`, `briefChars`, `reason`, `status`, plus `turnsP` and `turnsUsed`). Run them. Expected: PASS when Task 5 and 7.1 are in; any failure is in `step.ts` or `seen.ts` typing, fixed there with no behaviour change.
- [ ] **Step 6:** Add `seedWorkerRuns(agentDir, n, { band, used })` to `tests/host/rpc-helpers.ts`, appending valid worker lines as above. In `tests/host/tuning-host.test.ts` (real CLI), add one test: a ledger of 200 counted `long` runs with p95 60, then a main run settles → `tuning.json` holds the `long` floor 80 with base 100 in `version` 2, one notify carries `Jev tune: turnFloor.long 100→80 · /jev tune undo`, and the Jev fixture received only the turn's own requests.
- [ ] **Step 7:** Run `bun test tests/host tests/policy && bun run typecheck && bun run lint`. Expected: PASS.
- [ ] **Step 8:** Commit `feat(tune-command): report and undo turn floors`.

---

## Task 8: ADR, docs and changelog — implements 8

**Covers:** 8.1, 8.2, 8.3
**Difficulty:** Easy
**Blocked by:** Task 7

**Files:**
- Create: `docs/decisions/0012-tuned-turn-floors.md`
- Modify: `docs/decisions/README.md`, `docs/configuration.md`, `docs/usage-guide.md`, `docs/domain-model.md`, `docs/glossary.md`, `docs/architecture.md`, `docs/roadmap.md`, `docs/workflow.md`, `docs/scenarios.md`, `CHANGELOG.md`

- [ ] **Step 1:** Write ADR 0012 in the format of ADR 0005 (Status, Context, Decision, Consequences). It records:
  - automatic decreases within ±25% (minimum move 10), the hard ranges, the order gap, and revert plus a 400-run block;
  - one applied change per step, with a cooldown per parameter;
  - p95 × 1.25 and 5% `exhausted` as first estimates, to be reviewed once 200 runs per band exist;
  - the amendment to ADR 0005.

  Link it from `docs/decisions/README.md`.
- [ ] **Step 2:** Update the docs:
  - `docs/configuration.md`: the `tuning.json` table, with `version` 1 or 2, `turnFloors` with `changedAt`/`tuned`/`pending`/`block`, and history parameters.
  - `docs/usage-guide.md`: the `/jev tune` report, the floor change lines, and the floor-aware undo and reset texts.
  - `docs/domain-model.md`: the turn floor paragraph, saying floors start at 40/100/200 and tuning moves them from counted runs.
  - `docs/glossary.md`: add **Counted run** and **Band floor**.
  - `docs/architecture.md`: the new files.
  - `docs/roadmap.md`: a line under WG-18.
  - `docs/workflow.md:145` and `docs/domain-model.md` allowlist lines: tuning covers `timeoutMs` and the three band floors.
  - `docs/scenarios.md`: floors start at 40/100/200 and are tuned from counted runs.
- [ ] **Step 3:** Add a `CHANGELOG.md` `Unreleased` entry covering tuned turn floors, turn signals, and the note that an older package reads a `version` 2 `tuning.json` as malformed.
- [ ] **Step 4:** Run `bun run typecheck && bun run lint && bun run fmt:check && bun run test`. Expected: all pass. `tests/docs-old-names.test.ts` and `tests/release.test.ts` stay green.
- [ ] **Step 5:** Commit `docs: tuned turn floors`.

---

## Scenario → test

### turn-floor-rules
- Built-in values → `tests/shared/turn-floors.test.ts` "Built-in values"
- Band by cumulative probability, Short runs not counted, Jev miss not counted, Aborted run not counted, No turn use, Not raised still counts → `tests/policy/tuning/floor-runs.test.ts` (one test each, same names)
- Too few runs, Cooldown survives a trimmed history → `tests/policy/tuning/floor-rules.test.ts`
- Other bands do not count, Input order irrelevant → `tests/policy/tuning/floor-runs.test.ts`
- Floor lowered within the step bound, Decrease bounded, Increase bounded, Exhausted runs force a raise, Exactly 5% exhausted, Hard minimum, Hard maximum, Bands stay ordered, Minimum move of 10, Unchanged value → `tests/policy/tuning/floor-rules.test.ts` `nextFloor` table rows
- Pending neighbour kept in order, Pending neighbour bounds a decrease → `floor-rules.test.ts` `nextFloor` table rows
- First floor change recorded, More exhausted reverted, Equal kept, Not yet judged, Revert a decrease → `floor-rules.test.ts`
- Blocked decrease, Blocked raise dropped, Block expired, Block after a real revert → `floor-rules.test.ts`
- Off holds floors, Timeout revert blocks a floor change → `tests/policy/tuning/rules.test.ts`
- New built-in floor → `floor-rules.test.ts`

### tuning-rules
- One applied change per step, Floor applies when timeout does not, Revert blocks every apply → `rules.test.ts` "stepTuning across parameters"
- Nothing to do, Inputs unchanged → `rules.test.ts` (existing)
- Event names its parameter → `rules.test.ts`
- Fires on timeouts, Exactly 10% does not fire, Other misses do not count, Too few asked, Unasked decisions are not counted → `rules.test.ts` `fires` (existing)
- Step of 200, p90 wins, Nearest-rank p90, Answered lines without ms, Clamped to the ceiling, Already at the ceiling → `rules.test.ts` `nextValue` and `tests/policy/tuning/window.test.ts` (existing)
- First change recorded, Second step → `rules.test.ts` `applyChange` (existing, events gain `parameter`)
- Worse is judged a revert, Equal kept, Too few asked kept, Not yet judged, Kept then the rule fires → `rules.test.ts` `evaluatePending` / `stepTuning` (existing)
- Blocked raise lowered, Blocked raise dropped, Block at the ceiling, Block expired → `rules.test.ts` `nextValue` / `blockActive` (existing)
- Inside the cooldown, Cooldown passed, Decisions before the change do not count → `rules.test.ts` (existing); Floor change does not hold back the timeout → `rules.test.ts` (new)
- Revert to the untuned value, Revert to an earlier tuned value, No fire right after a revert → `rules.test.ts` (existing)
- Operator edits config, No change right after superseding, Matching base untouched → existing; Floors kept on a config edit → `rules.test.ts` (new)
- Undo a change, Undo after a revert, Second undo, Nothing to undo → existing; Floor undo kept in order, Floor undo against a pending neighbour, Floor undo blocked by the order, Latest change undone first → `rules.test.ts` (new)
- Reset after changes → existing; Reset floors too → `rules.test.ts` (new)
- Oldest dropped → existing; Shared across parameters → `rules.test.ts` (new)

### tuning-file
- Valid file read, Seen marker read, Missing inner key, Out of range, Bad seen marker, Too much history, Unknown cause, More timeouts than asked, Bad JSON, Partly valid file is not salvaged, Value not echoed → `tests/store/tuning-file.test.ts` (existing)
- Other parameter rejected, Floor state read, Floors in a version 1 file, Floor history in a version 1 file, Written as version 2, Kept at version 1, Floor out of its band range, History value out of its parameter range, More exhausted than runs, Unknown version → `tests/store/tuning-file.test.ts` (new)

### tuning-signals
- Signal with a full window, Too few runs suggest nothing, No runs, Used over floor, Turn signal input unchanged, Turn signal order irrelevant → `tests/policy/tuning/turn-signals.test.ts`
- Input unchanged → `tests/policy/tuning/signals.test.ts` (existing)
- Signals never tune → `tests/host/tuning-host.test.ts` "Signals never tune" (existing)

### tune-command
- Floors not tuned, Floor tuned and pending, Floor block, Turn signals shown, Not enough runs, Floor entry named → `tests/policy/tuning/text.test.ts` and `tests/host/tuning/command.test.ts`
- Not tuned, Pending change, Active block, Config edited → `tests/host/tuning/command.test.ts` (Not tuned updated, others existing)
- History newest first, Only five shown → `tests/policy/tuning/text.test.ts` (existing)
- Unreadable ledger, Unreadable tuning file in the report, Pending count capped → `command.test.ts` (existing); Invalid config in the report, Malformed tuning file → `command.test.ts` (updated)
- Undo a change, Nothing to undo, Undo without a UI → existing (`command.test.ts`, `tuning-host.test.ts`); Stale tuned value → updated; Undo a floor change → `command.test.ts` (new)
- Reset after changes, Reset with nothing tuned → `command.test.ts` (updated text); Invalid config → existing; Reset only a floor block → `command.test.ts` (new)

### tuning-host
- Tuned floor written, Lowered floor never lowers a limit, Bad tuning file uses built-in floors, Jev miss writes no floor → `tests/host/worker-routing.test.ts`
- Applied line, Reverted line, Superseded line, Kept is silent → `tests/host/tuning/step.test.ts` (existing)
- Floor applied line → `tests/host/tuning-host.test.ts` (real CLI) and `step.test.ts`; Floor superseded line, Floor reverted line → `step.test.ts`
- One unseen change, Several unseen changes, Changes that cancel out, Shown once → `tests/host/tuning/seen.test.ts` (existing); Several parameters → `seen.test.ts` and `text.test.ts`

### settings-resolution
- Built-in floors, Tuned floor applies, Base differs from the built-in floor, Out of range ignored, Order broken → `tests/store/settings-sections.test.ts`
- Non-integer tuning ignored, Out-of-range tuning ignored, Config edited after tuning, Tuned from the default, Invalid base ignored, Missing base ignored → `tests/store/settings-sections.test.ts` / `settings.test.ts` (existing)

### worker-decision
- Long by majority, Thin tail does not raise, Cumulative at the bar, Choice is not enough, Very long, Probabilities not normalised, Unanswered → `tests/policy/worker/turns.test.ts` (existing, with `BUILTIN_FLOORS`)
- Tuned floors passed in → `tests/policy/worker/turns.test.ts` (new)
