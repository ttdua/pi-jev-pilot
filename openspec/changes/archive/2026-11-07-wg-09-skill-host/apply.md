# Apply Receipt

> Generated at the end of the apply phase to mark code-implementation
> complete and provide verify with the state it needs.
> Overwritten on each apply iteration; iteration counter grows.

**Change**: `wg-09-skill-host`
**Iteration**: `1`
**Applied at**: `2026-11-07T04:10Z`
**Executor**: `subagent-driven-development` (`superspec.implementer` per task; `superspec.task-reviewer` per task, for the whole branch, and for each scoped re-review)

---

## Workspace

- **Worktree path**: `/Users/naicoi/Projects/oss/pi-jev-pilot.wg-09-skill-host`
- **Worktree branch**: `wg-09-skill-host`
- **Feature branch**: none. The Worktrunk worktree was created from `main` as `wg-09-skill-host`, and the change artifacts were committed there (`af2f70a`). `WG-09` is stale after the #33 squash-merge. Finalize merges or opens the PR from `wg-09-skill-host` into `main`.
- **Base branch**: `main` (merge-base `180f8c8`)

---

## Commits

- **Range**: `af2f70a..812466c` (this receipt commit follows)
- **Count**: `22` (12 implementation, test and docs commits; 10 tasks.md tick commits)
- **Rebase before finalize**: rebased onto `origin/main` `66a0577` (#34, wg-12-modes) with no conflicts and no code change. The rebased range is `66a0577..c9a9f53`, 26 commits, including the receipts and a one-line design note naming `STALE_FINGERPRINT` (verify warning). Fresh checks after the rebase: typecheck, lint and fmt:check are clean, and `bun test` gives 1090 pass, 0 fail.

---

## Tasks

- **Completed**: `11 of 11` checkboxes in tasks.md flipped to `- [x]`
- **Remaining**: none

Reviews:
- Every plan task passed its task review.
- Task 4 needed one fix round: the explicit `/skill:` path did not use the projected message, so a context edit was not honoured.
- Task 8 needed one fix round: the "Jev down" test had a flaky wait and a weak equality check, and three checks could pass vacuously.
- The whole-branch review returned READY-WITH-FOLLOWUP with three minors and nothing critical or important.
- One fix wave (`812466c`) closed Minor 1 (`askBatches` was unguarded, a fail-open gap) and Minor 2 (a docs note on the effort wait for multi-batch catalogs). Its scoped re-review addressed both, with no new issues.

Final checks in the worktree:
- `bun run typecheck`, `bun run lint` and `bun run fmt:check` are clean.
- `bun test` ran 1018 pass, 0 fail, against a baseline of 939.
- `tests/host/skill-delivery.test.ts` drives the real Pi 1.5.0 CLI with loopback fixtures and has 10 cases. Among them: the body is sent once across three picks; an operator `/skill:name` then a pick gives a reference; a compaction either drops the body (resent as `content`) or keeps it (`reference`); `(none)` and a too-low gate attach nothing; the suggest form; Jev down; skills only; and the prompt marker never stored.

Rulings made during apply:
- The worktree branch was created from `main`, with no separate feature branch, because `WG-09` is stale after #33. Cost if wrong: one retarget at finalize.
- The Task 6 reviewer found that `skillPick` had no guard. I carried the guard into Task 7 instead of opening a fix round; `safePick` adds it. Cost if wrong: none, since the final review re-checked it.

Follow-ups for finalize or the PR notes (from the final review, not blocking):
- **Default behaviour change:** `skills` is on by default, so every eligible prompt now carries the skill questions (about 60 KB with 78 skills). With effort off and a non-empty catalog, a request is sent. The PR description must state this.
- **Deferred minors (left as is):** see `.superpowers/sdd/plan/progress.md`. None must be fixed before merge. They include `prepare` at about 70 lines (a possible `buildRecord` split) and wording nits in `docs/workflow.md` and `docs/jev-contract.md`.
- **WG-10 (#31):** still open and conflicting with `main`. Whichever change merges second combines the skill text and the advice into the one hidden message returned from `before_agent_start`.

---

## Contract deviations

none

Internal helpers outside the Contracts table changed shape: `skillPick` and `safePick` now accept `later: … | undefined`, and `tryAskBatches` was added. `tests/host/harness.ts` gained the test-only options `skills` and `jevConfig.skillsInject`. Every contract in plan.md is implemented as declared.

---

## Next step

Run `/opsx-verify wg-09-skill-host`.
