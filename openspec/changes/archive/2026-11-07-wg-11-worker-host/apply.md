# Apply Receipt

> Generated at the end of the apply phase to mark code-implementation
> complete and provide verify with the state it needs.
> Overwritten on each apply iteration; iteration counter grows.

**Change**: `wg-11-worker-host`
**Iteration**: `1`
**Applied at**: `2026-11-06 16:43` (UTC, `2026-11-06T16:43:04Z`)
**Executor**: `subagent-driven-development` (implementer `superspec.implementer`, per-task and whole-branch review `superspec.task-reviewer`)

---

## Workspace

- **Worktree path**: `/Users/naicoi/Projects/oss/pi-jev-pilot.wg-11-worker-host`
- **Worktree branch**: `wg-11-worker-host`
- **Feature branch**: `WG-11-host`
- **Base branch**: `main`

---

## Commits

- **Range**: `7b1bacd..c905b5e` (implementation, fix wave and ticks; this receipt commit follows)
- **Count**: `19`

---

## Tasks

- **Completed**: `14 of 14` checkboxes in tasks.md flipped to `- [x]`
- **Remaining**: none

Reviews:
- Every plan task (1 to 8) passed its task review with no Critical or Important finding.
- The whole-branch review returned "with fixes". It had one Important finding: a stale buffered executor outcome could join a later resume of the same agent id. The single fix wave (`fa9af79`, `d9ed3b8`) passed its scoped re-review.
- `c905b5e` made `LaunchEntry` module-private, because it was exported beyond the Contracts.

Fresh check at `c905b5e`:
- `bun run typecheck`, `bun run lint` and `bun run fmt:check` are clean.
- `bun test` gives 712 pass, 0 fail (baseline 544).
- The host end-to-end suite `tests/host/worker-routing.test.ts` runs the real Pi CLI and executor: 11 pass, run three times by the implementer.

Operator follow-up outside the repository:
- `/tmp/wg11/issue-14-body.md` is the WG-13 issue body with the tier cascade removed. It awaits operator approval before posting.

Parked minors, from per-task reviews and triaged in the final review:
- Parity shapes lack `{high:null}`.
- Effort and risky extraction is duplicated in `route.ts`.
- No host-level "never `expert`" assertion; it is covered by the route unit test.
- `workerLines` returns `[]` on a non-ok ledger read.
- An agent name outside the ledger pattern drops its line silently. This is fail-open.
- Thinking-only routes rely on the executor to clamp, as documented in design §1.

---

## Contract deviations

> Contracts changed during apply, each with its reason. Cumulative:
> keep entries from earlier iterations. Write `none` if there are none.

none

---

## Next step

Run `/opsx-verify`.
