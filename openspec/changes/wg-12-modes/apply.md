# Apply Receipt

> Generated at the end of the apply phase to mark code-implementation
> complete and provide verify with the state it needs.
> Overwritten on each apply iteration; iteration counter grows.

**Change**: `wg-12-modes`
**Iteration**: `1`
**Applied at**: `2026-11-07 02:38` (UTC, `2026-11-07T02:38:23Z`)
**Executor**: `subagent-driven-development` (implementer `superspec.implementer`, per-task and whole-branch review `superspec.task-reviewer`)

---

## Workspace

- **Worktree path**: `/Users/naicoi/Projects/oss/pi-jev-pilot.wg-12-modes`
- **Worktree branch**: `wg-12-modes`
- **Feature branch**: `WG-12`
- **Base branch**: `main`

---

## Commits

- **Range**: `3d6abb2..dc43b1c` (implementation, ticks and one fix wave; this receipt commit follows)
- **Count**: `13`

---

## Tasks

- **Completed**: `9 of 10` checkboxes in tasks.md flipped to `- [x]`
- **Remaining**: `6.1`. This is the manual replay. It waits for the operator to approve the data and cost, it runs outside the repository, and it decides whether WG-12 is marked Done in `docs/roadmap.md`. It is not code and was not dispatched.

Reviews:
- Plan tasks 1 to 6 each passed their task review with no Critical or Important finding.
- The whole-branch review returned **ready**. Two optional Minor findings were fixed in one wave (`dc43b1c`): the usage-guide command footer, and pinning the `standard` rubric to the docs text. The scoped re-review resolved both.
- One reviewer dispatch was refused by the harness (`baseline-unresolved`). The identical retry ran normally.

Fresh check at `dc43b1c`:
- `bun run typecheck`, `bun run lint` and `bun run fmt:check` are clean.
- `bun test` gives 913 pass, 0 fail (baseline 841).
- The host end-to-end tests "Premium launch end to end" and "Jev down in premium" run the real Pi CLI and executor.

Parked minors, triaged in the final review as not needed for merge:
- T3: "Wording matches the docs in every mode" uses substring matching for `budget` and `premium`. `standard` is now pinned exactly.
- T4: "Premium criteria sent" asserts the full string, which is brittle against wording changes. "Jev down in premium" shows the caller's input is unchanged only through the `CALLER` fixture model and effort.
- T5: the `applyChange(parsed, dir, cliReview)` side argument is used only by the cli-review arm. The padding of the usage line is inconsistent.
- Baseline `openspec/specs/` still says `fable` until the archive sync applies the deltas.

Ruling made during apply:
- Task 3 has no separate RED run for its new tests. This was accepted because the reviewer confirmed the tests fail on the pre-change code and on a wrong rubric. Cost if wrong: none beyond process.

---

## Contract deviations

> Contracts changed during apply, each with its reason. Cumulative:
> keep entries from earlier iterations. Write `none` if there are none.

- none. `tests/host/fixture.test.ts` changed by one line because the contracted `fixture-expert` model is new in the models list. The contract shape did not change.

---

## Next step

Run `/opsx-verify wg-12-modes` in the worktree. Task 6.1 (replay) stays open for the operator.
