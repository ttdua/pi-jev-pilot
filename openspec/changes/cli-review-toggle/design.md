## Context

`registerReviewTool` (`src/host/review.ts`) registers `jev_review` once at load. Pi activates the tool on registration, so every main session declares it. The only hiding today is `hideReviewInChild`, which splices the name out of `event.systemPromptOptions.selectedTools` in a child's `before_agent_start`. The reviewer default comes from `resolveSettings` (`src/store/settings.ts`): `state.cliReview` replaces the config's `review` as a whole. `/jev` parsing and state changes live in `src/host/commands.ts`.

Pi 1.5.0 behaviour that matters here (`AgentSession._prepareRun`):
- If a `before_agent_start` handler edits `selectedTools`, that list is used for the run, and the active loadout is set to it.
- If no handler edits it, Pi uses the live active tools, which `pi.setActiveTools()` changes. A `setActiveTools()` call made inside the handler is honoured for that run.
- `_baseSystemPromptOptions.selectedTools` is rebuilt only by `setActiveTools`. A splice therefore removes the tool from the live loadout, but leaves the base list as it was.

## Goals / Non-Goals

**Goals:**
- Keep `jev_review` out of main provider requests (declaration, prompt snippet and guideline) while the CLI review is off, and put it back when it is turned on, without a restart.
- Refuse a call made while off, even if the tool is somehow declared.
- Resolve the setting from state, then config, then off. Keep it independent of the key, Jev, the feature switches and config validity.

**Non-Goals:**
- No change to how a review runs (command lines, retry, output, privacy).
- No new registration: the tool stays registered, so `package-loading` holds.
- No migration of existing state. Existing `cliReview` is not taken as opt-in.

## Decisions

### D1. Toggle the live loadout with `pi.setActiveTools`, not by splicing the event

In a main session's `before_agent_start`, before the main decision runs, a small `syncReviewTool` compares the effective setting with `pi.getActiveTools()`:
- If it is off and `jev_review` is active, it calls `pi.setActiveTools(active without jev_review)`.
- If it is on, `jev_review` is inactive and the tool is registered, it calls `pi.setActiveTools([...active, jev_review])`.
- Otherwise it does nothing.

The same sync runs after every `/jev` change that can flip the setting, so the next turn already matches.

- **Why not splice `selectedTools` as for children:** a splice removes the tool from the live loadout but leaves the base list unchanged. When the operator turns the review back on, the handler leaves `selectedTools` equal to the base list, so Pi falls back to the live loadout, which no longer has the tool. The tool would never come back without a restart.
- **Why not `defaultActive: false` at registration:** the tool would still need `setActiveTools` to turn it on. Older Pi builds ignore the option, so it adds no safety. The sync alone covers every case, including resumed sessions whose recorded loadout holds the tool.
- **Calls only on a mismatch:** when nothing changes, Pi's loadout is not rebuilt, so system-prompt sections and cache stay stable.
- **Children are unchanged:** `hideReviewInChild` keeps splicing. A child never toggles, so the re-enable problem does not apply there.

### D2. Execution guard

`execute` reads the effective setting first. While it is off, it returns an error result, `jev_review is off. Turn it on with /jev cli-review on.`, and runs no process. This covers a stale declaration, for example a call already in flight while `/jev cli-review off` runs. The child check stays first. If the snapshot cannot be loaded, the review counts as off, since off is the default. Fail closed is safe here because nothing else depends on the tool.

### D3. Setting shape and resolution

- **State:** optional `cliReviewEnabled: boolean`, present only when set through `/jev`.
- **Config:** optional `review.enabled: boolean`, next to `review.cli`.
- **`Settings.review`** gains `enabled: boolean`, resolved as `state.cliReviewEnabled ?? config.review.enabled ?? false`.
- **Reviewer:** `state.cliReview`, when present, now replaces only the config's `cli` (and adds `model` and `effort`), not `enabled`. An invalid config contributes nothing, so with an invalid config the setting comes from the state or is off.
- **Why a separate field:** brainstorm, Alternative C. It keeps "which reviewer" and "on or off" independent, so `/jev cli-review off` keeps the reviewer choice.
- **What the review tool passes on:** it builds its `ReviewChoice` from `cli`, `model` and `effort` only. `enabled` never reaches `runReview` or the result details.

### D4. Command forms

- `parseCliReview` accepts `cli-review on` and `cli-review off` (exactly two words) as `{ kind: "cli-review-switch", on }`.
- The reviewer form's state update writes both `cliReview` and `cliReviewEnabled: true` in one `updateState`, so the change is all or nothing.
- `reset` already writes an empty state, so it clears the field with no new code.
- `all` touches only `DECISION_FEATURES`, so it leaves the field alone.
- The status line reads `cli review: <on|off> (<cli>[, model m][, effort e] | <cli>, CLI defaults)`.

### D5. Tests that compared bodies through `withoutReview`

With the default off, package-on runs in `jev-base`, `main-effort` and `strategy-advice` declare no `jev_review`. Those tests drop the `withoutReview` filter and compare raw bodies, which is a stricter check. Their assertions change from "has `jev_review`" to "has no `jev_review`". `cli-review.test.ts` turns the review on through a new harness option that writes `review.enabled: true` into the test `config.json`.

## Risks / Trade-offs

- [Breaking change: every user loses the tool after the update] → Documented in `docs/usage-guide.md` and `docs/configuration.md`, and to be named in the PR description. Turning it back on is one command or one config key.
- [`setActiveTools` changes the loadout for the whole session, including an operator's own `--tools` choice] → Only `jev_review` is added or removed, and the rest of the active list is passed back unchanged. A tool excluded with `--exclude-tools` never registers, so the sync cannot add it, because it checks registration first.
- [The sync reads the state at every main `before_agent_start`] → `loadSnapshot` is already read there by the main decision. One more read of three small files is negligible, and errors are swallowed so the turn proceeds.
- [Two Pi processes share `state.json`] → Each process syncs at its next turn, so a toggle in one reaches the other on its next prompt.
- [Another extension edits `selectedTools` in the same `before_agent_start`] → Pi then uses that extension's list, which it built from the options as they were before the sync, so it may still hold `jev_review` for that one turn. The execution guard refuses any call, and the next turn starts from the synced loadout.
- [A Pi build without `setActiveTools`] → The sync is wrapped and fails silently. The execution guard still refuses calls while off.

## Migration Plan

No data migration. On upgrade the setting resolves to off. Rollback is the previous package version. That build rejects unknown keys, so it reports `state.json` as malformed when it holds `cliReviewEnabled`, and `config.json` as invalid when it holds `review.enabled`. A rollback must therefore remove `review.enabled` from `config.json`. A malformed state is moved aside at the next `/jev` change, as today.

## Open Questions

None.
