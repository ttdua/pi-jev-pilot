## MODIFIED Requirements

### Requirement: Status report
`/jev` with no argument SHALL report the status: the status line text, the effective mode, each of the nine feature switches with `on` or `off`, the CLI review on one line `cli review: <on|off> (<cli>, <details>)` where `<details>` is `model <m>` and `effort <e>` when set, joined by `, `, or `CLI defaults` when neither is set, whether the API key is set (naming the environment variable, never its value), whether the executor is present, every config, state and `tuning.json` problem with its field path, the recent worker mix when the executor is present, and, last, the session tally. The recent worker mix SHALL be one line `mix (last <n>, <mode>): fast <a>% / balanced <b>% / deep <c>% / expert <d>% · target <f>/<b>/<d>/≤<cap>` from the cut-point window and the effective mode's target table, followed by `cut points: seed` while the window holds fewer than 100 entries. With an empty window it SHALL read `mix: no routed workers yet` and the seed line. Shares are rounded to whole percents independently, so they may not sum to 100. Without the executor, the report MUST say `no executor` and that worker routing and tool assessment are off. The tally SHALL be a `session:` line followed by lines indented by two spaces: `prompts <P>`, `workers <W>` followed by ` (<model> <n>, ...)` in first-seen order when `W` is not 0 (lines without a model appear as `unrouted <n>`), `worker tokens <T>` and `fallbacks <F>`. It MUST show no price and no tools count. The command MUST NOT call Jev or any other network service.

#### Scenario: Default status
- **WHEN** the config is valid, the key is set, the executor is installed, and `/jev` runs
- **THEN** the report names mode `standard`, lists every feature `on` except `verbose`, contains `cli review: off (codex, CLI defaults)`, says the key in `TYPESAFE_API_KEY` is set, and reports the executor as present

#### Scenario: CLI review default shown
- **WHEN** the state holds `cliReview` `{"cli":"codex","model":"luna","effort":"high"}` and `cliReviewEnabled` `true`, and `/jev` runs
- **THEN** the report contains `cli review: on (codex, model luna, effort high)`

#### Scenario: No executor
- **WHEN** the executor is not installed and `/jev` runs
- **THEN** the report contains `no executor` and says worker routing and tool assessment are off

#### Scenario: Key name, never value
- **WHEN** the key is set to a test value and `/jev` runs
- **THEN** the report names `TYPESAFE_API_KEY` and does not contain the value

#### Scenario: Malformed state reported
- **WHEN** `state.json` is malformed and `/jev` runs
- **THEN** the report shows the default switches and lists the state problems with their paths

#### Scenario: Invalid config reported
- **WHEN** `config.json` has an invalid `classifier.timeoutMs` and `/jev` runs
- **THEN** the report says `config error` and lists the problem at `classifier.timeoutMs`

#### Scenario: Malformed tuning reported
- **WHEN** `tuning.json` is truncated and `/jev` runs
- **THEN** the report lists a `tuning (malformed)` problem at `(file)`

#### Scenario: Empty tally
- **WHEN** a new session starts and `/jev` runs before any prompt
- **THEN** the report ends with `session:`, `  prompts 0`, `  workers 0`, `  worker tokens 0` and `  fallbacks 0`

#### Scenario: Tally after work
- **WHEN** two prompts were decided and one worker routed to `fixture/fast` used 120 tokens, and `/jev` runs
- **THEN** the report ends with `session:`, `  prompts 2`, `  workers 1 (fixture/fast 1)`, `  worker tokens 120` and `  fallbacks 0`

#### Scenario: Mix with a full window
- **WHEN** the mode is `standard`, the window holds 200 entries with decided tiers 38 `fast`, 110 `balanced`, 48 `deep` and 4 `expert`, and `/jev` runs
- **THEN** the report contains `mix (last 200, standard): fast 19% / balanced 55% / deep 24% / expert 2% · target 20/53/25/≤2` and no `cut points: seed` line

#### Scenario: Budget target shown
- **WHEN** the mode is `budget`, the window holds 120 entries and `/jev` runs
- **THEN** the `mix` line ends with `target 50/40/10/≤0`

#### Scenario: Mix while the seed applies
- **WHEN** the window holds 40 entries and `/jev` runs
- **THEN** the report contains a `mix (last 40, …)` line followed by `cut points: seed`

#### Scenario: Empty window
- **WHEN** the window is empty and `/jev` runs
- **THEN** the report contains `mix: no routed workers yet` and `cut points: seed`

