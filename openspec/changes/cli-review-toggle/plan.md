# CLI Review Toggle Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md`.

**Goal:** Let the operator turn `jev_review` on and off with `/jev cli-review on|off` or `review.enabled`, off by default. While off, keep the tool out of main provider requests and refuse calls to it.

**Architecture:**
- **Store.** It gains two optional booleans: `cliReviewEnabled` in the state and `review.enabled` in the config. `resolveSettings` adds `review.enabled` (state, then config, then `false`), and `state.cliReview` no longer overwrites it (design D3).
- **Host.** `src/host/review.ts` gains two pieces: an execution guard (D2), and `syncReviewTool`, which adds or removes only `jev_review` through `pi.setActiveTools`, and only on a mismatch (D1).
- **Wiring.** `setup.ts` runs the sync at each main `before_agent_start`. `runJev` runs it after every successful state change.
- **Command.** `commands.ts` parses the new form, makes the reviewer form turn the review on, and prints the new status line (D4).

**Tech Stack:** TypeScript run by Pi, Bun test, oxlint, oxfmt. No new dependency.

## Global Constraints

- **Surface.** No new registration (tool, command, handler, flag or shortcut). `tests/load.test.ts` stays green.
- **Independence.** The CLI review never calls Jev and does not depend on the key, the nine switches or config validity. An invalid config contributes nothing, so only the state can turn it on then.
- **Children.** `hideReviewInChild` and the child refusal are unchanged and run whatever the setting.
- **Failures.** The sync swallows every error. The guard treats an unreadable setting as off.
- **Network.** Tests use loopback only and need no secrets. Fake `codex` and `opencode` scripts as today.
- **Gate.** `bun run typecheck`, `bun run lint`, `bun run fmt:check` and `bun test` all pass.

## Review Focus

1. **Re-enabling in a running session.** A splice-only fix would pass "Turned off mid-session" and fail "Turned on mid-session". Pinned in Task 9 by a real-Pi test that turns the review off, sends a prompt, turns it on and sends another.
2. **The order of the other tools.** `setActiveTools` must get the active list with only `jev_review` added or removed. Pinned in Task 4 ("Other tools untouched", and "no call when already in sync").
3. **The reviewer form writing half a change.** A refused model must not set `cliReviewEnabled`. Pinned in Task 7 ("Refused model leaves the review off").
4. **`state.cliReview` wiping a config `review.enabled`.** Pinned in Task 3 ("Reviewer from state keeps the config's enabled").
5. **Raw-body equality in the Jev-down host tests.** Once `withoutReview` is gone, any leftover review declaration fails the test. Pinned in Task 10.

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `state.json` | modified | adds optional `cliReviewEnabled: boolean`; `version` stays `1` | public (file format) |
| `config.json` `review` | modified | `{ cli?: "codex" \| "opencode"; enabled?: boolean }` | public (config key) |
| `/jev cli-review on\|off` | new | exactly two words after `/jev`; `on`/`off` case-sensitive | public (CLI) |
| `/jev cli-review <cli> ...` | modified | also writes `cliReviewEnabled: true` in the same update | public (CLI) |
| `/jev` status line | modified | `cli review: <on\|off> (<cli>, <details>)`; `<details>` = `model <m>`, `effort <e>` joined by `, `, or `CLI defaults` | public (output) |
| `State` (`src/store/state-file.ts`) | modified | adds `cliReviewEnabled?: boolean` | no |
| `Config` (`src/store/config.ts`) | modified | `review?: { cli?: "codex" \| "opencode"; enabled?: boolean }` | no |
| `DEFAULTS.review` (`src/store/defaults.ts`) | modified | `{ cli: "codex", enabled: false }` | no |
| `Settings.review` (`src/store/settings.ts`) | modified | `{ cli: "codex" \| "opencode"; enabled: boolean; model?: string; effort?: string }` | no |
| `REVIEW_OFF_MESSAGE` (`src/host/review.ts`) | new | `"jev_review is off. Turn it on with /jev cli-review on."` | no |
| `syncReviewTool` (`src/host/review.ts`) | new | `syncReviewTool(pi: Pick<ExtensionAPI, "getActiveTools" \| "setActiveTools" \| "getAllTools">, enabled: boolean): void`; never throws | no |
| `JevArgs` (`src/host/commands.ts`) | modified | adds `{ kind: "cli-review-switch"; on: boolean }` | no |
| `runJev` deps | modified | adds optional `sync?: (snapshot: Snapshot) => void`, called after a successful state change | no |
| `startHostSession` option (`tests/host/harness.ts`) | modified | `jevConfig.reviewEnabled?: boolean`, written as `review.enabled` | no |

