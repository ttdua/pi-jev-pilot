# Apply Receipt

> Generated at the end of the apply phase to mark code-implementation
> complete and provide verify with the state it needs.
> Overwritten on each apply iteration; iteration counter grows.

**Change**: `tune-mode-tier-mix`
**Iteration**: `1`
**Applied at**: `2026-11-07T17:30:00Z`
**Executor**: `subagent-driven-development` (implementer `superspec.implementer`, per-task and final review `superspec.task-reviewer`)

---

## Workspace

- **Worktree path**: `/Users/naicoi/Projects/oss/pi-jev-pilot.tune-mode-tier-mix`
- **Worktree branch**: `tune-mode-tier-mix`
- **Feature branch**: `feat/tune-mode-tier-mix`
- **Base branch**: `main`

---

## Commits

- **Range**: `0b30620..84103de` (the receipt commit follows)
- **Count**: `28`
- **Fresh checks at 84103de**:
  - `bun run typecheck`, `bun run lint` and `bun run fmt:check` were clean.
  - `bun test`: 1555 pass, 0 fail across 80 files.
  - Baseline at 0b30620 was 1509 pass, 0 fail across 75 files.
- **Reviews**:
  - Every task had a `superspec.task-reviewer` gate.
  - Tasks 5 and 11 needed one fix round each, both confirmed by a scoped re-review:
    - Task 5: imports without the `.ts` extension.
    - Task 11: the ADR named the status command `/jev status` instead of `/jev`, and some doc wording was stale.
  - Every other task was approved on its first review.
  - Task 7 to Task 9 left 5 host tests red between commits. The plan allowed this, and Task 9 closed it.
  - The final whole-branch review over `0b30620..80783a6` found 0 Critical and 0 Important issues.
    - It marked two minors as fix before merge:
      - `RISK_BAR` duplicated `RISK_FLOOR`.
      - Two `tier.test.ts` scenarios were inexact.
    - It also marked two evidence-note wording items.
    - All four were fixed in `80783a6..84103de`, and a scoped re-review approved them.
- **Done-when replay (6.3)**:
  - Run outside the repository: 2202 Jev requests, 0 misses.
  - Results are in `docs/evidence/2026-11-07-tier-mix.md`.
  - Every mode is in range over all launches with no reviewer slot.
  - Every mode is in range over non-review launches when a reviewer slot takes the reviews.
  - Non-review launches in a mixed window are out of range by 10–13 points.
  - The operator ruled on 2026-11-07, in the Inbox thread `tune-mode-tier-mix`, that the done-when is met by the two configurations. The mixed-window result is a known limitation, to be tracked separately.

---

## Tasks

- **Completed**: `19 of 19` checkboxes in tasks.md flipped to `- [x]`
- **Remaining**: none

---

## Contract deviations

none. Some symbols appeared that the plan's Contracts did not list; each is internal, and none changes a listed shape:
- `setup(pi, deps?)` gained an optional `SetupDeps` test seam (`window`, `readLines`). This is the "setup reader seam" contract row.
- `DecisionFields` is the return type of `decisionFields`.

---

## Known follow-ups

- When no reviewer slot is configured, non-review launches are routed cheaper than their mode's target, because reviews score higher and share the window. Fixing this would need a window per launch kind. The operator asked for it to be tracked separately from #39.
- Deferred minors judged "leave" by the final review are listed in the SDD ledger. Examples are formatting churn in tests and the unreachable `?? Infinity` in `quantileAt`.

---

## Next step

Run `/opsx-verify` in this worktree.
