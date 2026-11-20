## Context

The CLI review lives in its own modules (`src/host/review/`, `src/policy/review/`, `src/host/commands/cli-review.ts`) and touches shared code at these seams:

- **Registration:** `registerReviewTool` in `src/host/setup.ts`.
- **Tool sync:** `hideReviewInChild` / `syncReviewTool` in `src/host/wiring/turn.ts`, and the `sync` dependency of `/jev` in `src/host/wiring/command.ts`.
- **Command layer:** `src/host/commands/{args,apply,jev,status-format}.ts`. The `exec` dependency of `/jev` exists only for the model check.
- **Store:**
  - `DEFAULTS.review` in `defaults.ts`.
  - The `review` config validator and `Config.review` in `config.ts`.
  - `cliReview` / `cliReviewEnabled` and `validateCliReview` in `state-file.ts`.
  - `Settings.review` and `resolveReview` in `settings.ts` / `settings-sections.ts`.

Two precedents shape the migration:
- `remove-tool-assessment` retired the `tools` config section with an any-value validator (`retiredSection`).
- The legacy tier rename rewrites `config.json` and `state.json` at main `session_start` through `migrateLegacyNames` (`src/host/platform/migrate.ts`), with `migrateConfigFile` / `migrateTierKeys` in `config.ts` and `migrateLegacySwitch` in `state-file.ts`.

## Goals / Non-Goals

**Goals:**
- Delete every CLI review code path; leave no dead branch, unused export or unused `/jev` dependency (`exec`, `sync`).
- Keep existing `config.json` and `state.json` valid, and remove the dead keys from disk at the first main start.
- `effort.holdProviders` defaults to `[]`.

**Non-Goals:**
- Changing `effort-hold` semantics or the hold rule (`src/policy/main/hold.ts`).
- Changing the reserved slot names. `cli-review` and `review` stay reserved, so an old command word never becomes a slot.
- Rewriting dated evidence files that mention the CLI review in passing.

## Decisions

**Config `review` becomes a retired section.**
- `configValidator` maps `review` to the existing `retiredSection`, so `Config` has no `review` field and any shape is accepted.
- Accepting any shape is chosen over still validating `cli`/`enabled`: a section nobody reads should never make the config invalid.
- Rejected alternative: keeping the old validator for one release. A malformed leftover would then still turn the package off.

**State `cliReview` / `cliReviewEnabled` are accepted with any value and dropped on read.**
- The state validator takes both as retired fields that accept anything.
- `parseState` drops them in the same step that drops the legacy switches, so the next `updateState` writes them away.
- Any value is accepted for the same reason as the config section.
- This differs on purpose from `switches.review` / `switches.tools`, which stay boolean-only. Those are existing rules this change does not touch.

**Migration reuses the tier migration's path and guarantees.**
- **Config:** `migrateConfigFile` gains a second step that removes a top-level `review` key from the raw object, keeping every other key, its order and the file mode. It returns the removed paths beside the renamed ones.
  - The function and its result are renamed from "tier" to "legacy" wording so the type says what it does: `{ renamed, removed }`.
- **Notice:** `migrateLegacyNames` shows one notice per rewrite. When keys were removed, it reads `Jev: removed review in <path>.`, combined with the rename line when both happened.
- **State:** a new `migrateRetiredStateFields` rewrites through `updateState(dir, s => s)` when the raw file holds `cliReview` or `cliReviewEnabled`, the same way `migrateLegacySwitch` handles `switches.expert`. The two state checks may share one read.
- **Unchanged guarantees:** main session only; no network call; an invalid or unchanged file is never written; a failure is swallowed and retried at the next start.
- **Slot writer:** it also stops re-emitting `review`, as it already does for legacy tier keys. A slot write then never puts the dead key back.

**`/jev cli-review …` is unknown input.**
- `parseCliReview` and both `JevArgs` kinds are removed, so the parser returns usage.
- `cli-review` stays reserved, so it is not taken as a slot name.
- The `exec` and `sync` dependencies of `runJev` are removed with their only users. The "reload, sync, redraw" helper keeps reload and redraw.

**Status report.** `reviewLine` goes. Nothing replaces it: the deprecated-key line pattern (`deprecated: config tools is ignored`) is not extended, because the migration removes the key at the next start.

**Package registers no tool.**
- `registerReviewTool` and the `before_agent_start` review hide/sync go.
- `before_agent_start` keeps its main-session decision path.
- The `package-loading` "registrations are bounded" requirement now states exactly zero tools.

**Hold default.** `DEFAULTS.effort.holdProviders` becomes `[]`. `resolveEffort` already copies the default, so no other code changes.

**Spec bookkeeping.**
- The change sets `retire_capabilities: true`, so sync retires `openspec/specs/cli-review/` instead of leaving an empty capability.
- Requirements that lose scenarios are restated under a new name (ADDED plus REMOVED), as `remove-tool-assessment` did. The legacy tier migration requirements are MODIFIED so that the old and new migrations form one contract.
- Sync keeps existing Purpose lines, so two of them are rewritten by hand at sync:
  - `package-loading`: "registers only the `/jev` command and a bounded set of event handlers".
  - `state-file`: "holds the switches and mode set through `/jev`".

**ADR 0004.** The ADR stays, because its subject is the `reviewer` slot. The `jev_review` sentence in Decision is replaced by a dated line saying the CLI review was removed in this change.

## Risks / Trade-offs

- **[A 9router user loses hold silently]** → The CHANGELOG entry names the new default and the one-line config that restores it. `docs/configuration.md` shows it in the example.
- **[Accepting any `review` / `cliReview*` value hides a malformed leftover]** → Harmless: nothing reads it, and the migration removes it at the next main start.
- **[Wide diff across store, host, tests and docs]** → Tasks are split by layer: store, host, tests, docs. Typecheck and the import-graph test catch any leftover import of the removed modules.
- **[Removed keys reappear from an older package version writing state]** → Out of scope. An older version would reject its own missing keys anyway.

## Migration Plan

- No user action is needed. Old `config.json` and `state.json` keep loading, and the first main start removes the dead keys with one notice for the config.
- Users who relied on the `9router` hold default add `"effort": {"holdProviders": ["9router"]}`.
- Rollback is a revert of the change. A config already migrated simply lacks `review`, which the old version treats as "CLI review off".

## Open Questions

None.