---

## Task 1: State field — implements 1.1

**Files:** `src/store/state-file.ts`, `tests/store/state-file.test.ts`

- [ ] **Step 1:** Add the tests:
  - `CLI review switch read`: `{"version":1,"cliReviewEnabled":true}` reads `{ kind: "ok", state: { cliReviewEnabled: true } }`.
  - `Non-boolean CLI review switch`: `"yes"` reads as malformed with a path list equal to `["cliReviewEnabled"]`.
  - Extend `Reset clears everything` so the seeded file also holds `"cliReviewEnabled":true`. After the reset it still reads `{ kind: "ok", state: {} }`.
- [ ] **Step 2:** Run `bun test tests/store/state-file.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3:** Add `cliReviewEnabled?: boolean` to `State`, and `cliReviewEnabled: boolean()` to `stateValidator`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat(state-file): add cliReviewEnabled`.

## Task 2: Config field — implements 1.2

**Files:** `src/store/config.ts`, `tests/store/config-read.test.ts`

- [ ] **Step 1:** Add the tests:
  - `CLI review enabled accepted`: `review: { cli: "opencode", enabled: true }` is valid and returns it.
  - `Non-boolean review.enabled`: `"on"` gives the paths `["review.enabled"]`.
- [ ] **Step 2:** Run `bun test tests/store/config-read.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Change `Config.review` to the contract shape, and the validator to `review: object({ cli: oneOf([...]), enabled: boolean() })`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat(config): add review.enabled`.

## Task 3: Resolve `review.enabled` — implements 1.3

**Files:** `src/store/defaults.ts`, `src/store/settings.ts`, `tests/store/settings.test.ts`

- [ ] **Step 1:** Add or extend the tests:
  - `Everything defaulted`: expects `review` to equal `{ cli: "codex", enabled: false }`.
  - `CLI review default from state`: expects `{ cli: "opencode", enabled: false }`, with no `model` or `effort` keys.
  - `CLI review on from the config`: `config.review.enabled: true` and an empty state give `enabled: true`.
  - `CLI review off from the state`: the same config with `state.cliReviewEnabled: false` gives `enabled: false`.
  - `Reviewer from state keeps the config's enabled`: `config.review = { cli: "codex", enabled: true }` and `state.cliReview = { cli: "opencode" }` give `{ cli: "opencode", enabled: true }`.
