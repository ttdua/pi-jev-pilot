# Remove CLI Review Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md` (`openspec/changes/remove-cli-review/`).

**Goal:** Remove the CLI review (`jev_review`, `/jev cli-review`, its config and state) so old operator files keep loading and are cleaned at the first main start, and default `effort.holdProviders` to `[]`.

**Architecture:**
- **Store:** retires the `review` config section and the `cliReview` / `cliReviewEnabled` state fields. Each is accepted with any value and contributes nothing.
- **Migration:** the legacy migration that already renames tier aliases also removes `review` in the same write. A sibling state migration drops the retired state fields.
- **Host:** loses the review tool, its hide/sync hooks, the `cli-review` command forms and the `exec` / `sync` deps that only they used.

**Tech Stack:** TypeScript on Bun (`bun test`, `bun run typecheck` = `bun check`, `oxlint`, `oxfmt`), Pi extension APIs.

## Global Constraints

- **Purity:** `policy/` stays pure; only `host/` touches Pi.
- **Fail open:** a retired key in `config.json` or `state.json`, of any value, MUST NOT make the file invalid or malformed.
- **Migration rules:** the migration runs in the main session only, makes no network call, never writes an invalid or unchanged file, and swallows every failure. One config rewrite shows at most one notification.
- **Reserved names:** `cli-review` and `review` stay in `RESERVED_SLOT_NAMES`.
- **Tests:** no secrets, paid calls or network beyond loopback.
- **Language:** public repository, so everything is in English.
- **Integration unit:** Tasks 1–2 form one integration unit; the tree may not typecheck between them.
  - Task 1 runs `bun test tests/store` and commits locally.
  - The first global `bun run typecheck` and full `bun test` gate is at the end of Task 2.
  - Do not add casts, optional fields or stubs to make an intermediate state compile.

## Review Focus

- **Default hold:** with `config.json` absent and a provider named `9router`, a main prompt is decided, not held. Task 1, `tests/store/settings.test.ts` "Everything defaulted" pins `[]`. Task 2 adds the host check to `tests/host/main.test.ts`: provider and prior anchor both on `9router`, no `holdProviders` given, `strategy` off → `risky` is asked and the ledger line has no `held`. This case MUST fail against the old `["9router"]` default.
- **Shape-agnostic config:** `config.json` with `"review": null` or `"review": []` is still valid with no `review` setting. Task 1 adds both values to the "Review section of any shape" table.
- **Retired fields only:** `state.json` holding only `{"version":1,"cliReviewEnabled":false}` reads ok with an empty state, and the migration rewrites it to `{"version":1}`. Task 1 covers the read in `state-file.test.ts`; Task 2 covers the migration in `migrate.test.ts`.
- **Slot writer:** a slot write on a config holding `review` and a legacy `tiers.fast` writes neither key (Task 1, `config-write.test.ts`).
- **No reviewer slot regression:** `/jev cli-review` with a valid slot-shaped word after it is still usage, not a slot command, because `cli-review` is reserved (Task 2, `tests/host/commands/jev.test.ts` "Removed cli-review forms").

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `config.json` key `review` | modified | accepted with any JSON value, ignored, removed at the first main start; no longer validated as `{cli, enabled}` | yes (file format) |
| `Config` (`src/store/config.ts`) | modified | `review` field removed; other fields unchanged | no |
| `migrateLegacyKeys` (`src/store/config.ts`, renamed from `migrateTierKeys`) | modified | `(raw: Record<string, unknown>) => { raw: Record<string, unknown>; renamed: [string, string][]; removed: string[] } \| undefined`: `removed` is `["review"]` when the top-level key was present, else `[]`; `undefined` when the file is invalid, has a conflicting tier pair, or has nothing to rename or remove. Does not mutate `raw`. | no |
| `migrateConfigFile` (`src/store/config.ts`) | modified | `(dir: string) => { renamed: [string, string][]; removed: string[] } \| { error: string } \| undefined` | no |
| `state.json` fields `cliReview`, `cliReviewEnabled` | modified | accepted with any value on read, dropped from the returned state, gone after the next write | yes (file format) |
| `State` (`src/store/state-file.ts`) | modified | `{ switches?: Partial<Record<Feature, boolean>>; mode?: Mode }` | no |
| `validateCliReview` (`src/store/state-file.ts`) | modified (deleted) | removed | no |
| `migrateRetiredStateFields` (`src/store/state-file.ts`) | new | `(dir: string) => boolean`: rewrites a valid `state.json` through `updateState(dir, s => s)` when the raw object has own key `cliReview` or `cliReviewEnabled`; `false` when there is nothing to do or the file is not valid | no |
| `Settings` (`src/store/settings.ts`) | modified | `review` field removed | no |
| `resolveReview` (`src/store/settings-sections.ts`) | modified (deleted) | removed | no |
| `DEFAULTS` (`src/store/defaults.ts`) | modified | `effort.holdProviders` is `[]`; `review` removed | yes (documented default) |
| `migrateLegacyNames` notice (`src/host/platform/migrate.ts`) | modified | one line `Jev: <parts> in <path>.`, where `<parts>` is `renamed <a → b, ...>` and/or `removed <keys>`, joined by `; ` when both are present | yes (UI text) |
| `JevArgs` (`src/host/commands/args.ts`) | modified | kinds `cli-review-switch` and `cli-review` removed | no |
| `/jev cli-review …` CLI | modified (removed) | any form is unknown input → usage text | yes |
| `/jev` usage and status text | modified | no `cli-review` usage lines, no `cli review:` status line, reset help without "CLI review default" | yes |
| `runJev` deps (`src/host/commands/jev.ts`) | modified | `exec` and `sync` removed | no |
| `applyCommand` (`src/host/commands/apply.ts`) | modified | `(parsed: Command, where: { cwd: string; dir: string }) => ApplyOutcome`; the internal `applyToState(parsed, where)` and `applyChange(parsed, dir)` also lose their `cliReview` parameter | no |
| Extension registrations | modified | no tool registered (`jev_review` removed) | yes |

