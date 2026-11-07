# Apply Receipt

> Generated at the end of the apply phase to mark code-implementation
> complete and provide verify with the state it needs.
> Overwritten on each apply iteration; iteration counter grows.

**Change**: `wg-13-slots`
**Iteration**: `1`
**Applied at**: `2026-11-07 06:05` (UTC, `2026-11-07T06:05:45Z`)
**Executor**: `subagent-driven-development` (implementer `superspec.implementer`, per-task and whole-branch review `superspec.task-reviewer`)

---

## Workspace

- **Worktree path**: `/Users/naicoi/Projects/oss/pi-jev-pilot.wg-13-slots`
- **Worktree branch**: `wg-13-slots`
- **Feature branch**: `WG-13`
- **Base branch**: `main`

---

## Commits

- **Range**: `cade81f..5c4cab9` (implementation, tick commits, one contract-name note and one final-review fix wave; this receipt commit follows). Merge-base with `origin/main` is `00a9231`; `cade81f` is the step 0 scaffold commit on `WG-13`.
- **Count**: `18`

---

## Tasks

- **Completed**: `13 of 13` checkboxes in tasks.md flipped to `- [x]`
- **Remaining**: none

Reviews:
- Plan tasks 1 to 8 each passed their task review with no Critical or Important finding.
- The whole-branch review returned **Ready to merge: Yes**. One fix wave (`5c4cab9`) handled four Minor findings: a shared `slotName` helper, a comment on the `resolveModel` cast, splitting a test that covered two scenarios, and import order. The scoped re-review returned PASS.
- Before apply, the feature branch was rebased onto `origin/main` (which now has WG-10 and WG-17). The new code is separate from WG-13's seams. The slot command branch returns before the status and tally output.

Fresh check at `5c4cab9`:
- `bun run typecheck`, `bun run lint` and `bun run fmt:check` are clean.
- `bun test` passes 1238 tests with 0 failures. The baseline was 1127 after the rebase.
- `openspec validate wg-13-slots --strict` reports the change as valid.
- The issue #14 done-when items are covered by host tests that run the real Pi CLI and executor against a loopback Jev, in `tests/host/worker-routing.test.ts`:
  - "Review launch on the reviewer slot" and "Background review launch" show the reviewer slot routes.
  - "Unusable reviewer slot falls back" shows an unusable slot falls back to `balanced`.
  - "Jev down with a slot configured" covers Jev being unavailable.
  - The pure test "Slot never moves up" and `firstRunning` together guarantee `expert` is never a fallback target.

Parked minors (the final review triaged none as must-fix):
- T1: a whitespace-only `when` is not tested on the write path. The validator is shared with the read path, which is tested.
- T2: `isSlot` and `slotTarget` accept an empty name. This is unreachable, because names come from validated config.
- T3: `decideFromTierChoice` keeps the pre-existing `picked as TierName` cast.
- T4: `chooseFallback` defaults `slots` and `launchKind` defaults `slotCount`; the plan mandated these defaults. One test has a redundant `slotModels` entry.
- T5: the test "Main request with a slot configured" is vacuous by construction.
- T6: two tests duplicate the `slotAnswer` helper. "Slot removed before the tool call" could also assert the thinking level.
- T7: `remove <reserved>` gives the bare usage text. One test combines two replace scenarios. `parseSlotArgs` uses non-null assertions that the regex guarantees.
- T8: the print-mode test does not assert empty stdout, though nothing in that path writes stdout. The usage-guide sentence "Forms without a work-group mark work now" could name `tune`.
- Baseline `openspec/specs/` keeps the old wording (optional `when`, tier-only options) until the archive sync applies the deltas.

Rulings made during apply:
- Pre-flight: the plan still applied after the rebase onto WG-10 and WG-17, because the new code is orthogonal. Cost if wrong: a small merge fix in Task 8. It did not materialize.
- Task 3: the "Recorded results" route test temporarily excluded `slot`. Task 4 then restored it and added a slot case. Cost if wrong: one missing test. It was resolved in Task 4.
- Task 5: `checkModel` now reports `not a provider/model` for a malformed tier id in `worker.ts`. This path is unreachable, because config validates `provider/id` and unset tiers are not offered. Cost if wrong: one wording difference in a warning.

---

## Contract deviations

> Contracts changed during apply, each with its reason. Cumulative:
> keep entries from earlier iterations. Write `none` if there are none.

- `EffortInput.tier` (internal): the plan named the type `WorkerEffortInput`. The existing type is `EffortInput`, so that name was kept. Recorded in plan.md.
- `isSlot` (internal): its parameter was widened from `Target` to `string` so it can narrow a raw `tier.choice`. It is still a type guard to `SlotTarget`, and callers are unaffected. This came from the final-review fix wave.
- `slotName(target: SlotTarget): string` (internal, new): added in `src/policy/launch.ts` so the slot prefix lives in one module. This came from the final-review fix wave.
- `fixtureModelsJson` (test-only): the keyless provider also gained `fixture-review-keyless`, which the unusable-slot host test needs.

---

## Next step

Run `/opsx-verify wg-13-slots` in the worktree `/Users/naicoi/Projects/oss/pi-jev-pilot.wg-13-slots`.
