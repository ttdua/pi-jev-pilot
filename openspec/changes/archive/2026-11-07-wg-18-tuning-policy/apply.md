# Apply Receipt

> Generated at the end of the apply phase to mark code-implementation
> complete and provide verify with the state it needs.
> Overwritten on each apply iteration; iteration counter grows.

**Change**: `wg-18-tuning-policy`
**Iteration**: `1`
**Applied at**: `2026-11-07T10:30:00Z`
**Executor**: `subagent-driven-development` (implementer `superspec.implementer`, per-task and final review `superspec.task-reviewer`)

---

## Workspace

- **Worktree path**: `/Users/naicoi/Projects/oss/pi-jev-pilot.wg-18-tuning-policy`
- **Worktree branch**: `wg-18-tuning-policy`
- **Feature branch**: `feat/wg-18-tuning-policy`
- **Base branch**: `main`

---

## Commits

- **Range**: `5e2d9b1..a78e280` (the receipt commit follows)
- **Count**: `21`
- **Fresh checks at a78e280**:
  - `bun run typecheck`, `bun run lint` and `bun run fmt:check` were clean.
  - `bun test`: 1318 pass, 0 fail across 71 files.
  - Baseline at 5e2d9b1 was 1213 pass, 0 fail. The new worktree first needed `bun install --frozen-lockfile`, because the post-start copy left `node_modules` incomplete.
- **Reviews**:
  - Every task had a `superspec.task-reviewer` gate. Tasks 1–8 were approved on the first review. Task 9 needed one fix round, because the workflow diagram had the wrong step order.
  - The final whole-branch review over `5e2d9b1..dda0775` found 0 Critical and 0 Important issues, and 4 Minor. Minors 1–3 were fixed in `dda0775..a78e280`, and a scoped re-review confirmed them: ready to merge. Minor 4 is deferred (below).

---

## Tasks

- **Completed**: `11 of 11` checkboxes in tasks.md flipped to `- [x]`
- **Remaining**: none

---

## Contract deviations

- None of the declared shapes changed.
- Additive internal type exports were added, none `public`: `HistoryEntry` (a controller ruling, used by later tasks), `TuningCause`, `Counts`, `StepResult` and `StepInput` (the named type of `stepTuning`'s input, with the same shape as the contract).

---

## Rulings and deferred items

- **Rulings:**
  - Task 3 test-hygiene Minors were carried into Task 8: the "Other files untouched" test now asserts `{ ok: true }`, and the chmod restore runs in `try/finally`.
  - Task 6 cleanups were carried into Task 7: `Counts` is imported, the `entry` helper order is fixed, and non-mutation tests were added.
  - Task 7 test gaps were carried into Task 8: a step-level block active/expired test, and idempotence after a revert.
- **Deferred to the host change:**
  - The step assumes that ledger lines have `at ≤ now`. With clock skew, a line from the future could fire the rule twice.
  - A shared move-aside helper for `state-file.ts` and `tuning-file.ts` is left for a later refactor.
- **Cosmetic Minors** are listed in the SDD ledger and are all OK to defer, per the final review triage.

---

## Next step

Run `/opsx-verify`.