---

## Task 1: Store — retire the CLI review settings, migrate, change the hold default — implements 1

**Covers:** 1.1, 1.2, 1.3, 1.4
**Difficulty:** Normal
**Blocked by:** none

**Files:**
- Modify: `src/store/config.ts`, `src/store/state-file.ts`, `src/store/defaults.ts`, `src/store/settings.ts`, `src/store/settings-sections.ts`
- Test: `tests/store/config-read.test.ts`, `tests/store/config-write.test.ts`, `tests/store/state-file.test.ts`, `tests/store/settings.test.ts`, `tests/store/settings-pin.test.ts`, `tests/store/settings-sections.test.ts`, `tests/store/validate.test.ts`

**Interfaces:**
- Produces: `migrateLegacyKeys`, `migrateConfigFile`, `migrateRetiredStateFields`, `State`, `Settings`, `DEFAULTS` (see Contracts). Task 2 consumes `migrateConfigFile` and `migrateRetiredStateFields`.

- [ ] **Step 1: Write failing config-read tests** in `tests/store/config-read.test.ts`:
  - "Old review section accepted and ignored": `{"review":{"cli":"opencode","enabled":true},"skills":{"inject":"suggest"}}` → `kind` `ok`, `config` equals `{ skills: { inject: "suggest" } }`.
  - "Review section of any shape": `{"cli":"claude"}`, `{"enabled":"on"}`, `true`, `null`, `[]` → each `ok` with no `review` in `config`.
  - "Enum values": `skills.inject` `"full"` and `subagents.forkLaunch` `"skip"` → problems at exactly those two paths.
  - Delete "CLI review enabled accepted" and "Non-boolean review.enabled".
  - "Both keys present with another field invalid" (~line 404) uses `skills.inject: "full"` instead of `review.cli` as the invalid live field.
  - Any `FULL` pin that holds `review` expects it absent from `config`.
