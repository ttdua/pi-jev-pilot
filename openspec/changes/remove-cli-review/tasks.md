## 1. Store: retire the CLI review settings, migrate, change the hold default

Blocked by: none

- [x] 1.1 `src/store/config.ts`: map `review` to `retiredSection` and drop `Config.review` (spec `config-file` "Retired CLI review section", "Optional section rules"). Tests in `tests/store/config-read.test.ts`: the two "Retired CLI review section" scenarios, "Enum values" now at `skills.inject` / `subagents.forkLaunch`, and removal of the `review.cli` / `review.enabled` cases.
- [x] 1.2 `src/store/config.ts`: extend the legacy migration so one rewrite renames tier aliases and removes a top-level `review`, returning `{ renamed, removed }`. Rename `migrateTierKeys` to `migrateLegacyKeys`, and make `writeSlots` drop `review` before writing (spec `config-file` "Legacy tier migration", "Retired CLI review migration", "Slot writer replaces only crew.slots"). Tests in `tests/store/config-write.test.ts`: "New crew key goes last" with `skills`, "Retired review section not written back", and the migration result with a removal only and with a rename plus a removal.
- [x] 1.3 `src/store/state-file.ts`: accept `cliReview` and `cliReviewEnabled` with any value and drop them in `parseState`, next to the legacy switches. Delete `validateCliReview`, the CLI review validators and the `State` fields. Add `migrateRetiredStateFields` (or widen `migrateLegacySwitch` to cover both cases with one read). Spec: `state-file` "State file fields", "Reset", "Missing state means defaults". Tests in `tests/store/state-file.test.ts`: the three "Retired CLI review fields" scenarios, "Valid state read" without `cliReview`, the reset and missing wording, and the state migration writing only when a retired field is present.
- [x] 1.4 `src/store/defaults.ts`, `settings.ts`, `settings-sections.ts`: remove `DEFAULTS.review`, `Settings.review` and `resolveReview`; set `DEFAULTS.effort.holdProviders` to `[]`. Keep `cli-review` and `review` in `RESERVED_SLOT_NAMES` (spec `settings-resolution` "Effective settings resolver", "State overrides switches and mode"). Tests in `tests/store/settings.test.ts`, `settings-pin.test.ts`, `settings-sections.test.ts`, `validate.test.ts`: the default `[]`, "Hold provider from config", "Retired CLI review ignored", and no CLI review resolution cases.

## 2. Host: remove the review tool, the cli-review command and wire the migration

Blocked by: 1

- [x] 2.1 Delete `src/host/review/`, `src/policy/review/` and `src/host/commands/cli-review.ts`. Remove `registerReviewTool` from `src/host/setup.ts`. In `src/host/wiring/turn.ts`, a child returns `undefined` with no hide step, and main calls `parts.main.beforeAgentStart` with no sync (spec `package-loading` "Extension registrations are bounded").
- [x] 2.2 `src/host/commands/args.ts`, `apply.ts`, `jev.ts`, `status-format.ts`: remove both `cli-review` arg kinds, `parseCliReview`, `resolveCliReview`, the `apply` branches and their `cliReview` parameter, the two usage lines, the reset help wording and `reviewLine`. Drop the `exec` and `sync` deps of `runJev` and their wiring in `src/host/wiring/command.ts`; the after-change helper keeps reload and redraw. Specs: `jev-command` "Status report contents", "All decision features", "Reset command", "Usage text for unknown input".
- [x] 2.3 `src/host/platform/migrate.ts`: build one notice from the config result (renames and `review` removed) plus the path, and run the state retired-field migration beside the `switches.expert` one. Keep every failure swallowed (spec `config-file` "Legacy tier migration safety", "Retired CLI review migration safety"). Tests in `tests/host/platform/migrate.test.ts`: "Config review removed at start", "Rename and removal in one rewrite" (one notice naming both), "State CLI review fields removed at start", "Nothing to migrate" / "Nothing retired to remove", "Invalid config keeps its review section", "Removal write failure".
- [x] 2.4 Delete the CLI review tests: `tests/host/cli-review.test.ts`, `tests/host/review-tool.test.ts`, `tests/host/review/`, `tests/policy/review/`, `tests/host/commands/cli-review.test.ts`, `tests/host/manual/cli-review-real.ts` and `tests/fixtures/fake-cli/`. Also delete the `jev_review` fork case in `tests/host/context-mode.test.ts` and its header mention of `cli-review`.
- [x] 2.5 Update the remaining tests:
  - `tests/host/commands/{jev,jev-pin,apply,args,status-reply,jev-order}.test.ts`: no `Exec` import, no `exec` / `sync` deps, "Removed cli-review forms" gives usage and runs no process, usage has no `cli-review`, and the default status has no `cli review` line.
  - `tests/host/setup.test.ts` and `setup-wiring.test.ts`: no `tool:jev_review` registration, no `/jev cli-review on` case, and a host-level migration test with `review` beside the existing "Config migrated at start" and "Child session: legacy files are left alone" tests.
  - `tests/load.test.ts`: tools are empty.
  - `tests/host/harness.ts` and `harness.test.ts`: drop `reviewEnabled` and `REVIEW_ON`; the three install scenarios per spec `host-test-harness`.
  - `tests/host/{jev-base,main-effort,strategy-advice}.test.ts`: drop the `jev_review` absence checks.
  - `tests/host/main/gate.test.ts` and `tests/policy/main/hold.test.ts`: only adjust if they rely on the default.

