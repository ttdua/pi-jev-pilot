# Apply Receipt

> Generated at the end of the apply phase to mark code-implementation
> complete and provide verify with the state it needs.
> Overwritten on each apply iteration; iteration counter grows.

**Change**: `wg-17-tally-and-log`
**Iteration**: `1`
**Applied at**: `2026-11-07T03:38:06Z`
**Executor**: `subagent-driven-development` (implementer `superspec.implementer`, per-task and final review `superspec.task-reviewer`)

---

## Workspace

- **Worktree path**: `/Users/naicoi/Projects/oss/pi-jev-pilot.wg-17-tally-and-log`
- **Worktree branch**: `wg-17-tally-and-log`
- **Feature branch**: `WG-17`
- **Base branch**: `main`

---

## Commits

- **Range**: `7a018f4..2951687` (the receipt commit follows)
- **Count**: `18`
- **Fresh checks at 2951687^ (bdd4a96)**:
  - `bun run typecheck`, `bun run lint` and `bun run fmt:check` were clean.
  - `bun test`: 943 pass, 0 fail across 57 files. This includes the host test `tests/host/verbose-log.test.ts` through the real CLI.
  - The later commit 2951687 changes only artifact wording.

---

## Tasks

- **Completed**: `11 of 11` checkboxes in tasks.md flipped to `- [x]`
- **Remaining**: none

Review outcomes:
- **Per-task reviews:** all clean.
- **Task 4:** one fix round removed unrelated reformatting.
- **Task 6:** one fix round hardened assertions that could pass without checking anything.
- **Final whole-branch review:** `READY_WITH_FIXES`. One fix wave (`bdd4a96`) addressed all five items in a scoped re-review: the log stores the validated entry; the tally records even if the ledger append throws; a cadence test for the real wiring; formatting restored; a neutral model id in the docs. Verdict after re-review: PASS.

Rulings made during execution:
- `EMPTY_TALLY` was created in Task 1, not Task 3. Cost if wrong: one export moves.
- The Task 6 minors were fixed now, not deferred. They guard the roadmap Done-when assertion. Cost if wrong: one extra small commit.
- The overlay lifetime wording in `specs/status-line/spec.md` and design D3 was aligned with the approved plan and the tested behavior. The tally form lasts until the next prompt's result. A cancelled prompt keeps the line as it was. A scenario "Cancelled 11th prompt keeps the tally" was added and mapped to the existing test. Cost if wrong: a two-line change to clear the overlay at prompt start.

Accepted minors:
- `undo.drew` and the `drawnBy` WeakSet in `main.ts` are redundant.
- `Turn` and `applyOutcome` are declared mid-closure.
- Two optional test-only notes.

---

## Contract deviations

- `EMPTY_TALLY`: created in Task 1 (`src/host/status.ts`) instead of Task 3. The shape is unchanged, and the item is internal.
- The status line text contract (public, status-line spec) is unchanged in shape. Only its lifetime wording was clarified, to match the plan the operator approved: "tally overlay … cancelled 11th prompt keeps the overlay".

---

## Next step

Run `/opsx-verify wg-17-tally-and-log`.
