# Tuning Timeout Recovery Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md`.

**Goal:** Make `timeoutMs` tuning raise within 3 timed-out decisions, keep raises that rescued answers, lower a tuned value after a clean stretch, and make repeated undo walk back through history.

**Architecture:** The pure step in `src/policy/tuning/` gains a burst rule and lowering in a new module `timeout-rules.ts`. Shared timeout-change helpers move to a new leaf module, `timeout-change.ts`. Judging becomes rescue- and direction-aware, the block direction and lifetime are derived from the record, and `ruleOrigin` skips undone rules. The host and `tuning.json` stay as they are, except for direction-aware texts in `text.ts` and `command.ts`.

**Tech Stack:** TypeScript, Bun (`bun test`), oxlint (max 50 lines per function, complexity 12, see `.oxlintrc.json`), oxfmt.

## Global Constraints

- `policy/` stays pure: no I/O, no Jev call, inputs never mutated (`tuning-rules` "Pure tuning step").
- `tuning.json` format unchanged: version 1 or 2, causes `rule|revert|undo|reset|superseded`, timeout values 300–5000, `before.asked`/`timeouts` 0–40.
- One `applied` event per step; nothing applied in a step that reverted.
- Exact texts, `→` is U+2192.
- Tests need no secrets, paid calls or network beyond loopback.
- Read and apply `~/.agents/skills/coding-standards/SKILL.md`. `rules.ts` (282 lines) must not grow; new logic goes to `timeout-change.ts` and `timeout-rules.ts`.

## Review Focus

- Worker lines from another session among the latest decisions: they count in the burst window, since both kinds use the tuned timeout (design Context). Pinned in Task 2, Step 3.
- Timed-out lines without `ms` (older ledgers): excluded from p90, but still counted as asked and as timeouts. Pinned in Task 1.
- A hand-edited `tuning.json` with a block equal to the reference: holds nothing, no crash. Pinned in Task 2, Step 5 and Task 3, Step 3.
- Repeated settles with no new decisions after a burst: no second burst on the same timeouts. Pinned in Task 2, Step 3.
- Undo right after a burst that replaced a pending change: undo goes to the burst's `from` and blocks the burst value. Pinned in Task 2, Step 3.

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `TUNING` (`src/policy/tuning/record.ts`) | modified | adds `burstWindow: 5, burstTimeouts: 3, burstFactor: 1.25, lowerAfter: 200, lowerMinAsked: 100, lowerFactor: 1.5, lowerStep: 0.8, lowerBlockFor: 400`; existing keys unchanged (`blockFor: 200` stays the raise block lifetime) | no |
| `p90(ds: readonly DecisionLine[]): number \| undefined` (`window.ts`) | modified | counts lines with `answered === true` or `miss === "timeout"` and a finite `ms` | no |
| `latestAsked(ds: readonly DecisionLine[], n: number): DecisionLine[]` (`window.ts`) | new | the latest `n` asked lines of `decisions(ds)`, oldest first | no |
| `rescued(ds: readonly DecisionLine[], from: number): boolean` (`window.ts`) | new | true when some line has `answered === true` and `ms > from` | no |
| `StepInput`, `StepResult`, `ceilTo`, `clamp`, `timeoutEntry`, `applyChange(record, c: { from: number; to: number; base: number; before: Counts; now: number; clearBlock?: boolean }): TuningRecord` (`timeout-change.ts`) | moved + modified | moved unchanged from `rules.ts` (`entry` renamed `timeoutEntry`); `applyChange` replaces any `pending` and drops `block` when `clearBlock`; `rules.ts` re-exports `applyChange`, `StepResult` and `StepInput` | no |
| `blockReference(record: TuningRecord, untuned: number): number` (`timeout-change.ts`) | new | `record.timeoutMs?.value ?? untuned` | no |
| `blockDirection(block: { value: number }, reference: number): "raise" \| "lower" \| undefined` (`timeout-change.ts`) | new | `raise` if `value > reference`, `lower` if `<`, else `undefined` | no |
| `activeBlock(record: TuningRecord, untuned: number, ds: readonly DecisionLine[]): { value: number; direction: "raise" \| "lower"; remaining: number } \| undefined` (`timeout-change.ts`) | new | direction from `blockReference`; lifetime `TUNING.blockFor` (raise) or `TUNING.lowerBlockFor` (lower); `remaining = lifetime − after(ds, at).length`, undefined when ≤ 0 or no direction | no |
| `blockActive(block, ds)` (`rules.ts`) | kept | still exported for floor-free callers; timeout code uses `activeBlock` | no |
| `burstRule(input: StepInput, record: TuningRecord): StepResult`, `lowerRule(input: StepInput, record: TuningRecord): StepResult`, `lowerValue(current: number, base: number, p90: number, block: { value: number } \| undefined): number \| undefined` (`timeout-rules.ts`) | new | design D2, D6 | no |
| `ruleOrigin(history, parameter, value)` (`floor-step.ts`) | modified | skips a `rule` entry reversed by a later `undo` of the same parameter (`undo.from === rule.to && undo.to === rule.from`) | no |
| `TuneView["block"]` (`text.ts`) | modified | `{ value: number; remaining: number; direction: "raise" \| "lower" }` | no |
| `undoneMessage(parameter, from, to)` (`text.ts`) | modified | same signature; `timeoutMs` with `to > from` → lowering text (400 decisions) | no |
| Change line, undo message, block state line | modified | exact texts in `specs/tuning-host` and `specs/tune-command` | yes (user-visible strings) |

