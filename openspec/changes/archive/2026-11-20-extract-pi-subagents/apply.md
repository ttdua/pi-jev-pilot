# Apply Receipt

> Generated at the end of the apply phase to mark code-implementation
> complete and provide verify with the state it needs.
> Overwritten on each apply iteration; iteration counter grows.

**Change**: `extract-pi-subagents`
**Iteration**: `1`
**Applied at**: `2026-11-20 17:15`
**Executor**: `subagent-driven-development` (implementer `superspec.implementer`, task reviewer `superspec.task-reviewer`, final whole-branch review `superspec.task-reviewer`)

---

## Workspace

- **Worktree path**: `/Users/naicoi/Projects/oss/pi-jev-pilot.extract-pi-subagents`
- **Worktree branch**: `extract-pi-subagents`
- **Feature branch**: `pi-subagents`
- **Base branch**: `main`

---

## Commits

- **Range**: `0ee4d33a..cc111000` (this receipt commit follows)
- **Count**: `19`

---

## Tasks

- **Completed**: `33 of 33` checkboxes in tasks.md flipped to `- [x]`
- **Remaining**: none

---

## Contract deviations

- `harness()` in `tests/host/worker-fakes.ts` (internal test helper, not in Contracts): gained an optional `service` override so a test can pass a service without `registerLaunchPolicy` (final-review finding 4).

---

## Lanes

| Task | Lane branch | Lane range | Review | Merge commit |
|---|---|---|---|---|
| 1 | sequential | `0ee4d33a..ccbfe2ad` | Approved; 1 minor fixed (`ccbfe2ad`) | n/a (sequential) |
| 2 | sequential | `1c0a3bbd..04767fc7`, `9946cd8f` | Needs fixes → round 1 (3 Important) addressed; round 2 (setup-wiring step order, found by Task 3 review) | n/a |
| 3 | sequential | `a6be3e2c..a314a749` | Approved | n/a |
| 4 | sequential | `e00f65e3..d44c6d60` | Approved; 1 minor deferred, fixed in Task 5 and final wave | n/a |
| 5 | sequential | `22e46973..874338e3` | Needs fixes → round 1 (2 Important, 2 Minor) addressed | n/a |
| 6 | sequential | controller-run verification (no code commits) | n/a | n/a |
| final | sequential | `3702e160..cc111000` | Final review "With fixes" (2 Important, 2 Minor) → one fix wave, scoped re-review approved | n/a |

---

## Verification at apply end

- `bun install --frozen-lockfile`, `bun run typecheck`, `bun run lint`, `bun run fmt:check`: clean
- `bun run test`: 2618 pass, 0 fail
- `openspec validate extract-pi-subagents --strict`: valid
- Leftover search (6.2): matches only in guard tests (`tests/manifest.test.ts`, `tests/host/harness.ts`, `tests/host/jev-base.test.ts`) that assert absence
- E2E (real Pi, isolated agent dir): `pi install git:github.com/ttdua/pi-subagents@v0.1.1` + this checkout → `/jev` reports `executor: @ttdua/pi-subagents`; checkout only → `executor: no executor; worker routing is off`

## Rulings made during apply

- Live `executorState` reports both capabilities false for a tool without a service (spec), while `buildSnapshot` without an `executor` input falls back to both true (design D1, pure tests). Cost if wrong: one test helper change.
- The apply-time E2E used the network for the git install; automated tests stay offline. Cost: none.
- A scratch report was committed by mistake in `04767fc7` and untracked in a follow-up commit. Cost: none.
- Task 2 implementer session was lost after its commit; the controller reconstructed the report (no RED evidence for e823f63b); the review then found and fixed 3 Important issues.

---

## Next step

Run `/opsx-verify`. After archive, delete any of the 13 emptied capability folders left under `openspec/specs/` (task 6.4).
