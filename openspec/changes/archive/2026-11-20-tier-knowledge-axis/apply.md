# Apply Receipt

> Generated at the end of the apply phase to mark code-implementation
> complete and provide verify with the state it needs.
> Overwritten on each apply iteration; iteration counter grows.

**Change**: `tier-knowledge-axis`
**Iteration**: `1`
**Applied at**: `2026-11-20 03:05`
**Executor**: `subagent-driven-development` (implementer `superspec.implementer`, task reviewer `superspec.task-reviewer`)

---

## Workspace

- **Worktree path**: `/Users/naicoi/Projects/oss/pi-jev-pilot.tier-knowledge-axis`
- **Worktree branch**: `tier-knowledge-axis`
- **Feature branch**: `spec/tier-knowledge-axis`
- **Base branch**: `main`

---

## Commits

- **Range**: `92d8b69c..6480d269` (plus this receipt commit)
- **Count**: `25`

---

## Tasks

- **Completed**: `29 of 29` checkboxes in tasks.md flipped to `- [x]`
- **Remaining**: none

---

## Contract deviations

- `MAIN_TIER_INSTRUCTION` (`src/jev/rubrics.ts`, internal): Task 3 added this export to keep the version-2 main tier instruction separate from the new worker tier instruction until Task 4. Task 4 deleted it along with `MAIN_TIER_CRITERIA` and `MAIN_TIER_QUESTION`, and removed its Contracts row. Net change: none.
- `LEGACY_TIER` (internal): defined in both `src/policy/launch.ts` and `src/store/defaults.ts`, because lint forbids `store/` importing `policy/`. A test pins the two maps equal. The shape is unchanged.
- `cutPoints` (internal): now exported from `src/policy/worker/index.ts` so that `scripts/replay` can use it (lint blocks deep imports).

---

## Lanes

| Task | Lane branch | Lane range | Review | Merge commit |
|---|---|---|---|---|
| 1 | sequential | `92d8b69c..792340ac` | Approved after fix round 1 | n/a |
| 2 | sequential | `9d3803ce..467d4c42` | Approved after fix round 1 | n/a |
| 3 | sequential | `48ac4bb1..2b98ffba` | Approved after fix round 1 | n/a |
| 4 | sequential | `56b26afb..c584ca1e` | Approved after fix round 1 | n/a |
| 5 | sequential | `4bbc4e1c..ffe35cd9` | Approved after fix round 1 | n/a |
| 6 | sequential | `eebf3adc..e08e3203` | Approved after fix round 1 | n/a |
| 7 | sequential | `0d98b805..f3304532` | Approved | n/a |
| 8 | sequential | `8ba494f2..b26d63f5` | Approved | n/a |
| final review fixes | sequential | `2c37e78e..6480d269` | Approved | n/a |

---

## Notes for verify

- **Replay (Task 7):** run with operator approval. The first run on `oc/jev-1.13-free` was rate-limited (HTTP 429) and discarded. The seed comes from the second run on `openrouter/typesafe/jev-1.14`: 1640 requests, 0 misses, every mode in range in both scopes, so the effort tiebreak (design D3) was not needed. Evidence: `docs/evidence/2026-11-20-knowledge-tier-mix.md`.
- **Known gaps:**
  - "Held gate-only effort shows the level in force" and "Tier criteria without a prefix" map to tests that are weaker than the spec (no check of a manual change to `low` with the status line; no thinking-unchanged check).
  - 202 scenario-map rows carried from the baseline name test titles that do not exist. This is pre-existing traceability debt; the rows this change added or marked `Intentional change` all match.
- **Last full gate:** typecheck, lint and fmt:check pass; `bun test` 2711 pass, 0 fail.

---

## Next step

Run `/opsx-verify`.
