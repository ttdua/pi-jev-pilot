# Apply Receipt

> Generated at the end of the apply phase to mark code-implementation
> complete and provide verify with the state it needs.
> Overwritten on each apply iteration; iteration counter grows.

**Change**: `worker-turn-tuning`
**Iteration**: `1`
**Applied at**: `2026-11-23 23:40`
**Executor**: `subagent-driven-development` (implementer `superspec.implementer`, task reviewer `superspec.task-reviewer`, final whole-branch review on `superspec.task-reviewer`)

---

## Workspace

- **Worktree path**: `/Users/naicoi/Projects/oss/pi-jev-pilot.worker-turn-tuning`
- **Worktree branch**: `worker-turn-tuning`
- **Feature branch**: `feat/worker-turn-tuning`
- **Base branch**: `main`

---

## Commits

- **Range**: `867a73cc..877fab9c` (receipt commit follows)
- **Count**: `18`

---

## Tasks

- **Completed**: `25 of 25` checkboxes in tasks.md flipped to `- [x]`
- **Remaining**: none

---

## Contract deviations

- `TuningEvent.parameter`: optional in `record.ts` during Task 4 only, because timeout events did not carry it yet; made required in Task 5, matching the plan. Net: no deviation.
- `inFloorRange`, `orderedFloors` (new, `src/shared/turn-floors.ts`): added in the final-review fix wave so `effectiveFloors` (policy) and `resolveTurnFloors` (store) apply one rule; recorded in plan.md Contracts.
- `FLOOR_RUNS_MAX` (new, `src/store/tuning-file.ts`): exported so a test pins the store's 200-run bound to `FLOOR.runs`; recorded in plan.md Contracts.
- No `public` contract changed: `/jev tune` texts and the `tuning.json` format match the specs.

---

## Lanes

| Task | Lane branch | Lane range | Review | Merge commit |
|---|---|---|---|---|
| 1 | sequential | `867a73cc..ab7230d8` | Approved (1 minor) | n/a |
| 3 | sequential | `20f8040d..a37824dd` | Approved (minors) | n/a |
| 2 | sequential | `e3ee6d3a..453f562f` | Approved (minors) | n/a |
| 4 | sequential | `f2294de7..0acb576c` | Approved (minors) | n/a |
| 5 | sequential | `06e3e2fa..989067ee` | Approved (minors) | n/a |
| 6 | sequential | `bbeff8d2..58b78b80` | Approved (minors) | n/a |
| 7 | sequential | `20f3aa48..cd67859f` | Approved (minors) | n/a |
| 8 | sequential | `3f109dd8..6d0ef4ee` | Approved after fix round 1 | n/a |
| final | sequential | `094ed64c..877fab9c` | Whole-branch review: ready with fixes → fix wave → ready to merge | n/a |

Tasks ran sequentially in order 1, 3, 2, 4, 5, 6, 7, 8. Tasks 2 and 4 each depended on 3, and the rest formed a chain, so parallel lanes would not have saved time.

---

## Verification at receipt

- `bun run typecheck`: no type errors in 283 files.
- `bun run lint`: clean.
- `bun run fmt:check`: clean.
- `bun run test`: 2727 pass, 0 fail (baseline 2593).
- E2E: `tests/host/tuning-host.test.ts` "Floor applied line" runs the real Pi CLI with a seeded ledger of 200 counted `long` runs and a loopback Jev fixture. It checks `tuning.json` `version` 2 with the `long` floor at 80 (base 100), one `Jev tune: turnFloor.long 100→80 · /jev tune undo` notify, and no Jev request beyond the turn's own. `tests/host/worker-routing.test.ts` checks that a tuned floor reaches a real worker launch.

---

## Rulings and parked findings

- Ruling (Task 4): `TuningEvent.parameter` optional as an interim step, made required in Task 5. Cost if wrong: an event without a parameter reaching `text.ts`, which is now prevented by the type.
- Parked (final): the undo candidate check `floorCandidate` looks only at `base`, not range or order. The host's `isApplied` already reports nothing to undo for an out-of-order record, and the case is reachable only by hand-editing `tuning.json`. Cost if wrong: an undo on a hand-edited file could move a band that the report shows as not tuned.
- Deferred minors (can wait, per the final review): validator casts in `tuning-file.ts`; `floor-rules.ts` mixes value functions and transitions; `TuneView` floor arrays not `readonly`; `countedRuns` computed three times per band in the report; formatter reflows in the host tuning tests; missing RED evidence in Tasks 3 and 6.

---

## Next step

Run `/opsx-verify`.
