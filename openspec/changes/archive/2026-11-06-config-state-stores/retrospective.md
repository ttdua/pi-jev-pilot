# Retrospective: config-state-stores

## Wins

- Every plan task passed its task review on the first round. The whole-branch review found only minor items, and those were fixed in one fix wave. The suite went from 47 to 137 tests, all passing.
- Settling the open decisions in explore (validator, unknown keys, CLI review default, slot writer, malformed state, resolver) left brainstorm with nothing to ask. The ff run went through without a stop.
- Internal spec and plan reviews before the human gate caught real gaps:
  - state that cannot be read must never be moved aside;
  - write failures must come back as results;
  - moving a bad file aside must not throw.

## Misses

- The first `writeSlots` read `config.json` twice: once to validate it and once to rewrite it. The whole-branch review found this (M2). The plan's description of step 3 ("re-parse the raw file text") invited it.
- One permission test used an early `return` instead of `test.skipIf`, so it would report a pass while skipping (M3).

## Plan deviations

- `refine(inner, ok, message)` was added to the validator API in Task 3 for the URL and literal-`default` rules. It is internal and additive, and is recorded in `plan.md` and `apply.md`.
- `updateState` validates the update before moving a malformed file aside, which is the reverse of the order in design D8. The spec requires that an invalid update leaves the file unchanged, so the code follows the spec. Verify flagged the design wording as a warning.
- The `Default location` host test runs in a `bun -e` subprocess, because Bun's `homedir()` ignores a change to `HOME` made in the same process.

## Skill/workflow compliance

- Subagent-driven: one implementer and one reviewer per task, a whole-branch review, one fix wave and a scoped re-review. The controller re-ran typecheck, lint, format and the store tests after every review before ticking a task.
- Gates went through the Inbox: brainstorm, the final packet and code review were each approved. Push and opening a PR were approved explicitly, as `AGENTS.md` requires.

## Surprises

- The `node_modules` that `wt` copied into the new worktree was incomplete: `@types/bun` and a `semver` internal file were missing. A clean `bun install --frozen-lockfile` fixed it.
- `wt remove` reports the worktree branch as "unmerged" because it compares with `main`, not the feature branch. The branch was deleted with `git branch -d` after an ancestor check.

## Promote candidates

- Plans for writers that preserve key order should say "read once, validate and keep the raw object". That avoids a check-then-reuse gap.
- Note in the project's contributing guide: after `wt switch --create`, run `bun install --frozen-lockfile` instead of relying on the copied `node_modules`.