**Import graph (acyclic):** `record.ts` ← `window.ts` ← `timeout-change.ts` ← `timeout-rules.ts` ← `rules.ts`; `floor-step.ts` stays imported by `rules.ts` only. `timeout-rules.ts` never imports `rules.ts`.

---

## Task 1: Window helpers and measured p90 — implements 1

**Covers:** 1.1, 1.2
**Difficulty:** Easy
**Blocked by:** none

**Files:**
- Modify: `src/policy/tuning/window.ts`
- Test: `tests/policy/tuning/window.test.ts`

**Interfaces:**
- Produces: `p90` (modified), `latestAsked`, `rescued` (see Contracts).

- [ ] **Step 1: Write failing tests** in `tests/policy/tuning/window.test.ts`:
  - `Answered lines without ms` (rewrite): 20 answered with `ms` 100..2000, 10 answered without `ms`, 10 `{answered:false, miss:"timeout"}` without `ms` → `p90` 1800; `counts` gives asked 40, timeouts 10.
  - `Timeouts count in p90`: 34 answered with `ms` 300..1300, 6 `{answered:false, miss:"timeout", ms:1702}` → `p90` 1702.
  - `Other misses not in p90`: 36 answered with `ms` 500, 4 `{answered:false, miss:"error", ms:3000}` → 500.
  - `latestAsked`: timeout, unasked, timeout, unasked, timeout (by `at`) with n 5 → the 3 timeouts in `at` order; 7 asked lines with n 5 → the latest 5.
  - `rescued`: answers 1650 and 1700 with `from` 1700 → false; adding 1701 → true; a timeout with `ms` 1900 → false.
- [ ] **Step 2: Run** `bun test tests/policy/tuning/window.test.ts` → the new tests FAIL.
- [ ] **Step 3: Implement** in `window.ts`: widen the `p90` filter; `latestAsked = decisions(ds).filter(isAsked).slice(-n)`; `rescued`.
- [ ] **Step 4: Run** `bun test tests/policy/tuning/` → PASS.
- [ ] **Step 5: Commit** `feat(tuning-rules): count timeouts in p90 and add window helpers`.

---

## Task 2: Burst rule, lowering, judging and undo — implements 2

**Covers:** 2.1, 2.2, 2.3, 2.3b, 2.4, 2.5
**Difficulty:** Hard
**Blocked by:** Task 1

**Files:**
- Modify: `src/policy/tuning/record.ts`, `src/policy/tuning/rules.ts`, `src/policy/tuning/floor-step.ts` (`ruleOrigin`), `src/policy/tuning/index.ts` (export `activeBlock`, `blockDirection`, `blockReference`)
- Create: `src/policy/tuning/timeout-change.ts`, `src/policy/tuning/timeout-rules.ts`
- Test: `tests/policy/tuning/rules.test.ts`, `tests/policy/tuning/step-floors.test.ts`, create `tests/policy/tuning/timeout-rules.test.ts`

**Interfaces:**
- Consumes: `p90`, `latestAsked`, `rescued`, `counts`, `decisions`, `after`, `shareAbove` (`window.ts`); `latestEntryAt`, `pushHistory`, `TUNING` (`record.ts`).
- Produces: everything in Contracts from `timeout-change.ts`, `timeout-rules.ts`, and the modified `ruleOrigin`.