- [ ] **Step 2:** Run `bun test tests/store/settings.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Add `enabled: false` to `DEFAULTS.review`. In `resolveSettings`, set `review.enabled = state.cliReviewEnabled ?? config.review?.enabled ?? DEFAULTS.review.enabled`. The rest of `review` stays as built today from `state.cliReview` or `config.review.cli`.
- [ ] **Step 4:** Run `bun test tests/store`. Expected: PASS.
- [ ] **Step 5:** Run `bun run typecheck` and fix any `Settings["review"]` literals in tests that now need `enabled`. Commit `feat(settings): resolve the CLI review on/off setting`.

**Interfaces:** `Settings.review` (Contracts).

## Task 4: Guard and sync in `review.ts` — implements 2.1, 2.2

**Files:** `src/host/review.ts`, `tests/host/review-tool.test.ts`

- [ ] **Step 1:** Change `setupTool` so its `review` argument carries `enabled`, and set `enabled: true` in the existing tests. Add the tests:
  - `Refused while off`: with `{ cli: "codex", enabled: false }`, the result has `isError: true`, its text equals `REVIEW_OFF_MESSAGE`, and `calls` is `[]`.
  - `Unreadable setting counts as off`: with `"throw"`, the result is the same as for off. This replaces `falls back to codex when load throws`.
  - `child refusal comes first`: a child id with the review off still gets the subagent message.
  - `enabled never reaches the CLI`: the details JSON has no `enabled` key.
- [ ] **Step 2:** Add a `syncReviewTool` test group with a fake `pi` that records `setActiveTools` calls:
  - `Other tools untouched`: the active tools are `read`, `jev_review` and `bash`, and `enabled` is `false`. Expect one call with `["read", "bash"]`.
  - `adds at the end when on`: the active tools are `read` and `bash`, `jev_review` is registered, and `enabled` is `true`. Expect one call with `["read", "bash", "jev_review"]`.
  - `no call when already in sync`: no call in either direction when nothing differs.
  - `not registered, no add`: `getAllTools` lacks `jev_review` and `enabled` is `true`. Expect no call.
  - `never throws`: `getActiveTools` throws. Expect no throw and no call.
- [ ] **Step 3:** Run `bun test tests/host/review-tool.test.ts`. Expected: FAIL.
- [ ] **Step 4:** Implement both pieces:
  - Export `REVIEW_OFF_MESSAGE`.
  - In `execute`, after the child check, load the settings. If loading throws or `enabled` is false, return `failure(REVIEW_OFF_MESSAGE)`.
  - Build `defaults` as `{ cli, model?, effort? }` from `settings.review`, without `enabled`.
  - Implement `syncReviewTool` to the Contracts signature, wrapped in `try`.
  - Update the doc comment on `registerReviewTool`.
- [ ] **Step 5:** Run the same command. Expected: PASS.
- [ ] **Step 6:** Commit `feat(cli-review): refuse and hide jev_review while off`.

**Interfaces:** `REVIEW_OFF_MESSAGE`, `syncReviewTool` (Contracts).

## Task 5: Sync at main `before_agent_start` — implements 2.3

**Files:** `src/host/setup.ts`, `tests/host/setup.test.ts`

- [ ] **Step 1:** Give `fakePi` `getActiveTools` and `setActiveTools` backed by a list that starts as `["read", "jev_review"]`, and `getAllTools` that includes `jev_review`. Add the tests:
  - `main before_agent_start hides jev_review while off`: no config and no state. After the handler, the active tools are `["read"]`.
  - `main before_agent_start shows jev_review when the state turns it on`: `state.json` has `cliReviewEnabled: true` and the active list starts as `["read"]`. After the handler, it is `["read", "jev_review"]`.
  - The existing child tests stay green. Add an assertion that a child never calls `setActiveTools`.
- [ ] **Step 2:** Run `bun test tests/host/setup.test.ts`. Expected: FAIL.
- [ ] **Step 3:** In the main branch of the `before_agent_start` handler, before `main.beforeAgentStart`, call `syncReviewTool(pi, loadSnapshot(pi).settings.review.enabled)` inside its own `try`. Any error leaves the turn to proceed.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat(cli-review): sync jev_review at each main turn`.

## Task 6: `/jev cli-review on|off` — implements 3.1

**Files:** `src/host/commands.ts`, `tests/host/commands.test.ts`

- [ ] **Step 1:** Add the tests:
  - **Parser:**
    - `cli-review on` parses to `{ kind: "cli-review-switch", on: true }`, and `cli-review off` to `on: false`.
    - `cli-review off now`, `cli-review OFF` and `cli-review On` parse to usage.
  - **`Usage lists the cli-review switch`:** `usageText()` contains `/jev cli-review on|off`.
  - **`runJev`:**
    - `Turn the CLI review off`: the seeded state has `cliReview: { cli: "opencode", model: "p/m" }` and `cliReviewEnabled: true`. After the command it has `cliReviewEnabled: false` and the same `cliReview`. The note contains `cli review: off (opencode, model p/m)`, `exec` is never called, and there is one widget.
    - `Turn the CLI review on`: from an empty state, the result is `{ cliReviewEnabled: true }` with no `cliReview`, and the note contains `cli review: on (codex, CLI defaults)`.
    - `Switch survives a restart`: after `cli-review on`, a fresh `load(dir)().settings.review.enabled` is `true`.
    - `Refused switch`: skipped as root. With `state.json` at mode `0000`, one error naming `EACCES`, and the file bytes are unchanged.
