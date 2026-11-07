# Apply Receipt

> Generated at the end of the apply phase to mark code-implementation
> complete and provide verify with the state it needs.
> Overwritten on each apply iteration; iteration counter grows.

**Change**: `wg-16-rich-state-replay`
**Iteration**: `1`
**Applied at**: `2026-11-07 10:56` (UTC)
**Executor**: `subagent-driven-development`. Each task had a `superspec.implementer`, followed by a combined spec and quality review by `superspec.task-reviewer`. A final whole-branch review by `superspec.task-reviewer` covered `3ebb2e0..f91258a`. A fix wave followed, then a scoped re-review.

---

## Workspace

- **Worktree path**: `/Users/naicoi/Projects/oss/pi-jev-pilot.wg-16-rich-state-replay`
- **Worktree branch**: `wg-16-rich-state-replay`
- **Feature branch**: `WG-16`
- **Base branch**: `main`

---

## Commits

- **Range**: `3ebb2e0..ce33b74`. `3ebb2e0` is the scaffold commit on `WG-16`. The receipt commit follows `ce33b74`.
- **Count**: `30`

---

## Tasks

- **Completed**: `18 of 27` checkboxes in tasks.md are flipped to `- [x]`. These are groups 1–4, which cover plan Tasks 1–11: all of the code, tests and docs.
- **Remaining**: `5.1`, `5.2`, `5.3`, `5.4`, `5.5`, `6.1`, `6.2`, `6.3`, `6.4`.
  - These are plan Tasks 12–14, the operator-gated replay passes and the decisions that follow them.
  - Each `--send` needs the operator's approval at that moment, stating the data and the cost (`docs/testing.md` Replay rules).
  - Pass 2 also needs a few days of `JEV_REPLAY_GIT=1` recording first.
  - They are deliberately outside this apply run.

**Verification at `ce33b74`:**
- `bun test`: 1565 pass, 0 fail.
- `bun run typecheck`, `bun run lint` and `bun run fmt:check`: clean.

**E2E check:** `bun scripts/replay/cli.ts --pass 1 --models <saved pi --list-models>` was run against the real `~/.pi/agent/sessions` as a dry run, with no `--send` and no network request.
- Result: main 100, workers 46, 11 variants, 770 requests, estimated $0.0561.
- With no `--capabilities` snapshot, the capabilities and worker variants were skipped.
- This check found the nested-session bug fixed in `ce33b74`.

---

## Contract deviations

All of these are internal, and each is recorded in `plan.md` Contracts.

- `GitExec`: exported from `src/host/git.ts` in Task 6, so that tests can type `exec` without a cast.
- `MainSample.turnId`: a new optional field, added in Task 8. The git join needs the first `jev-turn` after the prompt, and a branch that ends at the prompt cannot reach it.
- `RebuiltMain`, `RebuiltWorker`, `rebuildMain`: Task 9 named these without a shape. They were given a shape by a controller ruling.
- `compare`: in Task 10 it gained a third `meta` argument, because `aggregates.json` needs `runId`, `pass`, `samples` and `config`.
- `aggregates.json`: variants are keyed by `variantKey` (`worker:<id>` for workers). Base variants are listed too, and `kind` and `incomparable` were added. This came out of the Task 10 fix round, which found exclusion counts colliding across kinds.
- `variantKey`: a new shared helper, introduced in the same Task 10 fix round.
- `writeOutputs`: moved into `scripts/replay/outputs.ts`, so that `compare.ts` stays pure.
- `RICH_GROUPS`: a new `as const` array in `src/jev/state.ts`. `RichGroup` is now derived from it, so the CLI's group list cannot drift. Final-review M4.

The public contracts (the `scripts/replay` CLI, `replay-git.jsonl` and `JEV_REPLAY_GIT`) are unchanged. Final-review M3 tightened `--kept` validation: `git` is rejected, and `capabilities` requires `--capabilities`. Both are stricter input checks inside the documented flags.

---

## Next step

Run `/opsx-verify`. After verify and finalize, plan Tasks 12–14 run only with the operator's explicit approval for each `--send`.