- [ ] **Step 1: Contract test.** Update "constants are the contract values" in `rules.test.ts` to the new `TUNING`; run → FAIL; add the constants → PASS.
- [ ] **Step 2: Move helpers.** Create `timeout-change.ts` with `StepInput`, `StepResult`, `ceilTo`, `clamp`, `timeoutEntry` and `applyChange` moved from `rules.ts`, and re-export from `rules.ts`. Run `bun test tests/policy/tuning/` → PASS, no behaviour change. Commit `refactor(tuning-rules): move timeout change helpers to a leaf module`.
- [ ] **Step 3: Write failing burst tests** in `timeout-rules.test.ts` (call `stepTuning` unless noted), one per scenario:
  - Three timeouts in a row: 1700 → 2200.
  - Three of the latest five.
  - Two of five do not fire.
  - Older timeouts do not count.
  - Unasked decisions skipped.
  - Block ignored: block 1900 with 22 decisions after it → 2200, and `record.block` is undefined.
  - Steps under sustained timeouts: loop, appending 3 timeouts after each new entry → 2200, 2800, 3500, 4400, 5000.
  - Burst at the ceiling.
  - Burst over a pending change: 10 asked, last 3 timed out → a single `applied` 1700→2200; pending `{from:1700,to:2200}`; no `kept` or `reverted`.
  - Burst clears the block.
  - Burst before counts: the latest 40 decisions hold 38 asked and 12 timeouts → `before` `{asked:38,timeouts:12}`.
  - Review Focus pins:
    - The same lines stepped again on the burst's output record give no events.
    - `undoTuning` right after a burst-over-pending gives `undo` 2200→1700 with a block at 2200.
    - 3 timed-out `worker` lines from session `w` fire the burst.
- [ ] **Step 4: Write failing lowering tests** in `timeout-rules.test.ts`:
  - Lowered after a clean stretch: 3000, p90 1270 → 2400.
  - p90 limits the step: p90 1900 → 2900.
  - Not below the base: 1700, p90 500 → 1500.
  - A timeout stops lowering.
  - Too soon: 199 answered.
  - Too few asked (lowering): 99 asked.
  - Untuned value never lowered.
  - Inputs unchanged for a lowering step: deep-equal copies before and after.
  - The same check for a burst step.
- [ ] **Step 5: Write failing tests** for the modified requirements:
  - In `rules.test.ts`:
    - Pure tuning step: "Nothing to do" with 10 answered decisions.
    - Decisions counted by time: "Correction lines ignored" with timed-out corrections and 39 answered decisions.
    - The new value: "Timeouts count in p90" through `stepTuning` (1700 → 2200).
    - Cooldown:
      - "Inside the cooldown": 2 timeouts and 37 unasked → no `applied`.
      - "Burst inside the cooldown".
      - "Decisions before the change do not count": 20 answered after.
    - Evaluating a pending change:
      - "Worse is judged a revert".
      - "Rescued answer keeps a raise": events start with `kept` 1700→1900; no `reverted`.
      - "Answer at the old value is no rescue": 1700 ms → `reverted`.
      - "Worse lowering reverted".
      - "Lowering with an empty before": `before` 0/0, 20 asked, 1 timeout → `reverted` 2400→3000.
      - "Lowering at base clears the tuned value once kept": pending 1700→1500, 40 answered in 500 ms → `kept`, `record.timeoutMs` undefined.
      - "Not yet judged": 39 answered.
    - Config edit supersedes tuning: "No change right after superseding", covering both the window and the burst rule.
    - Undo: "Repeated undo walks back through a lowering" (three undos → 3000, 2400, 1900) and "Repeated identical transitions undone one at a time" (three undos → 2400, 3000, 2400).
  - In `timeout-rules.test.ts`:
    - Block:
      - "Blocked lowering raised": revert a lowering at 1000, then 250 clean decisions → 2500.
      - "Blocked lowering dropped".
      - "Raise block does not hold back a lowering": a hand-edited record with the latest `timeoutMs` entry before 200 clean decisions and the block 3500 set after 50 of them.
      - "Lowering block expired": 400 decisions → 2400.
      - "Block equal to the reference holds back nothing": no tuned value, block 1700, untuned 1700, window rule computes 1900 → 1900.
    - `activeBlock` at 399 and 400 decisions for a lowering block, and at 199 and 200 for a raise block.
  - In `step-floors.test.ts`:
    - "Burst before the window rule".
    - "Revert blocks every apply": change the expectation to cover a burst that would fire.
    - "One applied change per step": change the fixture `bandRuns("long", 40, 1001, 190)` to place the 10 timeouts at indices 160–169 (latest 5 asked hold none), so the window rule still yields 1500→1700.
