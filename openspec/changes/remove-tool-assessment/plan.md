# Remove Tool Assessment Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md` (`openspec/changes/remove-tool-assessment/`).

**Goal:** Remove Jev tool assessment so a worker's tools come only from the executor's resolution of its agent definition, while old config, state and ledger files keep working.

**Architecture:** Delete `src/policy/tools/`, `src/host/tools/` and the tool parts of the Jev wire layer; the launch policy keeps only routing. The store accepts and ignores the legacy `tools` config section and `switches.tools`, and reports the config key as deprecated for `/jev` status only. Ledger schema keeps the old `tools*` fields readable; writers stop emitting them.

**Tech Stack:** TypeScript on Bun (`bun test`, `bun check`, `oxlint`, `oxfmt`), Pi extension APIs, vendored `@ttdua/pi-subagents` (unchanged).

## Global Constraints

- No change under `packages/pi-subagents/`; no `VENDORED.md` entry.
- `RUBRIC_VERSION` stays `2`.
- `policy/` stays pure; only `host/` touches Pi.
- A legacy `tools` key in `config.json`, of any value, MUST NOT make the config invalid.
- The deprecation is shown only in the `/jev` status report as `deprecated: config tools is ignored`; no toast or notification.
- Tests need no secrets, paid calls or network beyond loopback.
- Public repository: everything in English.
- Tasks 1–3 form one integration unit: the tree may not typecheck between them inside the worktree. Each task runs its scoped tests and commits locally; the first global `bun run typecheck` and full `bun test` gate is at the end of Task 3, and no branch is pushed before it is green. Do not add casts, optional fields or stubs to make an intermediate state compile.

## Review Focus

- `config.json` with `"tools": null`, `"tools": []` or a string → still valid, deprecated reported (Task 1, `config-read.test.ts` "Deprecated tools section of any shape" covers `true`; add `null` to the same table).
- `state.json` with both `switches.review` and `switches.tools` and nothing else → read returns no `switches` at all (Task 1, add to `state-file.test.ts`).
- Invalid config that also holds `tools` → `/jev` shows the config problems and no deprecated line, since the read is invalid (Task 3, `jev.test.ts`).
- A slot named `tools` → still refused as reserved (Task 1, keep/assert in the existing reserved-name test in `tests/store/config-read.test.ts` or `tests/host/commands/slots*.test.ts`).
- Old ledger file containing a worker line with `toolsScored` → the tolerant reader and the cut-point window still read it (Task 2, add a case to `tests/host/worker/cutpoint-window.test.ts` with such a line; `ledger-schema.test.ts` and `ledger-pin.test.ts` stay unchanged).

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `Config` (`src/store/config.ts`) | modified | `tools` field removed; other fields unchanged | no |
| `ConfigRead` (`src/store/config.ts`) | modified | `{ kind: "ok"; present: boolean; config: Config; deprecated: readonly "tools"[] } \| { kind: "invalid"; issues: Issue[] }` (`deprecated` is `["tools"]` when the raw object has own key `tools`, else `[]`) | no |
| `config.json` key `tools` | modified | accepted with any JSON value, ignored, reported deprecated | yes |
| `Settings` (`src/store/settings.ts`) | modified | `tools` field removed; `switches` loses `tools` | no |
| `FEATURES` / `Feature` (`src/store/defaults.ts`) | modified | `["effort","subagents","skills","strategy","expert","status","verbose"]` | yes (`/jev` feature names) |
| `DECISION_FEATURES` (`src/store/defaults.ts`) | modified | `["effort","subagents","skills","strategy","expert"]` | no |
| `state.json` `switches.tools` | modified | boolean accepted on read and dropped; non-boolean is malformed | yes |
| `Snapshot.config` (`src/host/platform/readiness.ts`) | modified | `{ valid: true; deprecated: readonly "tools"[] } \| { valid: false; issues: Issue[] }` | no |
| `/jev <feature> on\|off` CLI | modified | `<feature>` no longer accepts `tools`; `/jev tools …` prints usage | yes |
| `/jev` status text | modified | seven feature lines; executor lines end `worker routing is off`; `deprecated: config tools is ignored` under `problems:` | yes |
| `Decided` (`src/host/worker/policy.ts`) | modified | `{ launch: LaunchEntry }` (wrapper kept; `tools` field removed) | no |
| `WorkerHost` (`src/host/worker/policy.ts`) | modified | `assess` dep removed | no |
| `LaunchBook` held record (`src/host/worker/launches.ts`) | modified | `grantedTools` removed; `bound()` removed | no |
| `WorkerLineInput` (`src/policy/worker/worker-line.ts`) | modified | `toolCounts` removed; `ToolCounts` re-export removed from `src/policy/worker/index.ts` | no |
| worker ledger line | modified | writers never emit `toolsScored`, `toolsFlagged`, `toolsGranted`; schema still accepts them | yes (file format) |
| Jev worker/tool request | modified | no `tool::<name>` / `grant::<name>` questions; no separate tool request | yes (wire) |

