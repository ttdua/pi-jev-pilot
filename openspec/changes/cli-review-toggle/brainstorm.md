## Design Summary

Let the operator turn the CLI review (`jev_review`) on and off, and make it off by default.

Today `jev_review` is always offered in the main session. The living spec `cli-review`, requirement "Independent of Jev and switches", says it "SHALL stay offered and run whether or not the API key is set, whatever the feature switches (including `review`) say". **This change alters that requirement.** The tool stays independent of the API key, Jev and the feature switches (nine at the time), but it now has its own on/off setting, and while that setting is off the model is not offered the tool.

What the operator sees:

- `/jev cli-review on` and `/jev cli-review off` turn the CLI review on or off. The setting persists in `state.json` across sessions, like the other `/jev` settings.
- `/jev cli-review <codex|opencode> [model|default] [effort|default]` still sets the default reviewer, and it also turns the CLI review on. Choosing a reviewer is a clear signal that the operator wants to use it.
- `config.json` gains `review.enabled` (boolean), so an operator can turn it on for every session without running a command. The state wins over the config, and the config wins over the code default, which is off.
- While it is off, the model is not offered `jev_review`. If the tool is called anyway, it returns an error and runs no process.
- `/jev` reports the setting on its `cli review:` line, for example `cli review: off (codex, CLI defaults)`.
- `/jev reset` clears the setting along with the rest of the state, so the CLI review goes back to off, or to `review.enabled` when the config sets it.

Who it is for: operators who do not use Codex or OpenCode, or who do not want the model to see a review tool it should not reach for unprompted.

This is a breaking change for current users. After the update, `jev_review` disappears until the operator runs `/jev cli-review on` or `/jev cli-review <cli>`, or sets `review.enabled` to `true`. Existing `cliReview` state is not treated as opt-in.

Affected living specs: `cli-review` (independence and the main-session offer), `jev-command` (status report, usage text, reset, CLI review default), `state-file` (state fields), `config-file` (field rules for `review`), `settings-resolution` (defaults and state overrides).

### Added after the first implementation: remove the `review` feature switch

The operator asked whether `/jev review off` already turns `jev_review` off. It does not. The living `cli-review` spec says the tool runs "whatever the feature switches (including `review`) say". No code reads `switches.review` either: the switch only counts toward `Jev · off` on the status line. Since ADR 0004, review routing goes through an ordinary crew slot, so the switch does nothing. Two things called "review" that look alike but act differently mislead the operator, so the operator decided to remove the switch in this change.

What the operator sees:

- The features become `effort`, `subagents`, `skills`, `strategy`, `tools`, `expert`, `status` and `verbose`. `/jev all on|off` sets the six decision features, and `Jev · off` means all six are off.
- `/jev review on|off` is no longer a form and reports usage, like any unknown input. `review` stays a reserved slot name, so `/jev review ...` never becomes a slot form.
- A `state.json` written by an older version may still hold `switches.review`. It is accepted on read, its value is ignored, and it is gone after the next state write. It is not treated as a malformed state, which would move the whole file aside and lose the mode, the other switches and the CLI review setting. (Operator's choice.)

Affected living specs, in addition: `jev-command` (feature switches, all features, usage text), `state-file` (legacy key), `status-line` (`Jev · off` and its refresh scenario), `cli-review` (the independence requirement no longer names a `review` switch).

## Alternatives Considered

### Alternative A: A tenth feature switch `cli-review`
- **Approach**: Add `cli-review` to the feature switches, set with `/jev cli-review on|off` or `/jev <feature> on|off`.
- **Pros**: It reuses the existing switch machinery and the `features:` block of the status report.
- **Cons**: The switches are tied to Jev decisions, and `/jev all on|off` covers decision features. The CLI review is not a Jev decision, so it would have to be excluded from `all`, which is a special case either way. `cli-review` is also already the command word for the reviewer default, so it would mean two things.
- **Why not chosen**: It mixes a Jev-independent tool into the Jev feature set and muddies `/jev all`.

### Alternative B: An `enabled` flag inside `cliReview`
- **Approach**: Store `cliReview.enabled` next to `cli`, `model` and `effort`.
- **Pros**: Everything about the CLI review sits in one state object.
- **Cons**: `cliReview` requires `cli` and replaces the config's `review` as a whole, so `/jev cli-review off` with no reviewer chosen would have to invent a `cli`. Turning it off would also pin the config's reviewer into the state.
- **Why not chosen**: It couples the on/off setting to the reviewer choice, which the operator changes independently.

### Alternative C: A separate on/off field in the state, plus `review.enabled` in the config (chosen)
- **Approach**: The state holds an optional `cliReviewEnabled` boolean and the config an optional `review.enabled` boolean. Each resolves on its own, independently of the reviewer default.
- **Pros**: Turning it off keeps the reviewer choice intact, the config can set a machine-wide default, and the feature switches and `/jev all` are untouched.
- **Cons**: It adds one more state field and one more config field.

## Agreed Approach

Alternative C. It keeps the CLI review apart from Jev and the feature switches, which the current spec already insists on. It also lets "off" and "which reviewer" change independently, and it follows the existing state > config > default precedence.

## Key Decisions

- The setting has its own state field and its own config field, not a feature switch and not part of `cliReview`. (Operator's choice.)
- The code default is off.
- `/jev cli-review on|off` is the command. `on` and `off` are not reviewer names, so the command is unambiguous.
- Setting a reviewer with `/jev cli-review <codex|opencode> ...` also turns the CLI review on. (Operator's choice.)
- Off applies to every user after the update, including those who already have `cliReview` in the state. The breaking change is documented. (Operator's choice.)
- `/jev reset` brings the CLI review back to off, or to the config's `review.enabled`. (Operator's choice.)
- `/jev all on|off` does not touch the CLI review.
- The CLI review stays independent of the API key, Jev and the feature switches. Only its own setting gates it.
- The `review` feature switch is removed in this change rather than in a follow-up. It does nothing today. (Operator's choice.)
- A legacy `switches.review` in `state.json` is read without error, ignored, and dropped at the next write. A non-boolean value there is still a malformed state, as before. (Operator's choice.)
- `review` stays a reserved slot name.
- In a child session the tool stays hidden and refused whatever the setting says.
- The repository has no changelog file, so the breaking change is recorded in `docs/usage-guide.md`, `docs/configuration.md` and the commit and PR description.

## Open Questions

None.