- [ ] **Step 6: Run** `bun test tests/policy/tuning/` → the new tests FAIL. The only existing tests allowed to fail are those of scenarios named as intentionally changed, plus the `step-floors` fixture in Step 5.
- [ ] **Step 7: Implement `timeout-change.ts` block helpers** (`blockReference`, `blockDirection`, `activeBlock`). In `rules.ts`, make `fireRule` pass `activeBlock(...)` to `nextValue` only when `direction === "raise"`.
- [ ] **Step 8: Implement `timeout-rules.ts`:**
  - `burstRule` (design D2): `since = after(decisions(lines), latestEntryAt(history,"timeoutMs"))`; fire when `latestAsked(since, 5)` holds ≥ 3 timeouts; `to = clamp(ceilTo(current × 1.25, 100))`; `before = counts(decisions(lines).slice(-40))`; `applyChange({..., clearBlock: true})`.
  - `lowerValue` (design D6).
  - `lowerRule` (design D6 guards; `before` from the latest 40 decisions; the `lower` block from `activeBlock`).
- [ ] **Step 9: Update `evaluatePending`** in `rules.ts`, in a helper `judgeTimeout(pending, judged): "kept" | "reverted"`:
  - lowering (`to < from`) → reverted iff `asked ≥ 20 && timeouts > 0`;
  - raise → kept if `rescued(judged, from)`, else the existing `shareAbove` rule.
  - A kept change with `to === timeoutMs.base` drops `timeoutMs`.
- [ ] **Step 10: Update `ruleOrigin`** in `floor-step.ts`: walk history newest first, collect `undo` entries of the parameter, and skip a `rule` whose `(to, from)` equals a later, not yet consumed undo's `(from, to)`, consuming that undo (one to one, newest first). Keep the floor undo tests green.
- [ ] **Step 11: Rewrite the apply phase** of `stepTuning`: after supersede and judging, and only without a revert, run `firstApplied([burstRule, fireRule, lowerRule])`, then `applyFirstFloor`. Run `burstRule` even while a change is pending. `fireRule` and `lowerRule` skip while one is pending. Pass `untuned` through `StepInput` so `activeBlock` gets its reference.
- [ ] **Step 12: Run** `bun test tests/policy/tuning/` → PASS; `bun run typecheck && bun run lint` → PASS.
- [ ] **Step 13: Commit** `feat(tuning-rules): burst rule, lowering, rescue-aware judging and undo walk-back`.

---

## Task 3: Texts and tune command — implements 3

**Covers:** 3.1, 3.2, 3.3, 3.4
**Difficulty:** Normal
**Blocked by:** Task 2

**Files:**
- Modify: `src/policy/tuning/text.ts`, `src/host/tuning/command.ts`, `tests/host/rpc-helpers.ts` (optional `from` for `seedLedger`)
- Test: `tests/policy/tuning/text.test.ts`, `tests/host/tuning/command.test.ts`, `tests/host/tuning-host.test.ts`

**Interfaces:**
- Consumes: `activeBlock`, `blockReference` (Task 2).
- Produces: `TuneView["block"].direction`, direction-aware `changeLine` and `undoneMessage` (see Contracts).

- [ ] **Step 1: Write failing text tests:**
  - `changeLine({kind:"reverted",parameter:"timeoutMs",from:2400,to:3000})` → `Jev tune: timeoutMs 2400→3000, reverted: timeouts came back · /jev tune`; 1700→1500 is unchanged.
  - `undoneMessage("timeoutMs", 2400, 3000)` → `Jev tune: timeoutMs 2400→3000 undone. The same lowering is held back for 400 decisions.`; 1700→1500 is unchanged.
  - Report with `block {value:2400, remaining:350, direction:"lower"}` → `block: lowerings to 2400 or below held back for 350 more decisions`; with `direction:"raise"` the existing line is unchanged.