## 3. Docs and changelog

Blocked by: 2

- [x] 3.1 Remove the CLI review from:
  - `README.md`: the feature list and off switches (spec `release-metadata` "README explains each feature's effect"); effort hold "default `9router`" becomes "no provider by default".
  - `docs/usage-guide.md`, `docs/workflow.md` (the CLI review section and the ADR 0004 link sentence), `docs/jev-questions.md` (the `CLI review instructions` block), `docs/architecture.md`, `docs/domain-model.md`, `docs/privacy.md`, `docs/project-brief.md`, `docs/roadmap.md`, `docs/scenarios.md`, `docs/testing.md` (manual CLI review procedure), `CONTRIBUTING.md`.
  - `docs/configuration.md`: drop the `review` rows, note the retired key and its removal at start; the `holdProviders` default becomes `[]`, and the example keeps `["9router"]` as an explicit setting.
  - `tests/release-check.ts` and `tests/release.test.ts`: drop `/jev cli-review off`.
- [x] 3.2 `docs/decisions/0004-review-as-a-slot.md`: replace the `jev_review` sentence in Decision with a dated note that the CLI review was removed. Leave `docs/decisions/README.md` status `Accepted`. Delete `docs/evidence/2026-11-06-cli-review.md`, and fix any link to it outside `docs/evidence/` and `openspec/changes/archive/`.
- [x] 3.3 `CHANGELOG.md` `[Unreleased]`, with the compatibility notes for `config.json` and `state.json` (accepted, ignored, removed at the first main start):
  - "Removed: CLI review (`jev_review`, `/jev cli-review`)".
  - "Changed: `effort.holdProviders` defaults to `[]`; add `\"effort\": {\"holdProviders\": [\"9router\"]}` to keep the old behaviour".
- [x] 3.4 Run `bun run typecheck`, `bun run lint`, `bun run fmt:check` and `bun test`. Then run `rg -n -i "jev_review|cli-review|cliReview|cli review|review\.(cli|enabled)|9router\"\]" src tests docs README.md CONTRIBUTING.md CHANGELOG.md`; every hit must be one of:
  - the retired-key read and migration code and its tests,
  - `RESERVED_SLOT_NAMES` and the reserved-names doc line,
  - `docs/evidence/`,
  - the ADR 0004 note,
  - CHANGELOG history and the new entry,
  - the configuration example and the retired-key note,
  - absence assertions for the removed command, tool and README text,
  - tests that set `["9router"]` explicitly as a configured provider (never as a default pin).

  The version bump is left to the release commit.
