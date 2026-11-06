# Apply Receipt

> Generated at the end of the apply phase to mark code-implementation
> complete and provide verify with the state it needs.
> Overwritten on each apply iteration; iteration counter grows.

**Change**: `host-seam-verification`
**Iteration**: `1`
**Applied at**: `2026-11-06 00:57` (UTC)
**Executor**: `subagent-driven-development` (`superspec.implementer` per task, `superspec.task-reviewer` per task and for the final whole-branch review; Tasks 5 to 8 ran in parallel, Tasks 6 to 8 in separate Worktrunk worktrees `hsv-task-6`, `hsv-task-7`, `hsv-task-8`, then cherry-picked in task order)

---

## Workspace

- **Worktree path**: `/Users/naicoi/Projects/oss/pi-jev-pilot.host-seam-verification`
- **Worktree branch**: `host-seam-verification`
- **Feature branch**: `spec/host-seam-verification`
- **Base branch**: `main`

---

## Commits

- **Range**: `c17ed3b..a4e6608`
- **Count**: `27`

---

## Tasks

- **Completed**: `27 of 27` checkboxes in tasks.md flipped to `- [x]`
- **Remaining**: none

Task 5.3 (the manual Q8 run) was done by the operator on 2026-11-06 with their `claude-code` login.

---

## Contract deviations

All are internal (no contract is `public`); each is also recorded in the plan.md Contracts entry.

- `startFixture`: unmatched requests get HTTP 400 instead of 500, because the OpenAI SDK retries 5xx and double-counted unmatched requests (Task 3).
- `RpcProcess`: gained `pid` (process-group id of the detached Pi child) for leak checks and the Q8 signal handler; `send` rejects at once after the process exited (Task 3 fix round 1).
- `isolatedEnv`: new allow-listed child env (`PATH`, `TMPDIR`, `HOME`, `PI_CODING_AGENT_DIR`, plus explicit extras) so no operator env reaches the CLI (Task 3 fix round 1).
- `assertProbeReportClean`: new privacy check called by `HostSession.close()` (Task 9, per the pre-flight ruling).
- Q8 script output: `level` is the effective level from `get_state.thinkingLevel`, with a `level-mismatch` line on difference; `--preflight-only` flag and a `claude-login-missing` message added; the claude login env forwards `USER`/`LOGNAME` (Task 8 fix rounds and the first operator run).

---

## Verification evidence (apply side)

- At `a4e6608`'s code state (`afb5a4b`): `bun install --frozen-lockfile`, `bun run typecheck`, `bun run lint`, `bun run fmt:check` exit 0; `bun run test` 47 pass, 0 fail across 12 files.
- Final whole-branch review: READY_WITH_FIXES; fix wave `8dcecff..afb5a4b`; scoped re-review PASS.
- Operator decisions recorded: launches with `inherit_context` stay skipped; "keep the model, change only thinking" is an open option for WG-11.

---

## Next step

Run `/opsx-verify host-seam-verification`.