---
## Task 1: Store — retire the tools settings and switch — implements 1

**Covers:** 1.1, 1.2, 1.3, 1.4, 1.5
**Difficulty:** Normal
**Blocked by:** none

**Files:**
- Modify: `src/store/config.ts`, `src/store/settings.ts`, `src/store/settings-sections.ts`, `src/store/defaults.ts`, `src/store/state-file.ts`
- Test: `tests/store/config-read.test.ts`, `tests/store/config-write.test.ts`, `tests/store/validate.test.ts`, `tests/store/settings.test.ts`, `tests/store/settings-sections.test.ts`, `tests/store/settings-pin.test.ts`, `tests/store/state-file.test.ts`; unchanged and must stay green: `tests/store/ledger-schema.test.ts`, `tests/store/ledger-pin.test.ts`

**Interfaces:**
- Produces: `ConfigRead` with `deprecated`, `Config` and `Settings` without `tools`, `FEATURES`, `DECISION_FEATURES` (see Contracts).

- [ ] **Step 1: Write failing config tests** in `tests/store/config-read.test.ts`: "Deprecated tools section ignored" (`{"tools":{"mode":"enforce","grantAt":0.9}}` → `kind` `ok`, `config` has no `tools`, `deprecated` `["tools"]`); "Deprecated tools section of any shape" (`{"mode":"remove","grantAt":"high"}`, `{"grantAt":0.3}`, `true`, `null` → each `ok`, `deprecated` `["tools"]`); "No tools section, nothing deprecated" (`{}` and a missing file → `deprecated` `[]`). Update whole-shape pins: `FULL` (which holds `"tools": { "mode": "observe" }`) now expects `config` = `JSON.parse(FULL)` without `tools` and `deprecated: ["tools"]`; every other `ok` pin gets `deprecated: []`. Change "Enum values" to `skills.inject` + `review.cli` only. Delete the two grant-cut tests.
- [ ] **Step 2: Update config-write tests** in `tests/store/config-write.test.ts`: the invalid-config fixture that uses `tools.mode: "remove"` switches to an invalid live field (`skills.inject: "full"`); add "slot writer keeps an opaque tools section" (config with `tools: {mode: "enforce"}` + slot write → written file still has the same `tools` value). In `tests/store/validate.test.ts` update the `FEATURES` pin to the seven names, delete the `DEFAULTS.tools.mode` pin, and keep `tools` in the `RESERVED_SLOT_NAMES` pin.
- [ ] **Step 3: Write failing settings and state tests**: `tests/store/settings.test.ts` "Ignored tools section" (config with `tools` resolves deep-equal to the empty-config result; `"tools" in settings` false) and "Everything defaulted" without `tools` and with seven switches; `tests/store/settings-sections.test.ts` drops `resolveTools`; `tests/store/state-file.test.ts` "Legacy tools switch accepted and dropped", "Legacy tools switch gone after a write", "Non-boolean legacy tools switch" (problem at `switches.tools`), "Every documented feature accepted" with seven features, and `{"version":1,"switches":{"review":true,"tools":false}}` → state with no `switches`.
- [ ] **Step 4: Run** `bun test tests/store` — Expected: the new and updated assertions FAIL against the old code.
- [ ] **Step 5: Implement**: `config.ts` replaces the `tools` validator with one that accepts any value and yields `undefined`, removes `tools` from `Config`, and `readConfig` sets `deprecated` to `["tools"]` when `Object.hasOwn(raw, "tools")`, else `[]` (also `[]` for a missing file); remove `resolveTools` and `Settings.tools`; drop `tools` from `FEATURES`, `DECISION_FEATURES`, `DEFAULTS.tools`, `DEFAULTS.switches` (keep it in `RESERVED_SLOT_NAMES`); `state-file.ts` accepts boolean `tools` next to `review` and renames `dropLegacyReview` to `dropLegacySwitches`, dropping both. Update `settings-pin.test.ts` only where it pins `tools`.
- [ ] **Step 6: Run** `bun test tests/store` — Expected: PASS. `bun run typecheck` is expected to fail outside `src/store` and `tests/store` (consumers fixed in Tasks 2–3); do not fix them here.
- [ ] **Step 7: Commit** locally `refactor(store): retire tools settings and switch`