#### Scenario: No mix without the executor
- **WHEN** the executor is not installed and `/jev` runs
- **THEN** the report has no `mix` line

### Requirement: All features
`/jev all on|off` SHALL set the seven decision features (`effort`, `subagents`, `skills`, `strategy`, `tools`, `expert`, `review`) in one state update, and MUST leave `status`, `verbose` and the CLI review on/off setting unchanged.

#### Scenario: All off
- **WHEN** the operator runs `/jev all off`
- **THEN** the seven decision features are `false` in `state.json`, `status` and `verbose` keep their values, and, with the key set and the config valid, the status line reads `Jev · off`

#### Scenario: All on
- **WHEN** every decision feature is off and the operator runs `/jev all on`
- **THEN** the seven decision features are `true` in `state.json`

#### Scenario: All leaves the CLI review alone
- **WHEN** the state holds `cliReviewEnabled` `true` and the operator runs `/jev all off`
- **THEN** `state.json` still holds `cliReviewEnabled` `true`

### Requirement: Reset
`/jev reset` SHALL reset the state through the state store, so switches, the mode, the CLI review default and the CLI review on/off setting fall back to config or code defaults, then report the status and refresh the status line.

#### Scenario: Reset after changes
- **WHEN** `skills` is off, the mode is `premium`, and the operator runs `/jev reset`
- **THEN** a new read of `state.json` has no switches, no mode and no CLI review default, and, with the key set and the config valid, the status line reads `Jev · standard`

#### Scenario: Reset turns the CLI review off
- **WHEN** the state holds `cliReviewEnabled` `true`, the config does not set `review.enabled`, and the operator runs `/jev reset`
- **THEN** a new read of `state.json` has no `cliReviewEnabled` and the report contains `cli review: off`

### Requirement: Usage text for other input
Any other argument SHALL produce usage text as a warning and change nothing. The usage text MUST list exactly the forms `/jev`, `/jev <feature> on|off` with the nine feature names, `/jev all on|off`, `/jev mode budget|standard|premium`, `/jev reset`, `/jev cli-review on|off`, `/jev cli-review <codex|opencode> [model|default] [effort|default]`, `/jev <slot> <provider/model> [when <text>]`, `/jev <slot>`, `/jev remove <slot>` and `/jev tune [undo|reset|on|off]`. A first word that is `tune` MUST be handled by the tune forms (see `tune-command`). A first word that is a valid, non-reserved slot name, or `remove`, MUST be handled by the slot forms (see `slot-commands`), not by this requirement. Arguments are split on whitespace and matched case-sensitively; extra words make the input unknown, except the text after `when` in the slot add form.

#### Scenario: Command from a later work group
<!-- Intentional change: WG-18 adds the tune forms, so `/jev tune` is no longer usage. -->
- **WHEN** the operator runs `/jev tune`
- **THEN** the tune report is shown as info, not usage text, and `state.json` is unchanged

#### Scenario: Usage lists the tune form
- **WHEN** usage text is reported
- **THEN** it contains `/jev tune [undo|reset|on|off]`

#### Scenario: Unknown mode
- **WHEN** the operator runs `/jev mode quality`, `/jev mode Premium`, `/jev mode` or `/jev mode premium now`
- **THEN** usage text is reported and `state.json` is unchanged

#### Scenario: Usage lists the mode form
- **WHEN** usage text is reported
- **THEN** it contains `/jev mode budget|standard|premium`

#### Scenario: Unknown feature
<!-- Intentional change: lower-case `colors` is now slot-shaped; see `slot-commands` "Name-shaped typo of a feature". -->
- **WHEN** the operator runs `/jev Colors off`
- **THEN** usage text is reported and `state.json` is unchanged

#### Scenario: Bad value
- **WHEN** the operator runs `/jev skills maybe`
- **THEN** usage text is reported and `state.json` is unchanged

#### Scenario: Extra words
- **WHEN** the operator runs `/jev skills off now`
- **THEN** usage text is reported and `state.json` is unchanged

#### Scenario: Extra words after cli-review
- **WHEN** the operator runs `/jev cli-review codex luna high now`
- **THEN** usage text is reported and `state.json` is unchanged

#### Scenario: Extra words after cli-review off
- **WHEN** the operator runs `/jev cli-review off now`
- **THEN** usage text is reported and `state.json` is unchanged

