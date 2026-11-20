## Why

The CLI review (`jev_review`, `/jev cli-review`) runs the operator's Codex or OpenCode CLI on request. It is no longer wanted, yet it adds a tool, two command forms, config and state fields and a docs section that every user carries. Separately, `effort.holdProviders` defaults to `["9router"]`, one operator's routing setup baked into the package; a fresh install should decide every prompt until the operator lists a provider.

## What Changes

**CLI review**
- From: the `jev_review` tool, `/jev cli-review on|off`, `/jev cli-review <codex|opencode> [model] [effort]`, a `cli review:` status line, `review.cli` / `review.enabled` in `config.json`, `cliReview` / `cliReviewEnabled` in `state.json`.
- To: none of these exist. `/jev cli-review ...` is unknown input and prints usage text.
- Reason: the feature is no longer wanted.
- Impact: **breaking** for anyone using the tool or command; non-breaking for files (below).

**Old CLI review keys in operator files**
- From: `review` is a validated config section; `cliReview` / `cliReviewEnabled` are validated state fields.
- To: for one minor release, a `review` section (any content) and `cliReview` / `cliReviewEnabled` (any content) are accepted on read and ignored. At every main `session_start`, the package rewrites a valid `config.json` without `review` and a valid `state.json` without the two fields, as the legacy tier migration does, with one notice for the config rewrite.
- Reason: `config.json` and `state.json` reject unknown keys, so a hard removal would make an operator's whole file invalid and drop every other setting.
- Impact: non-breaking.

**Effort hold default**
- From: `effort.holdProviders` defaults to `["9router"]`.
- To: it defaults to `[]`; no provider is held unless listed in `config.json`.
- Reason: the default should not encode one operator's provider.
- Impact: a user on `9router` who relied on the default now gets a decision on every prompt; adding `"effort": {"holdProviders": ["9router"]}` restores it.

**Docs**
- Removed: `docs/evidence/2026-11-06-cli-review.md`, the manual runner `tests/host/manual/cli-review-real.ts`, the CLI review section of `docs/workflow.md`, and the `CLI review instructions` block of `docs/jev-questions.md`.
- ADR `docs/decisions/0004-review-as-a-slot.md` is kept (it records the `reviewer` slot decision); only its `jev_review` sentence goes, replaced by a dated removal note.

Not changed: the `effort-hold` behaviour, the `reviewer`-style worker slots, the reserved slot names (`cli-review` and `review` stay reserved).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-review`: every requirement is removed.
- `config-file`: `review.cli` / `review.enabled` rules become "a `review` section is accepted and ignored"; a new legacy CLI review migration rewrites the file; the migration is added to the writers allowed by "Invalid config is never written".
- `state-file`: `cliReview` / `cliReviewEnabled` are accepted and dropped like the retired switches; reset no longer mentions the CLI review.
- `settings-resolution`: resolved settings no longer hold `review`; `effort.holdProviders` defaults to `[]`.
- `jev-command`: the status report loses the `cli review:` line; `/jev all` and `/jev reset` lose their CLI review parts; the usage text loses the two `cli-review` forms; the "CLI review default", "Codex model check", "OpenCode model check", "Unreadable model list" and "CLI review switch" requirements are removed.
- `package-loading`: the extension registers no tool.
- `host-test-harness`: install scenarios no longer expect `jev_review`.
- `release-metadata`: the README feature section no longer covers the CLI review.

## Impact

- Code removed: `src/host/review/`, `src/policy/review/`, `src/host/commands/cli-review.ts`, and the CLI review parts of `src/host/setup.ts`, `src/host/wiring/turn.ts`, `src/host/wiring/command.ts`, `src/host/commands/{args,apply,jev,status-format}.ts`, `src/store/{defaults,config,state-file,settings,settings-sections}.ts`.
- Code added: a CLI review key migration beside the tier migration in `src/store/config.ts`, `src/store/state-file.ts` and `src/host/platform/migrate.ts`.
- Tests: the CLI review tests under `tests/host/`, `tests/host/review/`, `tests/host/commands/`, `tests/policy/review/` go; store, command, load, harness and release tests are updated.
- Docs updated: `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `docs/architecture.md`, `docs/configuration.md`, `docs/decisions/0004-review-as-a-slot.md`, `docs/decisions/README.md` (status note), `docs/domain-model.md`, `docs/jev-questions.md`, `docs/privacy.md`, `docs/project-brief.md`, `docs/roadmap.md`, `docs/scenarios.md`, `docs/testing.md`, `docs/usage-guide.md`, `docs/workflow.md`. Removed: `docs/evidence/2026-11-06-cli-review.md`. Dated evidence files that mention the CLI review in passing stay as history.
- No dependency change; no network or Jev call is added.