---

## Task 2: Host and wire — remove tool assessment — implements 2

**Covers:** 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
**Difficulty:** Hard
**Blocked by:** Task 1

**Files:**
- Delete: `src/host/tools/` (all), `src/policy/tools/` (all), `tests/host/tool-assessment.test.ts`, `tests/host/tools/`, `tests/policy/tools/`
- Modify: `src/host/worker/policy.ts`, `src/host/worker/outcomes.ts`, `src/host/worker/launches.ts`, `src/host/worker/routing.ts`, `src/policy/worker/worker-line.ts`, `src/policy/worker/index.ts`, `src/jev/questions.ts`, `src/jev/rubrics.ts`, `src/jev/state.ts`
- Test: `tests/host/worker/policy.test.ts`, `tests/host/worker/cutpoint-window.test.ts`, `tests/host/worker-routing.test.ts`, `tests/host/worker-ledger.test.ts`, `tests/host/worker-fakes.ts`, `tests/jev/questions.test.ts`, `tests/jev/state.test.ts`, `tests/policy/worker/worker-line.test.ts`, `tests/host/launch-policy-evidence.test.ts`

**Interfaces:**
- Consumes: `Settings` without `tools`, `FEATURES` without `tools` (Task 1).
- Produces: `Decided`, `WorkerHost`, `LaunchBook`, `WorkerLineInput` as in Contracts.