- [ ] **Step 2:** Run `bun test tests/host/commands.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the form:
  - Add the `JevArgs` variant.
  - In `parseCliReview`, a two-word input whose second word is `on` or `off` returns it, before the reviewer check.
  - Add a case to `applyChange`: `updateState(dir, (st) => ({ ...st, cliReviewEnabled: parsed.on }))`.
  - Add the usage line `"  /jev cli-review on|off    turn the CLI review on or off"`.
- [ ] **Step 4:** Run the same command. Expected: the new tests PASS. The status-line expectations are fixed in Task 7.
- [ ] **Step 5:** Commit `feat(jev-command): add /jev cli-review on|off`.

## Task 7: Reviewer form turns it on; status line — implements 3.2, 3.3

**Files:** `src/host/commands.ts`, `tests/host/commands.test.ts`

- [ ] **Step 1:** Change and add tests:
  - `bare reviewer stores, reports and redraws`: expects the state `{ cliReview: { cli: "opencode" }, cliReviewEnabled: true }` and the note `cli review: on (opencode, CLI defaults)`.
  - `Choosing a reviewer turns the review on`: seeded `cliReviewEnabled: false`, then `cli-review codex`. Expect `cliReviewEnabled: true` and the note `cli review: on (codex, CLI defaults)`.
  - `Refused model leaves the review off`: seeded `false`, then `cli-review codex nova` with a catalog that lacks it. Expect an error, and the state still holds `false` with no `cliReview`.
  - `formatStatus` `default`: expects `cli review: off (codex, CLI defaults)`.
  - `cli review default and set values`: state `{ cliReview: { cli: "codex", model: "luna", effort: "high" }, cliReviewEnabled: true }` gives `cli review: on (codex, model luna, effort high)`.
  - `All leaves the CLI review alone`: seeded `cliReviewEnabled: true`, then `all off`. Expect it is still `true`.
  - `Reset turns the CLI review off`: seeded `true`, then `reset`. Expect no `cliReviewEnabled` and the note contains `cli review: off`.
- [ ] **Step 2:** Run `bun test tests/host/commands.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement:
  - In `applyChange` `cli-review`, add `cliReviewEnabled: true` next to `cliReview` in the same `updateState`.
  - Change `reviewLine` to `` `cli review: ${r.enabled ? "on" : "off"} (${[r.cli, ...parts].join(", ")}${parts.length > 0 ? "" : ", CLI defaults"})` ``, or an equivalent that gives the contract text.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat(jev-command): choosing a reviewer turns the CLI review on`.

## Task 8: Sync after `/jev` changes — implements 3.4

**Files:** `src/host/commands.ts`, `src/host/setup.ts`, `tests/host/commands.test.ts`, `tests/host/setup.test.ts`

- [ ] **Step 1:** Add the tests:
  - `commands.test.ts` `sync runs after a change, not after status or usage`: pass a `sync` spy. It is called once with a snapshot whose `settings.review.enabled` is `true` after `cli-review on`. It is called after `reset`. It is not called for the status form, usage, or a refused change.
  - `setup.test.ts` `/jev cli-review on activates jev_review`: invoke the registered `jev` handler with `cli-review on` and a main ctx. The fake active tools then hold `jev_review`.
- [ ] **Step 2:** Run `bun test tests/host/commands.test.ts tests/host/setup.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement:
  - Add `sync?: (snapshot: Snapshot) => void` to the `runJev` deps.
  - After a successful `applyChange`, load the snapshot once, call `deps.sync?.(snapshot)` inside its own `try`, then draw and notify from the same snapshot.
  - In `setup.ts`, pass `sync: (s) => syncReviewTool(pi, s.settings.review.enabled)`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat(jev-command): apply the CLI review setting right after /jev`.

**Interfaces:** `runJev` deps `sync` (Contracts).

## Task 9: Real-Pi CLI review tests — implements 4.1, 4.2

**Files:** `tests/host/harness.ts`, `tests/host/cli-review.test.ts`

- [ ] **Step 1:** Add `reviewEnabled?: boolean` to `PrepareOpts.jevConfig`. When it is set, `writeJevConfig` writes `review: { enabled: reviewEnabled }`.
- [ ] **Step 2:** In `cli-review.test.ts`, make `setup` pass `jevConfig: { ...DEFAULT, reviewEnabled: true }` by default, with an override parameter. Every existing flow keeps passing with the review on, and `Offered in the main session` and `Absent in a child session` keep their assertions.
- [ ] **Step 3:** Add the tests, each through the real CLI over RPC:
  - `Off by default`: `reviewEnabled` unset. The first request's `toolNames` lacks `jev_review`, and `JSON.stringify(body)` does not contain `jev_review`.
  - `On from the config`: already covered by `Offered in the main session`. Leave a comment naming the scenario.
  - `State off over config on`: config on, and a pre-written `state.json` with `{"version":1,"cliReviewEnabled":false}`. The first request lacks `jev_review`.
  - `Turned on mid-session`: config unset. Prompt `one`, then `command(s, "/jev cli-review on")`, then prompt `two`. The first request of turn two includes `jev_review`.
  - `Turned off mid-session`: config on. Prompt, `/jev cli-review off`, prompt. The first request of turn two lacks `jev_review`.
  - `Refused while off` (end to end): a script that calls `jev_review` with the review off. The tool result contains `jev_review is off`, and the fake codex log is empty.
  - `Invalid config, on from state`: `config.json` holds an unknown key and the state has `cliReviewEnabled: true`. The review call runs `codex`.
- [ ] **Step 4:** Run `bun test tests/host/cli-review.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `test(cli-review): cover on/off through the real CLI`.

