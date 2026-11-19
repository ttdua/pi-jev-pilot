# Apply Receipt

> Generated at the end of the apply phase to mark code-implementation
> complete and provide verify with the state it needs.
> Overwritten on each apply iteration; iteration counter grows.

**Change**: `structured-result`
**Iteration**: `3`
**Applied at**: `2026-11-19 12:19` (UTC)
**Executor**: `subagent-driven-development` (implementer role: `implementer`; task reviewer role: `code-reviewer`)

---

## Workspace

- **Worktree path**: `/Users/naicoi/Projects/oss/pi-jev-pilot.structured-result`
- **Worktree branch**: `structured-result`
- **Feature branch**: `issue-86`
- **Base branch**: `main`

---

## Commits

- **Range**: `6f63917b..9c5d7c14` (this receipt commit follows)
- **Count**: `26`
- **This iteration**: `76b12bf7..9c5d7c14` (fix iteration 3, from verify iteration 2 FAIL)
- **Iteration 2**: `f5bf47d9..372c1639` (from verify iteration 1 FAIL)

---

## Tasks

- **Completed**: `20 of 20` checkboxes in tasks.md flipped to `- [x]`
- **Remaining**: none

---

## Contract deviations

- `RunOutcome` (internal, iteration 1): gained readonly `structuredResult` and `structuredResultError` so carriers holding a run can read the per-run outcome. Additive.
- `TurnLoopOptions` / turn-loop termination (internal, iteration 1 final-review fix wave, recorded in iteration 2): a run holding a structured result is ended at the completed-turn boundary by the composed `session.agent.finishTurn` wrapper returning `{ action: "end" }` **plus an unawaited `session.abort()`**, so `AgentSession` starts no continuation for queued steer or follow-up messages. Queued messages stay queued; the run settles `completed`; an external abort still reads `stopped`. design.md and plan.md updated.
- `StructuredResultSink` / `CreateSubagentSessionParams.submitResult` (internal, iteration 2): function → object `{ hasResult(): boolean; submit(value): "stored" | "already-submitted" }`, so `submit_result` reports "already submitted" before validating (verify C2). plan.md Contracts updated.
- `submit_result` disallow exemption (internal behaviour, iteration 2): applies only when the launch has a `resultSchema` (verify C1).
- Turn-budget stop mechanism (internal, iteration 2, user-approved scope addition, plan Task 5): the ceiling stop now happens in the same shared `finishTurn` wrapper at the completed-turn boundary (no provider request in flight), instead of aborting the next turn's request at `turn_start`; the wrapper is installed on every run and is a no-op within budget without a held result. Only a turn forced past the ceiling by a queued steer still aborts at `turn_start` (pre-existing edge). Provider-error handling (#889/#898) is unchanged.

---

## Lanes

| Task | Lane branch | Lane range | Review | Merge commit |
|---|---|---|---|---|
| 1 | sequential | `6f63917b..4a06a817` | approved after 1 fix round | n/a |
| 2 | sequential | `ffb6367b..98763d09` | approved (2 minors deferred) | n/a |
| 3 | sequential | `ec4c8439..9026448e` | approved (3 minors deferred; first reviewer run hit a 429 usage limit, retried per user) | n/a |
| 4 | sequential | `a2f8b970..162227ad` | approved (2 minors deferred) | n/a |
| Final whole-branch (iter 1) | sequential | `6f63917b..e56c2af5`, fix wave `e56c2af5..445207ea` | with fixes → all addressed | n/a |
| Verify fix C1/C2/W1/W2 (iter 2) | sequential | `f5bf47d9..33920354` | re-review: C1, C2 addressed; W1 except turn-limit addressed by Task 5; W2 completed in this receipt | n/a |
| 5 (iter 2, user-approved) | sequential | `aa9adfff..372c1639` | approved after 2 fix rounds (approach changed by ruling) | n/a |
| Verify fix C3/W1/W2 (iter 3) | sequential | `76b12bf7..9c5d7c14` | re-review: all addressed, no new breakage | n/a |

---

## Verification (iteration 3, implementer-reported, HEAD 9c5d7c14)

- `bun run --cwd packages/pi-subagents check` exit 0; package `test` 116 files, 2764 passed.
- Root `bun run typecheck` exit 0, `bun run lint` exit 0, `bun test` 2637 pass, 0 fail.
- Iteration 3 changes: `checkNode` no longer returns after a type violation, so every violation of a node is listed (verify C3); real-SDK `maxTurns: 3` ceiling-submit tests (W1); plan.md `TurnLoopOptions` row and tasks.md 5.1 wording aligned (W2). No contract change.

---

## Next step

Run `/opsx-verify`.