- [ ] **Step 2: Write failing config-write tests** in `tests/store/config-write.test.ts`:
  - "New crew key goes last" with `classifier` + `skills` → keys `classifier`, `skills`, `crew`.
  - "Retired review section not written back": `classifier`, `review`, `skills` + a slot → keys `classifier`, `skills`, `crew`.
  - A slot write on `{tiers:{fast:"a/x"}, review:{}}` writes `tiers.basic` and no `review`.
  - Rename `describe("migrateTierKeys")` to `describe("migrateLegacyKeys")`, and existing cases additionally expect `removed: []`.
  - New cases: `{review:{enabled:true}, skills:{}}` → `{ raw: {skills:{}}, renamed: [], removed: ["review"] }`; `{tiers:{fast:"a/x"}, review:1}` → one result with both a rename and the removal; `{review:1, classifier:{timeoutMs:100}}` → `undefined`.
  - `migrateConfigFile` on a file with only `review` to remove → `{ renamed: [], removed: ["review"] }`, file mode kept, other key order kept.
  - "Other keys kept" (~lines 94–110, `FULL` holds `review`): the expected top-level keys and values are `FULL`'s without `review`.
- [ ] **Step 3: Write failing state tests** in `tests/store/state-file.test.ts`:
  - "Valid state read" without `cliReview`.
  - "Retired CLI review fields accepted and dropped": `{"version":1,"mode":"budget","cliReview":{"cli":"codex","model":"luna"},"cliReviewEnabled":true}` → state `{ mode: "budget" }`.
  - "Retired CLI review fields of any shape": `cliReview.model` `"-m"`; `cliReviewEnabled` `"yes"`; and the file `{"version":1,"cliReviewEnabled":false}` → ok, state `{}`.
  - "Retired CLI review fields gone after a write": `cliReviewEnabled` `true` + update mode `premium` → written file `{version:1, mode:"premium"}`.
  - `migrateRetiredStateFields`: true and rewritten when a retired field is present; false with unchanged bytes and mtime when absent, missing or malformed.
  - Reset and missing reads assert no switches and no mode.
  - Delete the `validateCliReview` test and the five dropped CLI review scenarios.
  - "Legacy review switch gone after a write" (~lines 97–107) no longer expects `cliReviewEnabled` to survive the write; assert it is gone.
- [ ] **Step 4: Write failing settings tests**:
  - `tests/store/settings.test.ts`:
    - "Everything defaulted" has `effort.holdProviders` `[]` and no `review` key; replace the `["9router"]` default pins at lines ~225–227.
    - "Hold provider from config": `effort.holdProviders` `["9router"]` → `["9router"]`.
    - "Retired CLI review ignored": `readConfig` + `readState` from files holding `review` / `cliReviewEnabled` resolve deep-equal to an empty config and state.
    - Delete the five CLI review resolution cases.
  - `tests/store/settings-sections.test.ts`: drop `resolveReview`.
  - `tests/store/settings-pin.test.ts`: remove `"review"` from `TOP_KEYS` (~line 5) and every `s.review` access. Delete the review-only resolution and freshness cases (~lines 91–146, 211–218), keeping the classifier freshness cases. The `DEFAULTS.effort.holdProviders` pin (~line 207) becomes `[]`.
  - `tests/store/validate.test.ts` (~line 161): the `DEFAULTS.effort.holdProviders` pin becomes `[]`, with no `DEFAULTS.review`. Keep `cli-review` and `review` in the `RESERVED_SLOT_NAMES` pin.
- [ ] **Step 5: Run** `bun test tests/store`. Expected: the new and updated assertions FAIL.
- [ ] **Step 6: Implement**
  - `config.ts`:
    - Map `review` to `retiredSection` and drop `Config.review`.
    - Rename `migrateTierKeys` to `migrateLegacyKeys`, removing a top-level `review` (key order kept) beside the tier renames.
    - `migrateConfigFile` returns `{ renamed, removed }`.
    - `writeSlots` starts from `migrateLegacyKeys(current.raw)?.raw ?? current.raw`, so `review` is never written back.
  - `state-file.ts`:
    - Retired-field validator entries `cliReview` and `cliReviewEnabled` use an accept-anything validator.
    - `parseState` drops them together with the legacy switches.
    - Delete `cliModel`, `cliEffort`, `cliReviewValidator`, `validateCliReview` and the `State` fields.
    - Add `migrateRetiredStateFields`; it may share the raw read with `migrateLegacySwitch`, but both exports stay.
  - `defaults.ts`: `effort.holdProviders` becomes `[]`, and `DEFAULTS.review` is removed.
  - `settings.ts` and `settings-sections.ts`: delete `resolveReview` and `Settings.review`.