- [ ] **Step 2: Run** `bun test tests/policy/tuning/text.test.ts` → FAIL. Implement in `text.ts`: split the reverted reason by direction, and `timeoutStateLines` by `direction` → PASS.
- [ ] **Step 3: Write failing command tests** in `tests/host/tuning/command.test.ts`:
  - "Lowering block": value 3000, base 1500, block 2400 at 1000, 50 decisions after it → `... held back for 350 more decisions`.
  - "Lowering block while the config is invalid": the same report, plus `tuning paused: config error`.
  - "Block equal to the reference not shown": no tuned value, block 1700, config 1700 → no `block:` line.
  - "Undo a lowering": value 2400, history `rule` 1500→3000 and `rule` 3000→2400 → the file holds value 3000 and block 2400, with the 400-decision text.
- [ ] **Step 4: Implement** in `command.ts`: `blockOf(record, ds, untuned)` returns `activeBlock(record, untuned, ds)` mapped to the view; `untuned` is `snapshot.untunedTimeoutMs`. Run → PASS, with existing `tune-command` tests green.
- [ ] **Step 5: Add `from?: number`** to `seedLedger` options in `tests/host/rpc-helpers.ts` (default `Date.now() - 100_000`) so a test can place `pending.at` before the seed. Write host tests in `tests/host/tuning-host.test.ts`:
  - "Lowering reverted line": `seedLedger(agentDir, 40, { misses: 1, from: T })`, the timeout first. `tuning.json` version 1 holds value 2400, base 1500, pending `{from:3000,to:2400,at:T-1,before:{asked:40,timeouts:0}}`, and history `rule` 1500→3000 at `T-3` and `rule` 3000→2400 at `T-1`. After one answered turn settles, expect the notify `Jev tune: timeoutMs 2400→3000, reverted: timeouts came back · /jev tune`.
  - "Burst applied line": `tuning.json` holds value 1700, base 1500, a `rule` entry 1500→1700, and `seenAt` at or after that entry (so no session-start line). Run 3 turns on the `HANG` route; after the third, the tuning notifies equal exactly `[Jev tune: timeoutMs 1700→2200 · /jev tune undo]`.
- [ ] **Step 6: Run** `bun test tests/host/tuning-host.test.ts tests/host/tuning/` → PASS, with "Rule fires at settle" unchanged (its 9 timeouts come first and carry no `ms`).
- [ ] **Step 7: Commit** `feat(tune-command): direction-aware tuning texts`.

---

## Task 4: ADR, docs and changelog — implements 4

**Covers:** 4.1, 4.2, 4.3
**Difficulty:** Easy
**Blocked by:** Task 3

**Files:**
- Create: `docs/decisions/0013-fast-timeout-tuning.md`
- Modify: `docs/decisions/0005-bounded-auto-tuning.md`, `docs/decisions/README.md`, `docs/usage-guide.md`, `docs/configuration.md`, `docs/glossary.md`, `docs/domain-model.md`, `docs/architecture.md`, `CHANGELOG.md`

- [ ] **Step 1:** Write ADR 0013 in the style of 0012.
  - **Context:** aggregate ledger numbers from 2026-11-14 to 2026-11-23 only (daily p50 and timeout counts, three raise/revert cycles, rescued answers), no prompt text.
  - **Decision:** design D2–D7b.
  - **Consequences:** the risks in design; the thresholds (3 of 5, ×1.25, 200/100, ×1.5, ×0.8, 400) are first estimates.

  Add "Amended by 0013" to 0005 and a row to the decisions README.
- [ ] **Step 2:** In `docs/usage-guide.md` Tuning, add:
  - the two new example lines (`reverted: timeouts came back`, and a burst raise such as `timeoutMs 1700→2200`);
  - the Limits paragraph: burst on 3 of the latest 5, lowering after 200 clean decisions, a lowering block of 400 decisions, and undo that walks back.
- [ ] **Step 3:** In `docs/architecture.md`, add `timeout-change.ts` and `timeout-rules.ts` to the `tuning/` tree. Update `docs/configuration.md`, `docs/glossary.md` and `docs/domain-model.md` wherever they state the 40-decision rule or raise-only tuning (`rg -n "40 decisions|40-decision|raise|lower" docs`).
- [ ] **Step 4:** Add a `CHANGELOG.md` `Unreleased` → `Changed` entry: faster timeout tuning, lowering, rescue-aware judging, and the new tune lines.
- [ ] **Step 5:** Run `bun run typecheck`, `bun run lint`, `bun run fmt:check` and `bun run test` → all pass.
- [ ] **Step 6: Commit** `docs(tuning): ADR 0013 and usage for fast timeout tuning`.

