# Apply Receipt

> Generated at the end of the apply phase to mark code-implementation
> complete and provide verify with the state it needs.
> Overwritten on each apply iteration; iteration counter grows.

**Change**: `executor-seams-upstream`
**Iteration**: `1`
**Applied at**: `2026-11-11 14:02`
**Executor**: `subagent-driven-development` (implementer role: `general-purpose`; task reviewer role: `Plan`, read-only; final whole-branch review: `Plan`)

---

## Workspace

- **Worktree path**: `/Users/naicoi/Projects/oss/pi-jev-pilot.executor-seams-upstream`
- **Worktree branch**: `executor-seams-upstream`
- **Feature branch**: `spec/executor-seams-upstream`
- **Base branch**: `main`

---

## Commits

- **Range**: `4969c4de..HEAD` (HEAD = the commit that adds this receipt; implementation ends at `b70199d6`)
- **Count**: `40` (39 implementation, fix and artifact commits plus this receipt; includes the subtree squash `dbaae798` and merge `41f14d91`)

Fresh evidence (controller run at `9880057f`; fix wave `0f4beecb` re-run by its implementer): `bun run typecheck`, `lint`, `fmt:check` pass; `bun run test` 2655 pass / 0 fail; `bun run test:executor` 2287 pass; `bun install --frozen-lockfile` clean.

---

## Tasks

- **Completed**: `44 of 44` checkboxes in tasks.md flipped to `- [x]`
- **Remaining**: none

---

## Contract deviations

Operator decisions during apply (public):

- `SubagentsService` publication timing: published at load (as upstream) unless the slot already holds a service with `implementation` `@ttdua/pi-subagents`, instead of at `session_start`. Reason: `@gotgenes/pi-subagents-worktrees` reads the service at load. Spec `executor-vendoring` and design D1/D10 updated (commit `99bd5b5f`).
- Child lifecycle event identity fields (`agentId`, `agentType`): optional in public types, always set by the executor. Reason: spec says new fields are optional. Contracts updated (`99bd5b5f`).
- `duplicate` executor scope: Pi 1.5.2 refuses to start with two `subagent` providers, so `duplicate` covers only jev-pilot running with the original executor without the vendored one. Specs `readiness-checks`, `jev-command`, design D10 updated (`406f2fb3`).
- Child event payload types (`ChildSpawningEvent`, `ChildSessionCreatedEvent`, `ChildBoundEvent`) are now exported from `dist/public.d.ts` (Task 4), as the Contracts row for `dist/public.d.ts` requires.

Internal:

- `LaunchRequestFacts` (structural) replaces a `LaunchRequest` slice as `effectiveLaunch` input, with `callerNamedModel` (a service launch is model-locked only when the caller named a model different from the agent's own).
- `LaunchBook<E>` single type parameter; API `remember`, `sessionCreated`, `bound`, `settle`, `pending`, `stop`, `clear`.
- `WorkerRouting` adds `start(ctx)`, `stop()`, `problems()`; `WorkerDeps` drops `agentDir`, adds `service`.
- `formatStatus` optional 4th argument `extra`.
- `buildToolQuestions(block, grant)`.
- `ToolDecision` and `launchToolCounts` replace the process-wide tool-count map.
- `VendoredService` moved to `src/host/platform/service.ts` to break a `platform` ↔ `tools` import cycle.
- Vendored seam files beyond the plan: `launch-plan.ts`, `launch-gate.ts`, `locked-launch.ts` (single-responsibility split), all listed in `VENDORED.md`.

---

## Lanes

| Task | Lane branch | Lane range | Review | Merge commit |
|---|---|---|---|---|
| 1 | sequential | `4969c4de..2001eec8` | clean after 1 fix round | n/a |
| 2 | sequential | `be2c503f..6c4ef986` | clean after 2 fix rounds (1 operator decision) | n/a |
| 3 | sequential | `1a4ae7d7..219e6e32` | clean after 1 fix round | n/a |
| 5 | sequential | `5ce1415f..07183603` | clean | n/a |
| 6 | sequential | `b16aac04..72a09594` | clean after 3 fix rounds (1 operator decision) | n/a |
| 4 | sequential | `a3c53946..21189352` | clean after 3 fix rounds | n/a |
| 7 | sequential | `79f67aa7..4125ce01` | clean after 1 fix round | n/a |
| 8 | sequential | `4125ce01..930f3747` | clean after 1 fix round | n/a |
| 9 | sequential | `930f3747..a5c764a3` | clean, 1 finding parked | n/a |
| final | sequential | `9880057f..0f4beecb` | final review "with fixes" → fix wave clean | n/a |

Order 1, 2, 3, 5, 6, 4, 7, 8, 9 (one writer, no child worktrees).

### Parked for verify / finalize

- README and usage-guide install commands stay `@v0.1.0` (a tag without the vendored executor) because `tests/release-check.ts` pins them to `@v<package version>`; prose tells users to install the default branch. The release step must bump the version, tag, and update both files.
- `callerModel` in the worker ledger line can mislabel the agent's resolved model as caller-named on tool launches; fixing it needs a public `requested.modelSource` field (ask first).
- No CI check that `packages/pi-subagents/dist/public.d.ts` is fresh; vendored `verify:public-types` still probes the old package name.
- `docs/evidence/2026-11-05-host-seams.md` links living specs whose new requirements land only at sync: run `/opsx-sync` (or archive) in the same PR.

---

## Next step

Run `/opsx-verify executor-seams-upstream`.