- [ ] **Step 1: Write the regression tests first, against the current code**: in `tests/host/worker/policy.test.ts` "No tool questions or tool adjustment" (harness with `switches: { tools: true }` and `toolsMode: "enforce"` while those options still exist, so the old code assesses; one routed launch whose agent declares no tools and whose fixture answers flag `edit` → `h.asks` holds exactly one request and none of its question keys starts with `tool::` or `grant::`; the adjustment has no `addTools` / `removeTools`. After Task 1 the harness options `toolsMode` / `grantAt` / `switches.tools` disappear: the test then builds its snapshot from `readConfig` on a temp dir holding `{"tools":{"mode":"enforce"}}` so the legacy path is exercised end to end) and "Routing off sends nothing about tools" (`switches.subagents` false → `h.asks` empty, adjustment `undefined`); in `tests/host/worker-ledger.test.ts` "No tool counts" (completed routed launch line has none of `toolsScored`, `toolsFlagged`, `toolsGranted`; a resume writes no line); in `tests/host/worker/cutpoint-window.test.ts` a legacy worker line with `toolsScored` 6 is read into the window. Run them before changing code (`git stash` Task 1 if needed, or run on the parent commit) — Expected RED on the old code: "No tool questions or tool adjustment" fails with two asks (worker + tool) and `removeTools: ["edit"]`; "No tool counts" fails because the line carries `toolsScored`; record the output.
- [ ] **Step 2: Remove the policy path**: `decideLaunch` gates on config/key/executor and `switches.subagents` only, calls `classifyLaunch` and `routeLaunchEntry`, returns `routed?.write` when it has keys, else `undefined`; `Decided = { launch: LaunchEntry }`; drop `assess` from `WorkerHost` and from `routing.ts`.
- [ ] **Step 3: Remove outcome tracking**: delete the `bound` grant handler in `outcomes.ts`, `grantedTools` and `bound()` in `launches.ts`, `toolCounts` in `WorkerLineInput` and its three writes in `worker-line.ts`, and the `ToolCounts` re-export in `src/policy/worker/index.ts`.
- [ ] **Step 4: Remove the wire layer**: delete `TOOL_QUESTION`, `GRANT_QUESTION`, the tool-question builder, `buildToolState` / `ToolStateInput` / `ToolState` and their tests in `tests/jev/`; delete `src/host/tools/`, `src/policy/tools/`, `tests/host/tools/`, `tests/policy/tools/`, `tests/host/tool-assessment.test.ts`; update `tests/host/worker-fakes.ts` and `tests/policy/worker/worker-line.test.ts` for the removed fields.
- [ ] **Step 5: Trim evidence tests**: in `tests/host/launch-policy-evidence.test.ts` delete "Enforce removes", "Enforce grants", "Ordering control: with tool assessment off, the child starts while a held answer waits", "Resumed worker is not reassessed", "Jev down in enforce keeps the default tools", the `flag` / `grant` answer helpers and the `enforce` option of `jevConfig`; in the e2e case drop the enforce-grant step and its assertions. Keep "Grant reaches the child", "disallowed_tools wins over a grant" and `tests/host/probes/policy/` (executor seam).
- [ ] **Step 6: Run** `bun test tests/host/worker tests/host/worker-ledger.test.ts tests/host/worker-routing.test.ts tests/jev tests/policy` — Expected: PASS, including the Step 1 tests. Global typecheck may still fail on command/status consumers (Task 3).
- [ ] **Step 7: Commit** locally `refactor(worker): remove Jev tool assessment (#81)`

---

## Task 3: Command and status surface — implements 3

