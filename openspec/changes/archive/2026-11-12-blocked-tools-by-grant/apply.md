# Apply Receipt

**Change**: `blocked-tools-by-grant`
**Iteration**: `1`
**Applied at**: `2026-11-12 18:45`
**Executor**: `subagent-driven-development` (easy-worker implementer; code-reviewer whole-branch review; parent ran the tmux end-to-end check)

---

## Workspace

- **Worktree path**: `/Users/naicoi/Projects/oss/pi-jev-pilot.blocked-tools-by-grant`
- **Worktree branch**: `blocked-tools-by-grant`
- **Feature branch**: `docs/blocked-tools-by-grant`
- **Base branch**: `main`

---

## Commits

- **Range**: `786e42c1..HEAD` (the scaffold commit `786e42c1` is the feature branch tip; this file's own commit is the last one)
- **Count**: see `git rev-list --count 786e42c1..HEAD`

---

## Tasks

- **Completed**: `7 of 7` checkboxes in tasks.md flipped to `- [x]`
- **Remaining**: none

---

## Contract deviations

none

Notes (not deviations): `test/seams/identity.test.ts` needed a parent tool list in its harness (the plan allowed this). The host probe `tests/host/probes/policy/index.ts` also reports `parentToolCount` and `parentHasProtocolTools` so the host test can check the total independently.

---

## Whole-branch review

Verdict FIX NEEDED, 0 CRITICAL, 3 IMPORTANT, 2 MINOR. All five were fixed: README and usage guide wording (`6eb9ea6e`), dead `BUILTIN_EXTENSION_TOOL_NAMES` export removed (`cf08d0fa`), four lifecycle tests added with exact counts (`f16f8af5`), host test now compares against the independently recorded parent tool count: 8 + 8 = 14 + 2 (`ca4def46`), design.md names both read moments. Not re-reviewed after the fixes; `/opsx-verify` covers them. Fresh runs after the fixes: `bun run check` 0, executor suite 99 files / 2412 tests, `bun test` 2659 pass / 0 fail, `verify:public-types` OK. `bun run lint` fails repo-wide on files this change does not touch (formatting in `dist/*.d.ts`, `package.json`, `biome.json`, `vitest.config.ts`), same findings as on `main`.

End-to-end: `docs/evidence/2026-11-12-blocked-tools.md` (real Pi in tmux, agent with `tools: read, grep`, no `disallowed_tools`: `🔧4 · ⊘11` on all three surfaces).

---

## Lanes

| Task | Lane branch | Lane range | Review | Merge commit |
|---|---|---|---|---|
| Task 1 | sequential | `786e42c1..47a00cec` | covered by the whole-branch review | n/a |
| Task 2 | sequential | `810155af..bbd73682` | covered by the whole-branch review | n/a |

---

## Next step

Run `/opsx-verify`.
