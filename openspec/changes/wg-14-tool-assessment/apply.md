# Apply Receipt

> Generated at the end of the apply phase to mark code-implementation
> complete and provide verify with the state it needs.
> Overwritten on each apply iteration; iteration counter grows.

**Change**: `wg-14-tool-assessment`
**Iteration**: `1`
**Applied at**: `2026-11-07 02:46` (UTC, `2026-11-07T02:46:14Z`)
**Executor**: `subagent-driven-development` (implementer `superspec.implementer`, per-task and whole-branch review `superspec.task-reviewer`)

---

## Workspace

- **Worktree path**: `/Users/naicoi/Projects/oss/pi-jev-pilot.wg-14-tool-assessment`
- **Worktree branch**: `wg-14-tool-assessment`
- **Feature branch**: `WG-14`
- **Base branch**: `main`

---

## Commits

- **Range**: `8a8ad6c..bec27dc` (implementation, task ticks, the fix wave and one plan note; this receipt commit follows)
- **Count**: `22`

---

## Tasks

- **Completed**: `12 of 12` checkboxes in tasks.md flipped to `- [x]`
- **Remaining**: none

Reviews:
- Every plan task (1 to 9) passed its task review with no Critical or Important finding. Minors were folded into the next task or fixed by the controller.
- The whole-branch review returned "yes-with-fixes", with 0 Critical, 0 Important and 3 Minor findings.
- The single fix wave (`bec27dc`) removed a `dispose()` method that never ran in the real flow, because each worker session has its own extension instance. It also documented the 256-entry counts map. The scoped re-review passed.

Fresh check at `bec27dc`:
- `bun run typecheck`, `bun run lint` and `bun run fmt:check` are clean.
- `bun test` gives 927 pass, 0 fail (baseline 841).

Host evidence (`tests/host/tool-assessment.test.ts`, real Pi CLI 1.5.0 and executor 25.0.5):
- 7 pass.
- The worker found its record in `listAgents()` by `outputFile` at its first `before_agent_start`. This resolves the design's open question.
- `observe` kept every tool and recorded `toolsScored` 7 and `toolsFlagged` 1.
- `enforce` removed `edit`, and a call to it returned "not found".
- A Jev 500 kept the same tools as a run with the switch off.
- Two concurrent background workers each named their own agent.

Rulings made during apply (from the SDD ledger):
- The `src/policy/tools.ts` header keeps "nothing outside src/policy/ and src/shared/", because it states the lint boundary.
- `dispose()` was added in Task 6 to prune the per-session outcome map, then removed after the final review because it was dead code.
- Orphaned counts, for launches with no `worker` line, are left to the 256 cap and documented.

Parked minors:
- The `cutLastCodePoints` `max <= 0` branch is untested.
- The task `description` in the tool request is not cut, as specified.
- `toolsScored` 7 in the host test is tied to Pi's default tool set.

---

## Contract deviations

> Contracts changed during apply, each with its reason. Cumulative:
> keep entries from earlier iterations. Write `none` if there are none.

- `createToolAssessment` (internal): a `dispose(sessionId)` method was added in Task 6, then removed after the final review. Each worker session has its own extension instance, so the outcome map ends with the session. Net shape matches the original contract. Recorded in the plan.md Contracts row.

---

## Next step

Run `/opsx-verify`.