**Covers:** 3.1, 3.2, 3.3
**Difficulty:** Normal
**Blocked by:** Task 1, Task 2 (added: the integration gate in Step 5 needs Task 2's removals to typecheck)

**Files:**
- Modify: `src/host/platform/readiness.ts` (`buildSnapshot`), `src/host/commands/status-format.ts`, `src/host/commands/jev.ts`
- Test: `tests/host/commands/jev.test.ts`, `tests/host/platform/readiness.test.ts`, `tests/host/status/line.test.ts`, `tests/host/jev-base.test.ts`, `tests/host/main/rich.test.ts`; `ConfigRead` fixtures (add `deprecated: []`) in `tests/host/main.test.ts`, `tests/host/tuning-fakes.ts`, `tests/host/commands/status-reply.test.ts`, `tests/host/tuning/step.test.ts`, `tests/host/main/gate.test.ts`, `tests/host/main/timing.test.ts`, `tests/host/commands/jev-order.test.ts`, `tests/replay/inputs.test.ts`

**Interfaces:**
- Consumes: `ConfigRead.deprecated`, `FEATURES`, `DECISION_FEATURES` (Task 1).
- Produces: `Snapshot.config` with `deprecated` (Contracts).

- [ ] **Step 1: Write failing tests**: `tests/host/platform/readiness.test.ts` — `buildSnapshot` with a valid config read with `deprecated ["tools"]` → `snapshot.config` `{ valid: true, deprecated: ["tools"] }`; with `[]` → `deprecated: []`; with an invalid read → `{ valid: false, issues }`. `tests/host/commands/jev.test.ts` — "Status lists seven features" (exact `features:` block, no `tools`); "Tools is not a feature" (`/jev tools off` → one warning equal to `usageText()`, `state.json` bytes unchanged); "Deprecated tools section reported" (valid config with `tools` → report contains `deprecated: config tools is ignored`, not `config error`; the status line text equals the one for the same config without `tools`); an invalid config that also holds `tools` → config problems listed and no `deprecated:` line; "No executor" / "Duplicate executor reported" expect `worker routing is off` and no `tool assessment`; "All off" / "All on" assert exactly five decision features (fix the six-feature assertion at line ~546). `tests/host/jev-base.test.ts` — "Deprecation never notified on its own" (config with `tools`, session start, one prompt, one worker launch, no `/jev` → no notification text contains `tools`); fix the six-feature list at line ~106. `tests/host/status/line.test.ts` "all off" with five features.
- [ ] **Step 2: Run** `bun test tests/host/commands tests/host/platform tests/host/status tests/host/jev-base.test.ts` — Expected: the new assertions FAIL.
- [ ] **Step 3: Implement**: `buildSnapshot` maps `configRead.deprecated` into `Snapshot.config` (valid branch only); `executorLine` texts end `worker routing is off`; `formatStatus` pushes `  deprecated: config tools is ignored` into `problems` when `s.config.valid && s.config.deprecated.includes("tools")`; `jev.ts` needs no special case (parsing and usage follow `FEATURES`). `src/host/status/line.ts` already uses `DECISION_FEATURES`; leave it. Add `deprecated: []` to the `ConfigRead` fixtures listed above.
- [ ] **Step 4: Run** `bun test tests/host/commands tests/host/platform tests/host/status tests/host/jev-base.test.ts` — Expected: PASS.
- [ ] **Step 5: Integration gate (Tasks 1–3)**: `bun run typecheck && bun run lint && bun test` — Expected: all PASS, including `tests/import-graph.test.ts`, `tests/replay/` and `tests/host/jev-base.test.ts`. Fix any remaining consumer in the task that owns it before committing.
- [ ] **Step 6: Commit** `feat(jev): drop the tools feature and report the deprecated config key`

---

## Task 4: Docs and changelog — implements 4

**Covers:** 4.1, 4.2, 4.3
**Difficulty:** Easy
**Blocked by:** Task 2, Task 3

**Files:**
- Modify: `README.md`, `docs/configuration.md`, `docs/usage-guide.md`, `docs/jev-questions.md`, `docs/jev-contract.md`, `docs/architecture.md`, `docs/domain-model.md`, `docs/glossary.md`, `docs/privacy.md`, `docs/workflow.md`, `docs/roadmap.md`, `docs/project-brief.md`, `CHANGELOG.md`
- Test: `tests/release-check.ts`, `tests/release.test.ts`

- [ ] **Step 1: Write a failing release check**: in `tests/release-check.ts` the decision features become the five names, and add a check that the README feature section does not mention `/jev tools` or "tool assessment"; run `bun test tests/release.test.ts` — Expected: FAIL on the current README.
- [ ] **Step 2: Edit docs**: remove tool-assessment sections and the `tools` switch; `docs/configuration.md` replaces the `tools` table with one line: "`tools`: removed; accepted and ignored, and `/jev` reports it as deprecated"; `docs/usage-guide.md` lists seven features; `docs/jev-questions.md` drops `tool::` / `grant::`. Leave `docs/evidence/` and `docs/decisions/` untouched.
- [ ] **Step 3: CHANGELOG** `[Unreleased]` → `### Removed`: "Tool assessment: Jev no longer removes or grants worker tools; a worker's tools come from its agent definition. The `tools` switch and `/jev tools` are gone. A `tools` section in `config.json` and `switches.tools` in `state.json` are ignored, and existing ledger lines with tool counts remain readable ([#81](https://github.com/ttdua/pi-jev-pilot/issues/81))."
- [ ] **Step 4: Verify** `bun run typecheck && bun run lint && bun run fmt:check && bun test` — Expected: all PASS. Then `rg -n "tool::|grant::|toolsScored|grantAt|tool assessment" src tests docs README.md CHANGELOG.md` and classify every hit: allowed are the ledger read path (`src/store/ledger-schema.ts`, `tests/store/ledger-schema.test.ts`, `tests/store/ledger-pin.test.ts`, the legacy-line window test), compatibility tests feeding a legacy `tools` section, executor seam cases, `docs/evidence/`, `docs/decisions/` and the CHANGELOG / configuration deprecation notes; any other hit is a leftover to remove.
- [ ] **Step 5: Commit** `docs: remove tool assessment from the docs (#81)`

Version bump and release metadata are out of scope: they belong to the release commit (`chore(release): …`), as for 0.4.0 and 0.4.1; the CHANGELOG entry stays under `[Unreleased]`.

---

## Scenario → test

Every scenario in `specs/` (163; `tool-assessment` has only REMOVED requirements). Existing tests carry the scenario name; "(new or updated in this change)" marks tests written or changed by Tasks 1–4.

**config-file**

- Duplicate hold provider → `tests/store/config-read.test.ts`
- Hold provider bounds → `tests/store/config-read.test.ts`
- Non-boolean parentRequest → `tests/store/config-read.test.ts`
- Enum values → `tests/store/config-read.test.ts` (new or updated in this change)
- CLI review enabled accepted → `tests/store/config-read.test.ts`
- Non-boolean review.enabled → `tests/store/config-read.test.ts`
- Forked launch setting accepted → `tests/store/config-read.test.ts`
- Forked launch setting rejected → `tests/store/config-read.test.ts`
- Deprecated tools section ignored → `tests/store/config-read.test.ts` (new or updated in this change)
- Deprecated tools section of any shape → `tests/store/config-read.test.ts` (new or updated in this change)
- No tools section, nothing deprecated → `tests/store/config-read.test.ts` (new or updated in this change)

**decision-ledger**

- Valid main line accepted → `tests/store/ledger-schema.test.ts`
- Valid worker line accepted → `tests/store/ledger-schema.test.ts`
- Worker line with cut-point fields accepted → `tests/store/ledger-schema.test.ts`
- Older worker line still accepted → `tests/store/ledger-schema.test.ts`
- Valid correction line accepted → `tests/store/ledger-schema.test.ts`
- Unknown kind rejected → `tests/store/ledger-schema.test.ts`
- Field from another kind rejected → `tests/store/ledger-schema.test.ts`
- Missing required field rejected → `tests/store/ledger-schema.test.ts`
- Exported field sets match the table → `tests/store/ledger-schema.test.ts`
- Unknown agent value is still an identifier → `tests/store/ledger-schema.test.ts`
- Worker line with effective launch fields accepted → `tests/store/ledger-schema.test.ts`
- Bad effective thinking rejected → `tests/store/ledger-schema.test.ts`

**jev-command**

- Turn a feature off → `tests/host/commands/jev.test.ts`
- Switch survives a restart → `tests/host/commands/jev.test.ts`
- Turn a feature back on → `tests/host/commands/jev.test.ts`
- Status lists seven features → `tests/host/commands/jev.test.ts` (new or updated in this change)
- Tools is not a feature → `tests/host/commands/jev.test.ts` (new or updated in this change)
- Default status → `tests/host/commands/jev.test.ts`
- Directory mode in the report → `tests/host/commands/jev.test.ts`
- Malformed directory mode reported → `tests/host/commands/jev.test.ts`
- CLI review default shown → `tests/host/commands/jev.test.ts`
- No executor → `tests/host/commands/jev.test.ts` (new or updated in this change)
- Key name, never value → `tests/host/commands/jev.test.ts`
- Malformed state reported → `tests/host/commands/jev.test.ts`
- Invalid config reported → `tests/host/commands/jev.test.ts`
- Deprecated tools section reported → `tests/host/commands/jev.test.ts` (new or updated in this change)
- Deprecation never notified on its own → `tests/host/jev-base.test.ts` (new or updated in this change)
- Malformed tuning reported → `tests/host/commands/jev.test.ts`
- Empty tally → `tests/host/commands/jev.test.ts`
- Tally after work → `tests/host/commands/jev.test.ts`
- Mix with a full window → `tests/host/commands/jev.test.ts`
- Budget target shown → `tests/host/commands/jev.test.ts`
- Mix while the seed applies → `tests/host/commands/jev.test.ts`
- Empty window → `tests/host/commands/jev.test.ts`
- No mix without the executor → `tests/host/commands/jev.test.ts`
- Duplicate executor reported → `tests/host/commands/jev.test.ts` (new or updated in this change)
- All off → `tests/host/commands/jev.test.ts` (new or updated in this change)
- All on → `tests/host/commands/jev.test.ts` (new or updated in this change)
- All leaves the CLI review alone → `tests/host/commands/jev.test.ts`
- Command from a later work group → `tests/host/commands/jev.test.ts`
- Usage lists the tune form → `tests/host/commands/jev.test.ts`
- Unknown mode → `tests/host/commands/jev.test.ts`
- Usage lists the mode form → `tests/host/commands/jev.test.ts`
- Unknown feature → `tests/host/commands/jev.test.ts`
- Bad value → `tests/host/commands/jev.test.ts`
- Extra words → `tests/host/commands/jev.test.ts`
- Extra words after cli-review → `tests/host/commands/jev.test.ts`
- Removed review switch → `tests/host/commands/jev.test.ts`
- Extra words after cli-review off → `tests/host/commands/jev.test.ts`
- Usage lists the cli-review switch → `tests/host/commands/jev.test.ts`
- Whitespace only → `tests/host/commands/jev.test.ts`
- Usage lists the slot forms → `tests/host/commands/jev.test.ts`

**readiness-checks**

- Executor installed → `tests/host/duplicate-executor.test.ts`
- Executor absent → `tests/host/worker/policy.test.ts`
- Original loaded first → `tests/host/duplicate-executor.test.ts`
- Original loaded last → `tests/host/duplicate-executor.test.ts`
- Both executors installed → `tests/host/duplicate-executor.test.ts`
- Present after children → `tests/host/duplicate-executor.test.ts`

**release-metadata**

- Every feature has an off switch → `tests/release.test.ts` (new or updated in this change)

**settings-resolution**

- Everything defaulted → `tests/store/settings.test.ts` (new or updated in this change)
- Config over default → `tests/store/settings.test.ts`
- Tuning over config → `tests/store/settings.test.ts`
- Forked launch from config → `tests/store/settings.test.ts`
- Ignored tools section → `tests/store/settings.test.ts` (new or updated in this change)

**state-file**

- Valid state read → `tests/store/state-file.test.ts`
- OpenCode model id accepted → `tests/store/state-file.test.ts`
- Model that looks like a flag → `tests/store/state-file.test.ts`
- Every documented feature accepted → `tests/store/state-file.test.ts` (new or updated in this change)
- Legacy review switch accepted and dropped → `tests/store/state-file.test.ts`
- Legacy review switch alone → `tests/store/state-file.test.ts`
- Legacy review switch gone after a write → `tests/store/state-file.test.ts`
- Non-boolean legacy review switch → `tests/store/state-file.test.ts`
- Legacy tools switch accepted and dropped → `tests/store/state-file.test.ts` (new or updated in this change)
- Legacy tools switch gone after a write → `tests/store/state-file.test.ts` (new or updated in this change)
- Non-boolean legacy tools switch → `tests/store/state-file.test.ts` (new or updated in this change)
- Literal default rejected → `tests/store/state-file.test.ts`
- CLI review switch read → `tests/store/state-file.test.ts`
- Non-boolean CLI review switch → `tests/store/state-file.test.ts`
- Unknown feature → `tests/store/state-file.test.ts`

**status-line**

- Ready with the default mode → `tests/host/status/line.test.ts`
- Mode from state → `tests/host/status/line.test.ts ("premium")`
- Directory mode marked → `tests/host/status/line.test.ts`
- Directory mode with a suffix → `tests/host/status/line.test.ts`
- Directory mode in the tally form → `tests/host/status/line.test.ts`
- Base state wins over a directory mode → `tests/host/status/line.test.ts`
- No key → `tests/host/status/line.test.ts ("no key")`
- Config error wins over no key → `tests/host/status/line.test.ts`
- Everything off → `tests/host/status/line.test.ts` (new or updated in this change)
- One feature off is not off → `tests/host/status/line.test.ts`
- No executor is not shown → `tests/host/status/line.test.ts`
- Malformed state uses defaults → `tests/host/status/line.test.ts`
- After a decision → `tests/host/status/line.test.ts`
- After a decision with advice → `tests/host/status/line.test.ts`
- Advice with effort off → `tests/host/status/line.test.ts`
- Advice cleared by the next turn → `tests/host/status/line.test.ts`
- Strategy switched off → `tests/host/status/line.test.ts`
- Discarded effort with advice → `tests/host/status/line.test.ts`
- Strategy switched back on → `tests/host/status/line.test.ts`
- After a miss → `tests/host/status/line.test.ts`
- Discarded keeps the previous suffix → `tests/host/status/line.test.ts`
- Miss on a non-reasoning model → `tests/host/status/line.test.ts`
- Answered without effort keeps the suffix → `tests/host/status/line.test.ts`
- Held turn shows the level in force → `tests/host/status/line.test.ts`
- Held turn with advice → `tests/host/status/line.test.ts`
- Held miss shows the level → `tests/host/status/line.test.ts`
- Kept across /jev → `tests/host/status/line.test.ts`
- Effort switched off → `tests/host/status/line.test.ts`
- Session start clears the suffix → `tests/host/status/line.test.ts`
- Base state wins → `tests/host/status/line.test.ts`
- Tally on the 10th prompt → `tests/host/main.test.ts`
- Ninth prompt shows the level → `tests/host/main.test.ts`
- Eleventh prompt shows the level again → `tests/host/main.test.ts`
- Tally kept across /jev → `tests/host/status/line.test.ts`
- Tally on a miss → `tests/host/main.test.ts`
- Tally on a discarded 10th prompt → `tests/host/main.test.ts`
- Nothing decided never shows the tally → `tests/host/main.test.ts`
- Strategy-only session shows the tally → `tests/host/status/line.test.ts`
- Tally replaces both suffixes → `tests/host/main.test.ts`
- Cancelled 11th prompt keeps the tally → `tests/host/status/line.test.ts`
- Cancelled keeps both suffixes → `tests/host/status/line.test.ts`

**tuning-host**

- Tuned value used by the next request → `tests/host/tuning-host.test.ts`
- Worker routing uses the tuned value → `tests/host/worker-routing.test.ts`

**worker-ledger**

- Routed fields → `tests/host/worker-ledger.test.ts`
- Expert offered recorded → `tests/host/worker-ledger.test.ts`
- Expert switched off recorded → `tests/host/worker-ledger.test.ts`
- Fallback recorded → `tests/host/worker-ledger.test.ts`
- Nothing could run recorded → `tests/host/worker-ledger.test.ts`
- Thinking-only recorded → `tests/host/worker-ledger.test.ts`
- Untouched recorded → `tests/host/worker-ledger.test.ts`
- Tier asked, nothing decided → `tests/host/worker-ledger.test.ts`
- Locked recorded → `tests/host/worker-ledger.test.ts`
- Not locked → `tests/host/worker-ledger.test.ts`
- Slot decision recorded → `tests/host/worker-ledger.test.ts`
- Slot fallback recorded → `tests/host/worker-ledger.test.ts`
- Mode recorded → `tests/host/worker-ledger.test.ts`
- Miss recorded → `tests/host/worker-ledger.test.ts`
- No expert needed field → `tests/host/worker-ledger.test.ts`
- No tool counts → `tests/host/worker-ledger.test.ts` (new or updated in this change)
- No prompt text → `tests/host/worker-ledger.test.ts`

**worker-modes**

- Worker request ignores the mode → `tests/jev/questions.test.ts`
- Same score, different tiers → `tests/policy/worker/tier.test.ts`
- Main request ignores the mode → `tests/jev/questions.test.ts`

**worker-routing**

- Switch off → `tests/host/worker/policy.test.ts`
- No key → `tests/host/worker/policy.test.ts`
- Invalid config → `tests/host/worker/policy.test.ts`
- Executor absent → `tests/host/worker/policy.test.ts`
- Child session → `tests/host/worker/policy.test.ts`
- Other tools ignored → `tests/host/worker/policy.test.ts`
- No tool questions or tool adjustment → `tests/host/worker/policy.test.ts` (new or updated in this change)
- Routing off sends nothing about tools → `tests/host/worker/policy.test.ts` (new or updated in this change)
- Nested launch with the switch off → `tests/host/worker/policy.test.ts`
- Slot taken → `tests/host/worker/policy.test.ts`
