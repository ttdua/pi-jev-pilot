# Apply Receipt

> Generated at the end of the apply phase to mark code-implementation
> complete and provide verify with the state it needs.
> Overwritten on each apply iteration; iteration counter grows.

**Change**: `wg-16-rich-state-replay`
**Iteration**: `5`
**Applied at**: `2026-11-07 13:35` (UTC).

- Iteration 1 was at 10:56.
- Iteration 2, at 11:40, fixed verify warning W1.
- Iteration 3 applies the pass 1 decisions (design D9) and adds the `effort-order` replay variant.
- Iteration 4, at 13:50, ships the effort option order `high, medium, xhigh, low, max` for main and worker. The operator approved it after a confirming replay: run `2026-11-07T13-41-05-608Z-pass1`, 400 requests, where effort changed 12 times against noise 6, and 11 of those 12 changes went up.
- Iteration 5, at 14:05, is cleanup after the re-verify:
  - `tasks.md` is restored. Commit `60f5a59` had emptied it by accident, through an edit that replaced the whole file. It is restored from `a17b2a6`, with 5.3–5.7 ticked.
  - The state-replay `Reversed options` scenario now refers to the shipped order.
  - A `last_decision` one-group test was added.
  - The no-op `effort-order` variant was removed (`2858bad`).
  - `docs/project-brief.md` now marks `languages` as removed.
**Executor**: `subagent-driven-development`. Each task had a `superspec.implementer`, followed by a combined spec and quality review by `superspec.task-reviewer`. A final whole-branch review by `superspec.task-reviewer` covered `3ebb2e0..f91258a`. A fix wave followed, then a scoped re-review.

---

## Workspace

- **Worktree path**: `/Users/naicoi/Projects/oss/pi-jev-pilot.wg-16-rich-state-replay`
- **Worktree branch**: `wg-16-rich-state-replay`
- **Feature branch**: `WG-16`
- **Base branch**: `main`

---

## Commits

- **Range**: `3ebb2e0..2858bad` plus this receipt. Iteration 5 is `2858bad` plus the artifact commit.
- **Iteration 4 range**: `3ebb2e0..8255f12`. Iteration 4 is `8255f12`, with a docs line in `docs/jev-questions.md`.
- **Earlier range**: `3ebb2e0..1b160b4`. `3ebb2e0` is the scaffold commit on `WG-16`.
  - Iteration 3 is `a17b2a6..1b160b4`:
    - `a17b2a6` and `60f5a59`: decisions, evidence and artifact updates;
    - `fbb26e0`: ship `last_decision` and `capabilities`, and remove the context and languages fields;
    - `9ad4611`: the `effort-order` variant and `--only`;
    - `1b160b4`: review fixes.
  - Finalize (code part) merged `bc55c49` into `WG-16`, and the worktree branch was fast-forwarded to `fba404b` after it.
  - Iteration 1 ran `3ebb2e0..ce33b74` plus the receipts `5f85935` and `f466b98`.
  - Iteration 2 is `53121b0` (`fix(jev): context_used_percent is never null on the wire`), a type-only narrowing tested by a type-level assertion.
- **Count**: `46`

---

## Tasks

- **Completed**: `18 of 27` checkboxes in tasks.md are flipped to `- [x]`. These are groups 1–4, which cover plan Tasks 1–11: all of the code, tests and docs.
- **Remaining**: `6.1`–`6.4` (pass 2: git, which needs a few days of `JEV_REPLAY_GIT=1` recording, then operator approval). Done: 5.1–5.7.
  - These are plan Tasks 12–14, the operator-gated replay passes and the decisions that follow them.
  - Each `--send` needs the operator's approval at that moment, stating the data and the cost (`docs/testing.md` Replay rules).
  - Pass 2 also needs a few days of `JEV_REPLAY_GIT=1` recording first.
  - They are deliberately outside this apply run.

**Verification at `2858bad`:**
- `bun test`: 1558 pass, 0 fail. There are fewer tests than before because the tests for the removed builders are gone.
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
- `RichGroup` and `RICH_GROUPS` (iteration 3): `context_used_percent` and `languages` are removed, per the D9 decision, and `SHIPPED_MAIN_GROUPS` is `last_decision` and `capabilities`. `scanLanguages` and the `getContextUsage` use are deleted.
- `scripts/replay` CLI (public, iteration 3): an additive optional `--only VARIANTS` flag was added. Iteration 5 removed the `effort-order` variant, and `--only` stays as a generic filter. The operator approved a confirming replay of the effort order, and this flag runs just that variant. `--models` is still accepted, but it is a no-op now that the context group is gone.
- `listAgents` (iteration 3): it now lists each directory once and resolves from those maps. The output is unchanged.
- `EFFORT_OPTION_ORDER` (new, iteration 4): sets the option order shown to Jev for `effort`, both main and worker. `EFFORT_LEVELS` and `EFFORT_LADDER` keep the rank order `low` → `max`. The `effort` spec requires the key set, not the order, so no spec delta is needed.
- `RICH_GROUPS`: a new `as const` array in `src/jev/state.ts`. `RichGroup` is now derived from it, so the CLI's group list cannot drift. Final-review M4.

The public contracts (the `scripts/replay` CLI, `replay-git.jsonl` and `JEV_REPLAY_GIT`) are unchanged. Final-review M3 tightened `--kept` validation: `git` is rejected, and `capabilities` requires `--capabilities`. Both are stricter input checks inside the documented flags.

---

## Next step

Run `/opsx-verify` for iteration 5. After verify and finalize, plan Tasks 12–14 run only with the operator's explicit approval for each `--send`.