- [ ] **Step 7: Run** `bun test tests/store`. Expected: PASS. `bun run typecheck` fails outside `src/store` (consumers are fixed in Task 2); do not fix them here.
- [ ] **Step 8: Commit** locally: `refactor(store)!: retire CLI review settings and default holdProviders to []`

---

## Task 2: Host — remove the review tool, the cli-review command and wire the migration — implements 2

**Covers:** 2.1, 2.2, 2.3, 2.4, 2.5
**Difficulty:** Hard
**Blocked by:** Task 1

**Files:**
- Delete:
  - Source: `src/host/review/`, `src/policy/review/`, `src/host/commands/cli-review.ts`.
  - Tests: `tests/host/cli-review.test.ts`, `tests/host/review-tool.test.ts`, `tests/host/review/`, `tests/policy/review/`, `tests/host/commands/cli-review.test.ts`, `tests/host/manual/cli-review-real.ts`, `tests/fixtures/fake-cli/`.
- Modify: `src/host/setup.ts`, `src/host/wiring/turn.ts`, `src/host/wiring/command.ts`, `src/host/commands/args.ts`, `src/host/commands/apply.ts`, `src/host/commands/jev.ts`, `src/host/commands/status-format.ts`, `src/host/platform/migrate.ts`
- Test:
  - Updated: `tests/host/platform/migrate.test.ts`, `tests/host/setup.test.ts`, `tests/host/setup-wiring.test.ts`, `tests/host/commands/{jev,jev-pin,apply,apply-types,args,status-reply,jev-order}.test.ts`, `tests/load.test.ts`, `tests/host/harness.ts`, `tests/host/harness.test.ts`, `tests/host/context-mode.test.ts`, `tests/host/jev-base.test.ts`, `tests/host/main-effort.test.ts`, `tests/host/strategy-advice.test.ts`, `tests/host/main.test.ts`.
  - Must stay green: `tests/host/effort-hold.test.ts`, `tests/policy/main/hold.test.ts`, `tests/host/main/gate.test.ts` (each sets `holdProviders` explicitly).

**Interfaces:**
- Consumes: `migrateConfigFile`, `migrateRetiredStateFields` (Task 1).
- Produces: `runJev` deps without `exec` / `sync`; `JevArgs` without the `cli-review` kinds (see Contracts).

- [ ] **Step 1: Write failing migration tests** in `tests/host/platform/migrate.test.ts`:
  - "Config review removed at start": `{"classifier":{...},"review":{"cli":"codex","enabled":true},"skills":{...}}` with mode `0640` → keys `classifier`, `skills`; mode kept; one note containing `review` and the file path.
  - "Rename and removal in one rewrite": `{"tiers":{"fast":"a/x"},"review":{"enabled":false}}` → `tiers.basic`, no `review`; exactly one note containing `tiers.fast → tiers.basic` and `review`.
  - "State CLI review fields removed at start": the spec's state → `{version:1, mode:"budget"}`; also `{"version":1,"cliReviewEnabled":false}` → `{version:1}`.
  - "Nothing retired to remove": bytes and mtime unchanged, no note.
  - "Invalid config keeps its review section": `review` + `classifier.timeoutMs: 100` → unchanged.
  - "Removal write failure" (`skipIf(isRoot)`): read-only dir → no throw, `review` still present.
