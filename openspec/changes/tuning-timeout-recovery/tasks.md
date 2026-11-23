## 1. Window helpers and measured p90

Blocked by: none

- [ ] 1.1 In `src/policy/tuning/window.ts`, make `p90` count decisions that are answered or have `miss` `timeout` and carry a finite `ms`; add `latestAsked(ds, n)` (the latest `n` asked decisions, oldest first) and `rescued(ds, from)` (some answered decision has `ms > from`)
- [ ] 1.2 Tests in `tests/policy/tuning/window.test.ts`: "Answered lines without ms" (modified), "Timeouts count in p90", "Other misses not in p90", and `latestAsked` and `rescued` cases; keep "Nearest-rank p90" green

## 2. Burst rule, lowering and judging in the pure step

Blocked by: 1

- [ ] 2.1 Add the constants of design D8 to `TUNING` in `src/policy/tuning/record.ts`
- [ ] 2.2 Add the leaf module `src/policy/tuning/timeout-change.ts` (shared step types, `applyChange`, rounding, block direction and lifetime) and `src/policy/tuning/timeout-rules.ts` with `burstRule` (design D2: window after the latest `timeoutMs` entry, 3 of 5 asked timeouts, `ceil100(current × 1.25)` clamped, replaces a pending change, clears the block, `before` from the latest 40 decisions) and `lowerRule` (design D6), both returning `StepResult`; move the shared `applyChange` helper so it can record a `before` and optionally clear the block
- [ ] 2.3 In `src/policy/tuning/rules.ts`, add block direction and lifetime (design D5: reference value from the record, raise block 200, lowering block 400, equal holds nothing): `nextValue` uses only a raise block, and a lowering block raises a lowering to `value + 100`; `evaluatePending` keeps a raise on a rescued answer, reverts a lowering on any timeout among at least 20 asked, and drops a kept tuned value equal to its base (design D4)
- [ ] 2.3b Make undo skip `rule` entries already reversed by a later `undo` entry (design D7b) in `ruleOrigin` (`src/policy/tuning/floor-step.ts`), shared by `timeoutMs` and band floors
- [ ] 2.4 Rewrite the apply phase of `stepTuning` as burst rule → window rule → lowering → band floors, at most one `applied`, nothing after a revert; let the burst rule run while a `timeoutMs` change is pending and fewer than 40 decisions follow it
- [ ] 2.5 Tests in `tests/policy/tuning/rules.test.ts` (and a new `tests/policy/tuning/timeout-rules.test.ts` for the two rules): one test per new or modified `tuning-rules` scenario (Pure tuning step, Decisions counted by time, Burst rule, Lowering, The new value, Applying a change, Cooldown, Evaluating a pending change, Block after a revert or an undo, Config edit supersedes tuning, Undo, Step order across parameters), recomputing every number from the spec; keep existing tests green except the scenarios named as intentionally changed; add an inputs-unchanged check for a burst step and a lowering step

## 3. Texts and tune command

Blocked by: 2

- [ ] 3.1 In `src/policy/tuning/text.ts`: the reverted lowering change line (`to` above `from` → `reverted: timeouts came back`), the undo message by direction (`The same lowering is held back for 400 decisions.` when the undo moves the value up), and the block line by direction (`lowerings to <v> or below`); add `direction: "raise" | "lower"` to `TuneView["block"]`
- [ ] 3.2 In `src/host/tuning/command.ts`, set the block direction and remaining count from the block value and the reference value (tuned value in the record, else the untuned value), show no block line for an equal block, and keep showing it while the config is invalid
- [ ] 3.3 Tests: `tests/policy/tuning/text.test.ts` with the exact new texts; `tests/host/tuning/command.test.ts` for "Lowering block", "Lowering block while the config is invalid", "Block equal to the reference not shown" and "Undo a lowering", keeping the existing `tune-command` tests green
- [ ] 3.4 In `tests/host/tuning-host.test.ts`, through the real CLI and the loopback Jev fixture: "Lowering reverted line" (seed a pending lowering with 40 judged decisions holding a timeout) and "Burst applied line" (seed `tuning.json` 1700 with a `rule` entry, then 3 hanging turns); keep "Rule fires at settle" green unchanged (its seed puts the 9 timeouts first, so the latest 5 asked hold 1 timeout and the burst rule does not fire)

## 4. ADR, docs and changelog

Blocked by: 3

- [ ] 4.1 Add `docs/decisions/0013-fast-timeout-tuning.md` (amends ADR 0005: burst rule ignores cooldown and block, rescue evidence in judging, measured p90, lowering after 200 clean decisions, thresholds as first estimates, evidence from the 2026-11-21 to 2026-11-23 ledger without prompt text); add the amended-by link in `docs/decisions/0005-bounded-auto-tuning.md` and the row in `docs/decisions/README.md`
- [ ] 4.2 Update `docs/usage-guide.md` Tuning (new lines, burst and lowering limits, lowering undo text), and `docs/configuration.md`, `docs/glossary.md`, `docs/domain-model.md`, `docs/architecture.md` (new `timeout-rules.ts`) wherever they state the timeout rules; add an `Unreleased` entry to `CHANGELOG.md`
- [ ] 4.3 Run `bun run typecheck`, `bun run lint`, `bun run fmt:check` and `bun run test`; all pass