## Task 10: Jev-down comparisons without the review exception — implements 4.3

**Files:** `tests/host/jev-base.test.ts`, `tests/host/main-effort.test.ts`, `tests/host/strategy-advice.test.ts`, `tests/host/bodies.ts`

- [ ] **Step 1:** In each file:
  - Replace `withoutReview(r.body)` with `r.body`.
  - Replace "every request includes `jev_review`" with "no request includes `jev_review`".
  - Rename the `jev-base` test to `print mode shows no status line and leaves provider requests unchanged`.
- [ ] **Step 2:** Delete `withoutReview` from `tests/host/bodies.ts` once `grep -rn withoutReview tests` finds no use.
- [ ] **Step 3:** Run `bun test tests/host/jev-base.test.ts tests/host/main-effort.test.ts tests/host/strategy-advice.test.ts`. Expected: PASS.
- [ ] **Step 4:** Commit `test(host): compare raw bodies now that jev_review is off by default`.

## Task 11: Docs — implements 5.1, 5.2

**Files:** `docs/usage-guide.md`, `docs/configuration.md`, `docs/privacy.md`, `docs/testing.md`, `docs/architecture.md`

- [ ] **Step 1:** `docs/usage-guide.md`, in the CLI review section:
  - Open with "The CLI review is off by default. Turn it on with `/jev cli-review on`, by choosing a reviewer, or with `review.enabled` in `config.json`."
  - Add `/jev cli-review on` and `/jev cli-review off` to the examples, and the form to the command table.
  - Change the status example to `cli review: on (codex, model luna, effort high)`.
  - State that `/jev reset` turns it off and that `/jev all` leaves it alone.
  - Replace "does not depend on the switches" with "does not depend on the Jev key or the feature switches, only on its own on/off setting".
  - Add a short **Upgrading** note: from this version, `jev_review` is off until you turn it on.
- [ ] **Step 2:** `docs/configuration.md`:
  - Add the `enabled` row (`false`, `true` or `false`; `/jev cli-review on|off` stores an override in `state.json`) to the `review` table.
  - Describe `cliReviewEnabled` in the state paragraph.
  - Update the `state.json` row in the files table ("Switches, mode, CLI review default and on/off").
  - Add the rollback note from design "Migration Plan".
- [ ] **Step 3:**
  - `docs/privacy.md`: "They run only when you ask, and only after you turn the CLI review on."
  - `docs/testing.md`: the Jev-down bullet now reads "identical provider requests to a run without the package, apart from a status line". The review bullet becomes "offered in the main session only while on, and absent in a child's provider request".
  - `docs/architecture.md`: the `review.ts` line becomes "jev_review tool, runs the CLI, hides the tool in children and while off". The `state-file.ts` line adds "CLI review on/off".
- [ ] **Step 4:** Run `bun run fmt:check`. Expected: PASS.
- [ ] **Step 5:** Commit `docs: document the CLI review on/off setting`.

## Task 12: Full gate — implements 6.1

- [ ] **Step 1:** Run `bun run typecheck && bun run lint && bun run fmt:check && bun test`. Expected: every command exits 0.

---

## Scenario → test