- [ ] **Step 2: Write failing host tests**
  - `tests/host/setup-wiring.test.ts`:
    - Add a `review` key to the "Config migrated at start: before the status line, one notification" fixture and assert it is gone.
    - Add "Child session leaves the review section": same shape as "Child session: legacy files are left alone", with `{"review":{"enabled":true}}`.
    - Registration order drops `tool:jev_review`; the fake `getAllTools` no longer lists `jev_review`.
  - `tests/load.test.ts`: tools are `[]`.
  - `tests/host/commands/jev.test.ts` "Removed cli-review forms": each of `cli-review on`, `cli-review off`, `cli-review codex`, `cli-review opencode p/m high` → one warning, usage text without `cli-review`, `state.json` unchanged. Pass no `exec` dep, so a call to one would throw.
  - "Default status": no line starting `cli review`.
  - `tests/host/main.test.ts` "No hold by default": the selected model and the prior decided anchor are both on provider `9router` (same model), no `holdProviders` is given and `strategy` is off. The Jev request asks `risky`, the level is applied, and the ledger line has no `held` (Review Focus 1).
- [ ] **Step 3: Run** `bun test tests/host/platform/migrate.test.ts tests/host/setup-wiring.test.ts tests/load.test.ts tests/host/commands/jev.test.ts`. Expected: FAIL. For "No hold by default", which Task 1's default already turns green, temporarily set only `DEFAULTS.effort.holdProviders` back to `["9router"]`. Then run `bun test tests/host/main.test.ts -t "No hold by default"` and expect FAIL; restore `[]`, run it again and expect PASS. Do not commit the temporary value.
- [ ] **Step 4: Implement**
  - Delete the three source paths.
  - `setup.ts`: remove `registerReviewTool`.
  - `turn.ts`: in a child, return `undefined`; in main, call `parts.main.beforeAgentStart`. Remove the review imports and the sync `try`.
  - `command.ts`: drop `exec` and `sync`.
  - `args.ts`: remove `parseCliReview` and both kinds; `cli-review` falls through to usage, since it is reserved and not a slot.
  - `apply.ts`: remove both `cli-review` branches and the `cliReview` parameter from `applyChange`, `applyToState` and `applyCommand` (see Contracts). The caller in `jev.ts` passes two arguments.
  - `jev.ts`:
    - Remove `resolveCliReview`, `Deps.exec`, `Deps.sync` and the sync block in `reportStatus`.
    - Rename `reportStatus`'s doc to "Reload, redraw and report".
    - Remove the two usage lines; the reset help becomes `reset switches and mode`.
  - `status-format.ts`: remove `reviewLine` and its call.
  - `migrate.ts`: build the one notice per the Contracts, and call `migrateRetiredStateFields` in its own swallowed `try` after `migrateLegacySwitch`.
- [ ] **Step 5: Delete and update the remaining tests** per Files.
  - Delete the CLI review tests and fixtures.
  - In `context-mode.test.ts`, delete the "a fork calling jev_review…" test, the `fake-cli` copy and the `cli-review` header mention.
  - `harness.ts`: remove `reviewEnabled`.
  - `harness.test.ts`: remove `REVIEW_ON`.
    - "Executor and probe are loaded": `subagent` present.
    - "Probes only": no `subagent`.
    - "jev-pilot without an executor": no `subagent`, and `/jev` (sent the way `report()` in `tests/host/directory-mode-e2e.test.ts:64` does; reuse or move that helper into `tests/host/harness.ts`) reports `executor: no executor; worker routing is off`.
  - Remove the `jev_review` absence assertions in `jev-base`, `main-effort` and `strategy-advice`.
  - Commands tests drop `Exec` imports and `exec` / `sync` deps.
  - `tests/host/commands/apply-types.test.ts`: each `@ts-expect-error` call uses the new two-argument arity, so it fails only on the unsupported command kind, not on an extra argument.
  - `tests/host/commands/jev.test.ts`: delete the review-only "Switch survives a restart" (~line 1305); the feature-switch restart stays covered by `tests/host/jev-base.test.ts` (~lines 195–211).
- [ ] **Step 6: Run** `bun run typecheck && bun run lint && bun test`. Expected: PASS, with no import of `review/` left (the import-graph test passes).
- [ ] **Step 7: Commit** locally: `feat(cli-review)!: remove the CLI review tool and command, migrate retired keys`