---

## Scenario → test

Files: `R` = `tests/policy/tuning/rules.test.ts`, `T` = `tests/policy/tuning/timeout-rules.test.ts`, `F` = `tests/policy/tuning/step-floors.test.ts`, `W` = `tests/policy/tuning/window.test.ts`, `X` = `tests/policy/tuning/text.test.ts`, `C` = `tests/host/tuning/command.test.ts`, `H` = `tests/host/tuning-host.test.ts`. "existing" means the test is kept unchanged.

**tuning-rules**
- Pure tuning step: Nothing to do → R (modified); Inputs unchanged → R (existing) + T "Inputs unchanged" (burst, lowering); Event names its parameter → R (existing)
- Decisions counted by time: Correction lines ignored → R (modified); Line order does not matter → R (existing)
- Burst rule: Three timeouts in a row, Three of the latest five, Two of five do not fire, Older timeouts do not count, Unasked decisions skipped, Block ignored, Steps under sustained timeouts, Burst at the ceiling, Burst over a pending change → T (same names)
- Lowering: Lowered after a clean stretch, p90 limits the step, Not below the base, A timeout stops lowering, Too soon, Too few asked, Untuned value never lowered → T (same names); Lowering at base clears the tuned value once kept → R
- The timeout rule: Fires on timeouts, Exactly 10% does not fire, Other misses do not count, Too few asked, Unasked decisions are not counted → R `describe("fires")` (existing)
- The new value: Step of 200, p90 wins, Clamped to the ceiling, Already at the ceiling → R `describe("nextValue")` (existing); Nearest-rank p90 → W (existing); Answered lines without ms → W (modified); Timeouts count in p90 → W + R; Other misses not in p90 → W
- Applying a change: First change recorded, Second step → R (existing); Burst clears the block, Burst before counts → T
- Cooldown: Inside the cooldown → R (modified); Burst inside the cooldown → R; Cooldown passed → R (existing); Decisions before the change do not count → R (modified); Floor change does not hold back the timeout → F (existing)
- Evaluating a pending change: Worse is judged a revert → R (modified); Rescued answer keeps a raise, Answer at the old value is no rescue, Worse lowering reverted, Lowering with an empty before → R; Equal, kept; Too few asked, kept; Kept, then the rule fires → R (existing); Not yet judged → R (modified)
- Block after a revert or an undo: Blocked raise lowered, Blocked raise dropped, Block at the ceiling, Block expired → R `describe("nextValue")` and `describe("blockActive")` (existing); Blocked lowering raised, Blocked lowering dropped, Raise block does not hold back a lowering, Lowering block expired, Block equal to the reference holds back nothing → T
- Config edit supersedes tuning: Operator edits config, Matching base untouched, Floors kept on a config edit → R / F (existing); No change right after superseding → R (modified)
- Undo: Undo a change, Undo after a revert, Second undo, Nothing to undo → R (existing); Floor undo kept in order, Floor undo against a pending neighbour, Floor undo blocked by the order, Latest change undone first → F (existing); Repeated undo walks back through a lowering, Repeated identical transitions undone one at a time → R
- Step order across parameters: One applied change per step → F (fixture modified, same expectation); Burst before the window rule → F; Floor applies when timeout does not → F (existing); Revert blocks every apply → F (modified)

**tune-command**
- Tune report state lines: Neither pending nor blocked → C (existing); Lowering block → C + X; Lowering block while the config is invalid → C; Block equal to the reference not shown → C
- Tune undo: Undo a change, Nothing to undo, Stale tuned value, Undo a floor change → C (existing); Undo without a UI → H (existing); Undo a lowering → C + X

**tuning-host**
- Tuning step at agent_settled: Rule fires at settle → H (existing; seed already puts 9 timeouts without `ms` first); No Jev call → H (existing)
- Change line texts: Applied line, Reverted line, Superseded line, Kept is silent, Floor applied line, Floor superseded line, Floor reverted line → H and `tests/host/tuning/step.test.ts` (existing); Lowering reverted line, Burst applied line → H
