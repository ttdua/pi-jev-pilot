# Retrospective: jev-client-and-answers

## Wins

- The tagged-union outcome (`ok` / `miss` / `cancelled`) made fail open a property of the types. Every review checked "askJev never rejects" by reading one outer `try`, not by hunting call sites.
- Checking Bun behaviour before writing the plan paid off. The checks were `redirect: "manual"`, `AbortSignal.any`, stalled-body aborts, `new Headers` throwing on a newline and `JSON.stringify` on `BigInt`. No implementer hit a runtime surprise.
- The internal plan review caught a real bug before any code existed: a key with a newline would have been reported as `connection` instead of `bad request`.
- Final suite: 122 pass, 0 fail (baseline 47). The `tests/jev` suite is stable at about 650 ms per run across 5 runs.

## Misses

- The first draft of the spec allowed a miss on paths after the response arrived, even though "Cancellation stops everything" says never. Only the final whole-branch review caught it. The task-level reviews read each task in isolation and missed it.
- The spec reviewer found 9 minor gaps (missing scenarios, unnamed URL function). The first spec draft was thinner than it should have been.

## Plan deviations

- Plan Tasks 2 and 3 ran as one implementer task, as ruled at preflight.
- The `FixtureRoute` test interface gained `{ chunks }` for the split-UTF-8 test.
- The fix wave moved the early cancelled check before input validation. Design D5's step order is unchanged in intent.

## Skill/workflow compliance

- Every task went through implement, then review, then tick. The final review and its fix wave ran with one scoped re-review. The ledger holds every ruling, and all rulings are restated in `apply.md`.
- Worktrunk `wt remove` refused to delete the branch, because it measures "merged" against `main`. Finalize used `git branch -d` from `WG-04`, which checks the merge into the current branch.

## Surprises

- A Worktrunk post-start copy of `node_modules` was still running when the first baseline test ran, which gave a false red baseline. Running `bun install --frozen-lockfile` fixed it.

## Promote candidates

- Run task reviewers with the spec's cross-cutting requirements (such as "never a miss on cancel") as a constraint for every task that touches those paths, not only the task that introduces them.
- Wait for Worktrunk post-start hooks, or run `bun install`, before taking a test baseline in a new worktree.
