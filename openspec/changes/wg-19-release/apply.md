# Apply Receipt

> Generated at the end of the apply phase to mark code implementation
> complete and to give verify the state it needs.
> Overwritten on each apply iteration; the iteration counter grows.

**Change**: `wg-19-release`
**Iteration**: `2`
**Applied at**: `2026-11-08 09:22` (UTC `2026-11-08T02:22Z`)
**Executor**: `subagent-driven-development` through `@gotgenes/pi-subagents` 25.0.5, by operator decision ("use the available or default agents"; the `superspec.*` roles are not installed). Implementer `general-purpose` per task (`easy-worker` for Task 12); one combined spec and quality review per task by `general-purpose`; final whole-branch review by `general-purpose` on the most capable model, then one fix wave and a scoped re-review.

---

## Workspace

- **Worktree path**: `/Users/naicoi/Projects/oss/pi-jev-pilot.wg-19-release`
- **Worktree branch**: `wg-19-release`
- **Feature branch**: `WG-19`
- **Base branch**: `main`

---

## Commits

- **Range**: `281a20e..cb34e94`. `281a20e` is the step 0 scaffold commit on `WG-19`. This receipt is committed after `cb34e94`.
- **Count**: `26` (including the merge commit `fdf839d`)
- **Iteration 1**: `281a20e..94c96a8` plus the receipt `c4e116d`.
- **Iteration 2** (operator request, 2026-11-08): the operator asked to fold in two features merged to `main` after planning, #48 (CLI review on/off) and #49 (per-directory mode).
  - `fdf839d` merges `origin/main` cleanly.
  - `b67cd3e` adds task 4.6.
  - `de04ef4..cb34e94` is the docs task, reviewed with one fix round.
  - The merge does not touch `src/jev/`, `src/policy/` or `scripts/`, so the report numbers stand.

---

## Tasks

- **Completed**: `18 of 20` checkboxes in tasks.md flipped to `- [x]`
- **Remaining**: `5.1` (push branch and `v0.1.0` tag, needs the operator's go-ahead) and `5.2` (manual install acceptance of the tag). Both belong to finalize. `4.4` covers the roadmap wording; setting WG-19 to *Done* waits for 5.2.

---

## Operator gates passed during apply

- Task 9 dry run: the first snapshot (4 installed agents) excluded 195 of 200 worker briefs. The operator chose to extend it with the 19 agent files of the earlier setup (`naicoi92/pi-subagents/agents`, `ttdua/pi-superspec/agents` as `superspec.*`), parsed with the package's own agent reader. This was done in a scratch directory and not committed.
- Second dry run: 600 requests, $0.0592, 0 excluded. The operator approved sending.
- Run `2026-11-07T17-12-01-886Z-report`: 600 requests, 0 misses. Aggregates are in `docs/evidence/2026-11-08-release.md`; `cases.md` stays private under `~/.pi/agent/jev/replay/`.

---

## Contract deviations

- `routeStream` (internal): unchanged. Added the sibling `routeStreamRecords` in `scripts/replay/report-route.ts`, which also returns the route reason the aggregates need.
- Module placement (internal): routing lives in `scripts/replay/report-route.ts` and aggregation in `scripts/replay/report-compare.ts` (with their tests), not in `report.ts`. This keeps one responsibility per file. Contract shapes are unchanged.
- `compare.ts` exports (internal): `REPLAY_LAUNCH`, `modelOfConfig`, `decide`, `Decided`, `runsInBackground` and the case-text constant, now shared by pass 1 and the report pass.
- `Args.workers` (internal): optional, defaulted per pass by `workersFor(args)`: 46 for pass 1, 200 for report.
- `planReport` exclusion (internal, spec-binding): a main sample missing any `SHIPPED_MAIN_GROUPS` group is excluded, with or without a snapshot, so `--pass report` without `--capabilities` plans 0 requests. Documented in `docs/testing.md`.

---

## Review record

- Per-task reviews: Tasks 1, 2–3, 7–8 and 12 were clean. Tasks 4, 5 and 6 each needed one fix round. Tasks 10–11 needed two.
- Final whole-branch review: 0 Critical, 2 Important, 7 Minor. The fix wave is `5eb33f8..94c96a8`, and the re-review found 7 of 8 addressed.
- Parked: part of Minor 6. `compareReport` and `reportCases` each call the shared `analyse`, so answers are read and routed twice per run. This only costs time in an offline script.
- Final suite at `94c96a8`: `bun run test` gives 1828 pass, 0 fail. typecheck, lint and fmt:check are clean.
- Iteration 2, Task 4.6 (`docs/scenarios.md`, `README.md`, `CHANGELOG.md`, evidence method note): one task review with 1 Important and 1 Minor, then a fix round and a scoped re-review that addressed both.
- Final suite at `cb34e94`: `bun run test` gives 1935 pass, 0 fail. typecheck, lint and fmt:check are clean.

---

## Next step

Run `/opsx-verify wg-19-release`. Then finalize: with the operator's go-ahead, push and tag `v0.1.0`, and run the manual install acceptance (Tasks 5.1, 5.2).