**cli-review**
- Off by default → `cli-review.test.ts` "Off by default"
- On from the config → `cli-review.test.ts` "offered in the main session" (config on)
- State off over config on → `cli-review.test.ts` "State off over config on"
- Turned on mid-session → `cli-review.test.ts` "Turned on mid-session"
- Turned off mid-session → `cli-review.test.ts` "Turned off mid-session"
- Other tools untouched → `review-tool.test.ts` "Other tools untouched"
- Refused while off → `review-tool.test.ts` "Refused while off", and `cli-review.test.ts` "Refused while off"
- Unreadable setting counts as off → `review-tool.test.ts` "Unreadable setting counts as off"
- No key, review switch off → `review-tool.test.ts` "independent of key and switches" (enabled: true)
- Invalid config, on from state → `cli-review.test.ts` "Invalid config, on from state"
- Offered in the main session → `cli-review.test.ts` "offered in the main session"
- Absent in a child session → `cli-review.test.ts` "absent in a child session"
- Refused in a child session → `review-tool.test.ts` "refused in a child"

**jev-command**
- Default status → `commands.test.ts` formatStatus "default"
- CLI review default shown → `commands.test.ts` "cli review default and set values"
- No executor, Key name never value, Malformed state reported, Invalid config reported, Malformed tuning reported, Empty tally, Tally after work, Mix with a full window, Budget target shown, Mix while the seed applies, Empty window, No mix without the executor → existing `commands.test.ts` tests, unchanged
- All off, All on → `commands.test.ts` "all off then all on"
- All leaves the CLI review alone → `commands.test.ts` "All leaves the CLI review alone"
- Reset after changes → `commands.test.ts` "reset clears the state"
- Reset turns the CLI review off → `commands.test.ts` "Reset turns the CLI review off"
- Command from a later work group, Usage lists the tune form, Unknown mode, Usage lists the mode form, Unknown feature, Bad value, Extra words, Extra words after cli-review, Whitespace only, Usage lists the slot forms → existing `commands.test.ts` tests, unchanged
- Extra words after cli-review off → `commands.test.ts` parser "cli-review off now is usage"
- Usage lists the cli-review switch → `commands.test.ts` "Usage lists the cli-review switch"
- Bare reviewer → `commands.test.ts` "bare reviewer stores, reports and redraws"
- Choosing a reviewer turns the review on → `commands.test.ts` "Choosing a reviewer turns the review on"
- Default clears the model, Unknown CLI, No reviewer named, Reviewer name is case-sensitive, Value outside the state rules → existing `commands.test.ts` tests, unchanged
- Refused model leaves the review off → `commands.test.ts` "Refused model leaves the review off"
- Turn the CLI review off → `commands.test.ts` "Turn the CLI review off"
- Turn the CLI review on → `commands.test.ts` "Turn the CLI review on"
- Switch survives a restart → `commands.test.ts` "Switch survives a restart"
- Switch is case-sensitive → `commands.test.ts` parser "cli-review OFF is usage"
- Refused switch → `commands.test.ts` "Refused switch"

**state-file**
- Valid state read, OpenCode model id accepted, Model that looks like a flag, Every documented feature accepted, Literal default rejected, Unknown feature → existing `state-file.test.ts` tests
- CLI review switch read → `state-file.test.ts` "CLI review switch read"
- Non-boolean CLI review switch → `state-file.test.ts` "Non-boolean CLI review switch"
- Reset clears everything → `state-file.test.ts` "Reset clears everything" (extended)

**config-file**
- Duplicate hold provider, Hold provider bounds, Non-boolean parentRequest, Enum values, Forked launch setting accepted, Forked launch setting rejected → existing `config-read.test.ts` tests
- CLI review enabled accepted → `config-read.test.ts` "CLI review enabled accepted"
- Non-boolean review.enabled → `config-read.test.ts` "Non-boolean review.enabled"

**settings-resolution**
- Everything defaulted → `settings.test.ts` "Everything defaulted" (extended)
- Config over default, Tuning over config, Forked launch from config, Switch off, Mode from state, Config review without state → existing `settings.test.ts` tests
- CLI review default from state → `settings.test.ts` "CLI review default from state" (extended)
- CLI review on from the config → `settings.test.ts` "CLI review on from the config"
- CLI review off from the state → `settings.test.ts` "CLI review off from the state"
- Reviewer from state keeps the config's enabled → `settings.test.ts` "Reviewer from state keeps the config's enabled"
