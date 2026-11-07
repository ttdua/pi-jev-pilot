## Why

`jev_review` is always offered to the main session's model, and the `cli-review` spec forbids turning it off. Operators who do not use Codex or OpenCode, or who do not want the model to see a review tool, have no way to remove it. This change gives the CLI review its own on/off setting, off by default.

## What Changes

**CLI review availability**
- From: `jev_review` stays offered and runs in every main session, whatever the switches say.
- To: `jev_review` is offered and runs only while the CLI review is on. The setting resolves from `state.json`, then `config.json`, then the code default, which is off. It stays independent of the API key, Jev and the nine feature switches.
- Reason: the operator decides whether the model sees the tool.
- Impact: **breaking**. After the update every user loses `jev_review` until they run `/jev cli-review on` or `/jev cli-review <cli>`, or set `review.enabled` to `true`. Existing `cliReview` state is not taken as opt-in.

**`/jev cli-review` command**
- From: `/jev cli-review <codex|opencode> [model|default] [effort|default]` only sets the default reviewer.
- To: adds `/jev cli-review on|off`. Setting a reviewer also turns the CLI review on, in the same state update.
- Reason: one command word for everything about the CLI review. Choosing a reviewer means the operator wants to use it.
- Impact: non-breaking for existing forms. The usage text gains one line.

**Status report and reset**
- From: `/jev` shows `cli review: <cli> (...)`. `/jev reset` clears the reviewer default.
- To: `/jev` shows `cli review: <on|off> (<cli>, ...)`, for example `cli review: off (codex, CLI defaults)`. `/jev reset` also clears the on/off setting, so the CLI review falls back to the config or off.
- Impact: the status text changes format.

**State and config**
- `state.json` gains the optional boolean `cliReviewEnabled`. `config.json` gains the optional boolean `review.enabled`.
- `/jev all on|off` does not touch the CLI review.

**The `review` feature switch**
- From: nine feature switches, including `review`. `/jev all` sets seven decision features, and `Jev · off` needs all seven off. No code reads `switches.review`.
- To: eight feature switches with no `review`. `/jev all` sets six decision features, `Jev · off` needs all six off, and `/jev review on|off` reports usage. A legacy `switches.review` in `state.json` is accepted on read, ignored, and dropped at the next write.
- Reason: the switch does nothing, and its name suggests it controls the CLI review, which it never did.
- Impact: **breaking** for anyone who scripts `/jev review on|off`, though the command had no effect. Existing state files keep working.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-review`: the tool is offered and runs only while the CLI review is on. The independence requirement no longer says "whatever the switches say" without qualification.
- `jev-command`: adds the `/jev cli-review on|off` form. Setting a reviewer turns the CLI review on. The status report shows on/off. Reset clears it. The usage text lists the new form. `/jev all` leaves it alone.
- `state-file`: adds `cliReviewEnabled`, and reset clears it.
- `config-file`: adds the `review.enabled` field rule.
- `settings-resolution`: resolves the effective on/off setting (default off). The state's reviewer default replaces only the config's `review.cli`, no longer the whole `review` section.
- `status-line`: `Jev · off` counts six decision features. The refresh scenario no longer uses `/jev review off`.
- `jev-command` (also): the feature list loses `review`, and `/jev all` sets six features.
- `state-file` (also): the feature list loses `review`, and a legacy `switches.review` is accepted and dropped.

## Impact

- Code: `src/store/state-file.ts`, `src/store/config.ts`, `src/store/defaults.ts`, `src/store/settings.ts`, `src/host/review.ts`, `src/host/setup.ts` and `src/host/commands.ts`. Removing the switch touches `FEATURES`, `DECISION_FEATURES` and `DEFAULTS.switches` in `src/store/defaults.ts`, and the state validator in `src/store/state-file.ts`.
- Tests:
  - Unit tests for the store, commands and the review tool.
  - Host tests that assert `jev_review` is present in main requests: `cli-review`, `jev-base`, `main-effort` and `strategy-advice`. With the default off, the package-on runs now match a run without the package with no filtering.
  - The host harness gains a way to turn the CLI review on.
- Docs:
  - `docs/usage-guide.md` and `docs/configuration.md` (new form, new keys, the breaking change).
  - `docs/privacy.md` (off by default).
  - `docs/testing.md` (the Jev-down comparison no longer needs to ignore `jev_review`).
  - `docs/architecture.md` (what `review.ts` and `state-file.ts` hold).
  - `docs/usage-guide.md` and `docs/workflow.md` again, for the removed `review` switch (feature list, "six decision features", `Jev · off`).
- No new dependency, no network or Jev call, and no change to the registered tools, commands or handlers (`package-loading` holds).