#### Scenario: Usage lists the cli-review switch
- **WHEN** usage text is reported
- **THEN** it contains `/jev cli-review on|off`

#### Scenario: Whitespace only
- **WHEN** the operator runs `/jev` followed only by spaces
- **THEN** the status is reported, as with no argument

#### Scenario: Usage lists the slot forms
- **WHEN** usage text is reported
- **THEN** it contains `/jev <slot> <provider/model> [when <text>]`, `/jev <slot>` and `/jev remove <slot>`

### Requirement: CLI review default
`/jev cli-review <codex|opencode> [<model>|default] [<effort>|default]` SHALL replace the CLI review default in `state.json` and set `cliReviewEnabled` to `true`, in one update through the state store, leaving other state fields unchanged. A refused or failed change MUST write neither. A model or effort that is omitted or `default` MUST be left unset. After a change the command SHALL report the status and refresh the status line. A value outside the state rules MUST be refused with the store's problem. The command MUST NOT call Jev.

#### Scenario: Bare reviewer
- **WHEN** the operator runs `/jev cli-review opencode`
- **THEN** `state.json` holds `cliReview` `{"cli":"opencode"}` and `cliReviewEnabled` `true`

#### Scenario: Choosing a reviewer turns the review on
- **WHEN** the state holds `cliReviewEnabled` `false` and the operator runs `/jev cli-review codex`
- **THEN** `state.json` holds `cliReviewEnabled` `true` and the report contains `cli review: on (codex, CLI defaults)`

#### Scenario: Default clears the model
- **WHEN** the state holds `cliReview` `{"cli":"codex","model":"luna","effort":"high"}` and the operator runs `/jev cli-review codex default`
- **THEN** `state.json` holds `cliReview` `{"cli":"codex"}`, and no model list is read

#### Scenario: Unknown CLI
- **WHEN** the operator runs `/jev cli-review claude`
- **THEN** usage text is reported as a warning and `state.json` is unchanged

#### Scenario: No reviewer named
- **WHEN** the operator runs `/jev cli-review`
- **THEN** usage text is reported as a warning and `state.json` is unchanged

#### Scenario: Reviewer name is case-sensitive
- **WHEN** the operator runs `/jev cli-review Codex`
- **THEN** usage text is reported as a warning and `state.json` is unchanged

#### Scenario: Value outside the state rules
- **WHEN** the operator runs `/jev cli-review codex -m`
- **THEN** an error names `cliReview.model`, and `state.json` is unchanged

#### Scenario: Refused model leaves the review off
- **WHEN** the state holds `cliReviewEnabled` `false` and the operator runs `/jev cli-review codex nova`, which the Codex list does not hold
- **THEN** an error is reported and `state.json` still holds `cliReviewEnabled` `false`

## ADDED Requirements

### Requirement: CLI review switch
`/jev cli-review on|off` SHALL set `cliReviewEnabled` in `state.json` through the state store, leaving other state fields unchanged, including `cliReview`. It SHALL then report the status, refresh the status line, and bring the session's active tools in line with the new setting (see `cli-review`). The setting MUST still apply after Pi restarts. The command MUST NOT call Jev or read a model list. A refused change SHALL be reported as under "Refused changes".

#### Scenario: Turn the CLI review off
- **WHEN** the state holds `cliReview` `{"cli":"opencode","model":"p/m"}` and `cliReviewEnabled` `true`, and the operator runs `/jev cli-review off`
- **THEN** `state.json` holds `cliReviewEnabled` `false` and the same `cliReview`, and the report contains `cli review: off (opencode, model p/m)`

#### Scenario: Turn the CLI review on
- **WHEN** the state has no `cliReviewEnabled` and the operator runs `/jev cli-review on`
- **THEN** `state.json` holds `cliReviewEnabled` `true`, no `cliReview` is added, no process runs, and the report contains `cli review: on (codex, CLI defaults)`

#### Scenario: Switch survives a restart
- **WHEN** the operator runs `/jev cli-review on`, Pi exits, a new Pi process starts with the same agent directory and `/jev` runs
- **THEN** the report contains `cli review: on`

#### Scenario: Switch is case-sensitive
- **WHEN** the operator runs `/jev cli-review OFF`
- **THEN** usage text is reported as a warning and `state.json` is unchanged

#### Scenario: Refused switch
- **WHEN** `state.json` has mode `0000` and the operator runs `/jev cli-review on`
- **THEN** an error naming `EACCES` is reported and `state.json` is unchanged (skipped when the test runs as root)