---

## Task 3: Docs and changelog — implements 3

**Covers:** 3.1, 3.2, 3.3, 3.4
**Difficulty:** Easy
**Blocked by:** Task 2

**Files:**
- Modify: `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `docs/usage-guide.md`, `docs/workflow.md`, `docs/jev-questions.md`, `docs/architecture.md`, `docs/domain-model.md`, `docs/privacy.md`, `docs/project-brief.md`, `docs/roadmap.md`, `docs/scenarios.md`, `docs/testing.md`, `docs/configuration.md`, `docs/decisions/0004-review-as-a-slot.md`, `tests/release-check.ts`, `tests/release.test.ts`
- Delete: `docs/evidence/2026-11-06-cli-review.md`

- [ ] **Step 1: Update the release check**: in `tests/release-check.ts` and `tests/release.test.ts`, remove `/jev cli-review off` from the required off switches. Add an assertion that `README.md` contains neither `jev_review` nor `cli-review` (spec `release-metadata` "Every feature has an off switch"). Run `bun test tests/release.test.ts`. Expected: FAIL on the README.
- [ ] **Step 2: Edit docs** per tasks 3.1–3.2.
  - **`README.md`:** effort hold reads "for providers listed in `effort.holdProviders` (none by default)".
  - **`docs/configuration.md`:**
    - The `holdProviders` default is `[]`.
    - Drop the `review` table rows.
    - Add one line: "`review` (removed CLI review) is accepted and removed from the file at the next main start."
    - Keep `["9router"]` in the example.
  - **ADR 0004:** replace "The CLI review tool (`jev_review`) stays separate, on demand, and its command is `/jev cli-review`, leaving `reviewer` free as a slot name." with "The CLI review tool that stood beside this slot was removed on 2026-11-20 (change `remove-cli-review`); `reviewer` stays a slot name."
  - **Evidence:** delete `docs/evidence/2026-11-06-cli-review.md` and its links in `docs/roadmap.md`.
- [ ] **Step 3: CHANGELOG** `[Unreleased]`:
  - **Removed:** CLI review (`jev_review`, `/jev cli-review`). A `review` section in `config.json` and `cliReview` / `cliReviewEnabled` in `state.json` are accepted, ignored and removed at the first main session start.
  - **Changed:** `effort.holdProviders` defaults to `[]`; add `"effort": {"holdProviders": ["9router"]}` to keep holding on `9router`.
- [ ] **Step 4: Run** `bun run typecheck && bun run lint && bun run fmt:check && bun test`, then the `rg` audit from task 3.4. Expected: all green, and every `rg` hit is in the allowed list. The allowed list includes the removed-command and release absence assertions, and explicit `["9router"]` provider configuration and validation tests; no default pin may still expect `["9router"]`.
- [ ] **Step 5: Commit** locally: `docs: remove the CLI review and document the holdProviders default`

---

## Scenario → test

There are 114 scenarios in `specs/`; `cli-review` has only REMOVED requirements. Existing tests carry the scenario name or its behaviour. "(new or updated)" marks tests that Tasks 1–3 write or change.

**config-file**

- Read leaves the file untouched → `tests/store/config-read.test.ts`
- Slot writer refuses an invalid file → `tests/store/config-write.test.ts`
- Migration refuses an invalid file → `tests/store/config-write.test.ts`, `tests/host/platform/migrate.test.ts` (new or updated: `review` case)
- Other keys kept → `tests/store/config-write.test.ts`
- Invalid new slot refused → `tests/store/config-write.test.ts`
- New crew key goes last → `tests/store/config-write.test.ts` (new or updated)
- Retired review section not written back → `tests/store/config-write.test.ts` (new or updated)
- Last slot removed → `tests/store/config-write.test.ts`
- Created from nothing → `tests/store/config-write.test.ts`
- Config migrated at start → `tests/host/platform/migrate.test.ts`, `tests/host/setup-wiring.test.ts` (new or updated)
- State migrated at start → `tests/host/platform/migrate.test.ts`
- Legacy frontier slot kept → `tests/host/platform/migrate.test.ts`
- Nothing to migrate → `tests/host/platform/migrate.test.ts` (new or updated)
- Conflicting keys left alone → `tests/host/platform/migrate.test.ts`, `tests/store/config-write.test.ts`
- Write failure → `tests/host/platform/migrate.test.ts`, `tests/store/config-write.test.ts`
- Child session → `tests/host/setup-wiring.test.ts` ("Child session: legacy files are left alone")
- Duplicate hold provider → `tests/store/config-read.test.ts`
- Hold provider bounds → `tests/store/config-read.test.ts`
- Non-boolean parentRequest → `tests/store/config-read.test.ts`
- Enum values → `tests/store/config-read.test.ts` (new or updated)
- Forked launch setting accepted → `tests/store/config-read.test.ts`
- Forked launch setting rejected → `tests/store/config-read.test.ts`
- Deprecated forkedLaunch accepted → `tests/store/config-read.test.ts`
- Both keys present → `tests/store/config-read.test.ts`
- Old review section accepted and ignored → `tests/store/config-read.test.ts` (new or updated)
- Review section of any shape → `tests/store/config-read.test.ts` (new or updated)
- Config review removed at start → `tests/host/platform/migrate.test.ts` (new or updated)
- Rename and removal in one rewrite → `tests/host/platform/migrate.test.ts`, `tests/store/config-write.test.ts` (new or updated)
- State CLI review fields removed at start → `tests/host/platform/migrate.test.ts` (new or updated)
- Nothing retired to remove → `tests/host/platform/migrate.test.ts` (new or updated)
- Invalid config keeps its review section → `tests/host/platform/migrate.test.ts` (new or updated)
- Removal write failure → `tests/host/platform/migrate.test.ts` (new or updated)
- Child session leaves the review section → `tests/host/setup-wiring.test.ts` (new or updated)

**host-test-harness**

- Executor installs offline → `tests/host/harness.test.ts`
- Executor and probe are loaded → `tests/host/harness.test.ts` (new or updated)
- Probes only → `tests/host/harness.test.ts` (new or updated)
- jev-pilot without an executor → `tests/host/harness.test.ts` (new or updated)

**jev-command**

- Turn a feature off → `tests/host/commands/jev.test.ts`
- Switch survives a restart → `tests/host/jev-base.test.ts` (`/jev skills off`, restart, `/jev`)
- Turn a feature back on → `tests/host/commands/jev.test.ts`
- Status lists seven features → `tests/host/commands/jev.test.ts`
- Deprecated expert command → `tests/host/commands/jev.test.ts`, `tests/host/commands/apply.test.ts`
- Tools is not a feature → `tests/host/commands/jev.test.ts`
- Default status → `tests/host/commands/jev.test.ts` (new or updated)
- Directory mode in the report → `tests/host/commands/jev.test.ts`
- Malformed directory mode reported → `tests/host/commands/jev.test.ts`
- No executor → `tests/host/commands/jev.test.ts`, `tests/host/jev-base.test.ts`
- Key name, never value → `tests/host/commands/jev.test.ts`
- Malformed state reported → `tests/host/commands/jev.test.ts`
- Invalid config reported → `tests/host/commands/jev.test.ts`
- Deprecated tools section reported → `tests/host/commands/jev.test.ts`, `tests/host/jev-base.test.ts`
- Deprecation never notified on its own → `tests/host/jev-base.test.ts`
- Malformed tuning reported → `tests/host/commands/jev.test.ts`
- Empty tally → `tests/host/commands/jev.test.ts`
- Tally after work → `tests/host/commands/jev.test.ts`
- Mix with a full window → `tests/host/commands/jev.test.ts`
- Budget target shown → `tests/host/commands/jev.test.ts`
- Mix while the seed applies → `tests/host/commands/jev.test.ts`
- Empty window → `tests/host/commands/jev.test.ts`
- No mix without the executor → `tests/host/commands/jev.test.ts`
- Duplicate executor reported → `tests/host/commands/jev.test.ts`
- Executor without an agent registry reported → `tests/host/commands/jev.test.ts`
- All off → `tests/host/commands/jev.test.ts`
- All on → `tests/host/commands/jev.test.ts`
- Reset after changes → `tests/host/commands/jev.test.ts` (new or updated: no CLI review default)
- Reset removes the directory mode → `tests/host/commands/jev.test.ts`
- Refused reset keeps the directory mode → `tests/host/commands/jev.test.ts`
- Partial reset reports a warning and redraws → `tests/host/commands/jev.test.ts`
- Command from a later work group → `tests/host/commands/jev.test.ts`
- Usage lists the tune form → `tests/host/commands/jev.test.ts`
- Unknown mode → `tests/host/commands/jev.test.ts`
- Usage lists the mode form → `tests/host/commands/jev.test.ts`
- Unknown feature → `tests/host/commands/jev.test.ts`
- Bad value → `tests/host/commands/jev.test.ts`, `tests/host/commands/args.test.ts`
- Extra words → `tests/host/commands/jev.test.ts`, `tests/host/commands/args.test.ts`
- Removed cli-review forms → `tests/host/commands/jev.test.ts`, `tests/host/commands/args.test.ts` (new or updated)
- Removed review switch → `tests/host/commands/jev.test.ts`, `tests/host/commands/args.test.ts`
- Whitespace only → `tests/host/commands/jev.test.ts`
- Usage lists the slot forms → `tests/host/commands/jev.test.ts`

**package-loading**

- Loaded extension registers only /jev and handlers → `tests/load.test.ts` (new or updated)

**release-metadata**

- Tier and effort explained → `tests/release.test.ts`
- Every feature has an off switch → `tests/release.test.ts` (new or updated)

**settings-resolution**

- Everything defaulted → `tests/store/settings.test.ts` (new or updated)
- Config over default → `tests/store/settings.test.ts`
- Tuning over config → `tests/store/settings.test.ts`
- Forked launch from config → `tests/store/settings.test.ts`
- Fork launch from the deprecated key → `tests/store/settings.test.ts`
- Ignored tools section → `tests/store/settings.test.ts`
- Retired CLI review ignored → `tests/store/settings.test.ts` (new or updated)
- Hold provider from config → `tests/store/settings.test.ts` (new or updated)
- Switch off → `tests/store/settings.test.ts`
- Mode from state → `tests/store/settings.test.ts`
- Directory mode over state → `tests/store/settings.test.ts`
- Directory mode over the default → `tests/store/settings.test.ts`
- Directory mode changes only the mode → `tests/store/settings.test.ts`

**state-file**

- No file → `tests/store/state-file.test.ts` (new or updated)
- Reset clears everything → `tests/store/state-file.test.ts` (new or updated)
- Valid state read → `tests/store/state-file.test.ts` (new or updated)
- Retired CLI review fields accepted and dropped → `tests/store/state-file.test.ts` (new or updated)
- Retired CLI review fields of any shape → `tests/store/state-file.test.ts` (new or updated)
- Retired CLI review fields gone after a write → `tests/store/state-file.test.ts` (new or updated)
- Every documented feature accepted → `tests/store/state-file.test.ts`
- Legacy review switch accepted and dropped → `tests/store/state-file.test.ts`
- Legacy review switch alone → `tests/store/state-file.test.ts`
- Legacy review switch gone after a write → `tests/store/state-file.test.ts`
- Non-boolean legacy review switch → `tests/store/state-file.test.ts`
- Legacy tools switch accepted and dropped → `tests/store/state-file.test.ts`
- Legacy tools switch gone after a write → `tests/store/state-file.test.ts`
- Non-boolean legacy tools switch → `tests/store/state-file.test.ts`
- Legacy expert switch moved → `tests/store/state-file.test.ts`
- Frontier wins over the legacy switch → `tests/store/state-file.test.ts`
- Legacy expert switch gone after a write → `tests/store/state-file.test.ts`
- Non-boolean legacy expert switch → `tests/store/state-file.test.ts`
- Unknown feature → `tests/store/state-file.test.ts`
