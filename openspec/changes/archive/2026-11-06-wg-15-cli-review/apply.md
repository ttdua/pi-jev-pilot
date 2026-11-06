# Apply Receipt

> Generated at the end of the apply phase to mark code-implementation
> complete and provide verify with the state it needs.
> Overwritten on each apply iteration; iteration counter grows.

**Change**: `wg-15-cli-review`
**Iteration**: `1`
**Applied at**: `2026-11-06 21:25`
**Executor**: `subagent-driven-development` (implementer `superspec.implementer`, per-task and final whole-branch review `superspec.task-reviewer`)

---

## Workspace

- **Worktree path**: `/Users/naicoi/Projects/oss/pi-jev-pilot.wg-15-cli-review`
- **Worktree branch**: `wg-15-cli-review`
- **Feature branch**: `WG-15`
- **Base branch**: `main`

---

## Commits

- **Range**: `c1c8850..HEAD` (implementation through `ac33e5b`, plus this receipt commit)
- **Count**: `23` before this receipt

Final whole-branch review over `c1c8850..7809dbf`: ready to merge, no Critical or Important findings. One fix wave `7809dbf..7cc9233` for four Minor findings, approved on scoped re-review. Full suite at `7cc9233`: 443 pass, 0 fail; typecheck, lint and format clean.

Real-CLI run (task 6.2, after the operator's go-ahead and their local CLI configuration fix): Codex 0.159.0 and OpenCode 2.2.5 both `ok`, recorded in `docs/evidence/2026-11-06-cli-review.md`.

---

## Tasks

- **Completed**: `20 of 20` checkboxes in tasks.md flipped to `- [x]`
- **Remaining**: none

---

## Contract deviations

- `validateCliReview` (internal): added to `src/store/state-file.ts` so `/jev cli-review` can check typed values against the state rules before reading a model list; the plan required the pre-check without naming a function. Recorded in plan.md Contracts.
- `formatFailure` (internal): gained an optional `errorName` parameter for the `could not start (<ErrorName>)` reason. Recorded in plan.md Contracts.

No public contract changed.

## Rulings made during apply

- `validateCliReview` export (above). Cost if wrong: one small refactor.
- Codex tier suggestions list only letter-only families (a real catalog showed `5.5 (now gpt-5.5)`). Cost if wrong: cosmetic suggestion text.
- A review cancelled before any CLI starts reports `attempts: 1` with outcome `cancelled`, keeping `ReviewDetails.attempts` as `1 | 2`; documented in `docs/workflow.md` §6. Cost if wrong: one field's meaning.
- `tests/host/jev-base.test.ts` print-mode test now allows exactly the `jev_review` tool declaration and its two prompt lines as the only provider-request difference, with presence checks both ways; `docs/testing.md` updated. Cost if wrong: one test edit.
- A throwing `exec` in `/jev cli-review` reports `could not read the model list`, not `not found`, because `pi.exec` reports a missing binary as exit code 1 instead of throwing. Cost if wrong: a less specific warning.

---

## Next step

Run `/opsx-verify`.
