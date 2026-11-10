# Apply Receipt

> Generated at the end of the apply phase to mark code-implementation
> complete and provide verify with the state it needs.
> Overwritten on each apply iteration; iteration counter grows.

**Change**: `capability-folders`
**Iteration**: `1`
**Applied at**: `2026-11-09 15:15` (UTC)
**Executor**: `subagent-driven-development` (implementer `test-engineer`, task reviewer `code-reviewer`)

---

## Workspace

- **Worktree path**: `/Users/naicoi/Projects/oss/pi-jev-pilot.capability-folders`
- **Worktree branch**: `capability-folders`
- **Feature branch**: `refactor/capability-folders`
- **Base branch**: `main` (stack: `main` → `refactor/lint-thresholds` → `refactor/main-split` → `refactor/capability-folders`)

---

## Commits

- **Range**: `a2ba441..3ef72df` (implementation; the receipt commit follows)
- **Count**: `13`

---

## Tasks

- **Completed**: `17 of 17` checkboxes in tasks.md flipped to `- [x]`
- **Remaining**: none

---

## Contract deviations

none

Controller rulings (no contract shape changed):
- `checkImport`: `node:` and `bun:` specifiers count as packages (runtime built-ins) while other `<scheme>:` specifiers are rejected — final-review fix for the spec rule "relative path with extension, or a bare package name".
- `moduleSpecifiers`: a bare `require("…")` call is read like an import and `require(<non-literal>)` yields `"<non-literal>"` — final-review fix; a local function named `require` would also be read as a module load.

---

## Lanes

| Task | Lane branch | Lane range | Review | Merge commit |
|---|---|---|---|---|
| 1 Import checks and fixtures | sequential | `a2ba441..1fa8ef2` | clean after 1 fix round (layer → scripts edge) | n/a (sequential) |
| 2 Pure units into policy capability folders | sequential | `4165587..857d37a` | Approved | n/a (sequential) |
| 3 Host capability folders | sequential | `bd89e7d..207cd6e` | Approved | n/a (sequential) |
| 4 Documentation | sequential | `eb47889..a10b7a2` | Approved (first reviewer timed out; retried on user's decision) | n/a (sequential) |
| Final whole-branch review | sequential | `a2ba441..9f53d04`; fix wave `9f53d04..3ef72df` | With fixes → 2 Important fixed, re-review clean | n/a (sequential) |

Verification at `3ef72df`: `bun test` 2057 pass / 0 fail; `bun run typecheck`, `bun run lint` (53 warnings, cap 53), `bun run fmt:check` pass.
Rename-only commits `3d36b3f` (41 R100) and `5855c79` (57 R100) do not typecheck by design D7.

---

## Next step

Run `/opsx-verify`.
