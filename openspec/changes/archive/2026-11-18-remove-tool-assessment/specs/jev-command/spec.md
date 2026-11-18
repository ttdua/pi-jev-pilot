## ADDED Requirements

### Requirement: Feature switch commands
`/jev <feature> on|off`, where `<feature>` is one of `effort`, `subagents`, `skills`, `strategy`, `expert`, `status`, `verbose`, SHALL set that switch in `state.json` through the state store, leaving other fields unchanged, then report the new status and refresh the status line. A switch set this way MUST still apply after Pi restarts. `review` and `tools` are not features: `/jev tools on|off` is unknown input (see "Usage text for other input") and changes nothing.

#### Scenario: Turn a feature off
- **WHEN** the operator runs `/jev skills off`
- **THEN** `state.json` holds `switches.skills` `false`, other fields are unchanged, and the report shows `skills` `off`

#### Scenario: Switch survives a restart
- **WHEN** the operator runs `/jev skills off`, Pi exits, a new Pi process starts with the same agent directory and `/jev` runs
- **THEN** the report shows `skills` `off`

#### Scenario: Turn a feature back on
- **WHEN** `skills` is off and the operator runs `/jev skills on`
- **THEN** `state.json` holds `switches.skills` `true`

#### Scenario: Status lists seven features
- **WHEN** `/jev` runs
- **THEN** the `features:` block lists exactly `effort`, `subagents`, `skills`, `strategy`, `expert`, `status`, `verbose`, in that order, and no `review` or `tools`

#### Scenario: Tools is not a feature
- **WHEN** the operator runs `/jev tools off`
- **THEN** the usage text is shown as a warning and `state.json` is unchanged

## MODIFIED Requirements

### Requirement: Status report
`/jev` with no argument SHALL report the status: the status line text, the effective mode (as `mode: <m>`, or `mode: <m> (this directory; global <g>)` while a directory mode is set, with `<g>` the global mode), each of the seven feature switches with `on` or `off`, the CLI review on one line `cli review: <on|off> (<cli>, <details>)` where `<details>` is `model <m>` and `effort <e>` when set, joined by `, `, or `CLI defaults` when neither is set, whether the API key is set (naming the environment variable, never its value), whether the executor is present, the duplicate executor problem when one is detected (see `readiness-checks`), every config, state, directory mode and `tuning.json` problem with its field path, one line `deprecated: config tools is ignored` under the problems when the config read reports `tools` as deprecated (this report is the only place the deprecation is shown; it MUST NOT be notified on its own), the recent worker mix when the executor is present, and, last, the session tally. The recent worker mix SHALL be one line `mix (last <n>, <mode>): fast <a>% / balanced <b>% / deep <c>% / expert <d>% · target <f>/<b>/<d>/≤<cap>` from the cut-point window and the effective mode's target table, followed by `cut points: seed` while the window holds fewer than 100 entries. With an empty window it SHALL read `mix: no routed workers yet` and the seed line. Shares are rounded to whole percents independently, so they may not sum to 100. Without the executor, the report MUST say `no executor` and that worker routing is off. With a duplicate executor, the report MUST say `duplicate executor`, name the path of the other `subagent` tool's extension, say to uninstall `@gotgenes/pi-subagents`, and say that worker routing is off. The tally SHALL be a `session:` line followed by lines indented by two spaces: `prompts <P>`, `workers <W>` followed by ` (<model> <n>, ...)` in first-seen order when `W` is not 0 (lines without a model appear as `unrouted <n>`), `worker tokens <T>` and `fallbacks <F>`. It MUST show no price and no tools count. The command MUST NOT call Jev or any other network service.

#### Scenario: Default status
- **WHEN** the config is valid, the key is set, the executor is installed, and `/jev` runs
- **THEN** the report names mode `standard`, lists every feature `on` except `verbose`, contains `cli review: off (codex, CLI defaults)`, says the key in `TYPESAFE_API_KEY` is set, and reports the executor as present

#### Scenario: Directory mode in the report
- **WHEN** `state.json` sets the mode to `standard`, the directory mode is `premium`, and `/jev` runs
- **THEN** the report contains `mode: premium (this directory; global standard)`, and its `mix` line, when shown, names `premium` and the `premium` target

#### Scenario: Malformed directory mode reported
- **WHEN** `<cwd>/.pi/jev-mode.json` is not valid JSON and `/jev` runs
- **THEN** the report contains `mode: standard` and lists a `local mode (malformed)` problem at `(file)`

#### Scenario: CLI review default shown
- **WHEN** the state holds `cliReview` `{"cli":"codex","model":"luna","effort":"high"}` and `cliReviewEnabled` `true`, and `/jev` runs
- **THEN** the report contains `cli review: on (codex, model luna, effort high)`

#### Scenario: No executor
- **WHEN** the executor is not installed and `/jev` runs
- **THEN** the report contains `no executor` and says worker routing is off

#### Scenario: Key name, never value
- **WHEN** the key is set to a test value and `/jev` runs
- **THEN** the report names `TYPESAFE_API_KEY` and does not contain the value

#### Scenario: Malformed state reported
- **WHEN** `state.json` is malformed and `/jev` runs
- **THEN** the report shows the default switches and lists the state problems with their paths

#### Scenario: Invalid config reported
- **WHEN** `config.json` has an invalid `classifier.timeoutMs` and `/jev` runs
- **THEN** the report says `config error` and lists the problem at `classifier.timeoutMs`

#### Scenario: Deprecated tools section reported
- **WHEN** `config.json` is otherwise valid, holds a `tools` section and `/jev` runs
- **THEN** the report contains `deprecated: config tools is ignored`, does not say `config error`, and the status line text is unchanged by the key

#### Scenario: Deprecation never notified on its own
- **WHEN** `config.json` holds a `tools` section and a session starts, prompts run and workers launch, without `/jev`
- **THEN** no notification mentions the deprecated `tools` section

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


#### Scenario: Duplicate executor reported
- **WHEN** jev-pilot's extension runs with `@gotgenes/pi-subagents` and without the vendored executor, and `/jev` runs
- **THEN** the report contains `duplicate executor`, the other extension's path, the advice to uninstall `@gotgenes/pi-subagents`, and says worker routing is off

### Requirement: All features
`/jev all on|off` SHALL set the five decision features (`effort`, `subagents`, `skills`, `strategy`, `expert`) in one state update, and MUST leave `status`, `verbose` and the CLI review on/off setting unchanged.

#### Scenario: All off
- **WHEN** the operator runs `/jev all off`
- **THEN** the five decision features are `false` in `state.json`, `status` and `verbose` keep their values, and, with the key set and the config valid, the status line reads `Jev · off`

#### Scenario: All on
- **WHEN** every decision feature is off and the operator runs `/jev all on`
- **THEN** the five decision features are `true` in `state.json`

#### Scenario: All leaves the CLI review alone
- **WHEN** the state holds `cliReviewEnabled` `true` and the operator runs `/jev all off`
- **THEN** `state.json` still holds `cliReviewEnabled` `true`

### Requirement: Usage text for other input
Any other argument SHALL produce usage text as a warning and change nothing. The usage text MUST list exactly the forms `/jev`, `/jev <feature> on|off` with the seven feature names, `/jev all on|off`, `/jev mode budget|standard|premium [global]`, `/jev mode clear`, `/jev reset`, `/jev cli-review on|off`, `/jev cli-review <codex|opencode> [model|default] [effort|default]`, `/jev <slot> <provider/model> [when <text>]`, `/jev <slot>`, `/jev remove <slot>` and `/jev tune [undo|reset|on|off]`. A first word that is `tune` MUST be handled by the tune forms (see `tune-command`). A first word that is a valid, non-reserved slot name, or `remove`, MUST be handled by the slot forms (see `slot-commands`), not by this requirement. Arguments are split on whitespace and matched case-sensitively; extra words make the input unknown, except the text after `when` in the slot add form.

#### Scenario: Command from a later work group
<!-- Intentional change: WG-18 adds the tune forms, so `/jev tune` is no longer usage. -->
- **WHEN** the operator runs `/jev tune`
- **THEN** the tune report is shown as info, not usage text, and `state.json` is unchanged

#### Scenario: Usage lists the tune form
- **WHEN** usage text is reported
- **THEN** it contains `/jev tune [undo|reset|on|off]`

#### Scenario: Unknown mode
- **WHEN** the operator runs `/jev mode quality`, `/jev mode Premium`, `/jev mode`, `/jev mode premium now`, `/jev mode premium Global`, `/jev mode global`, `/jev mode clear now`, `/jev mode Clear` or `/jev mode premium session`
- **THEN** usage text is reported, and neither `state.json` nor `<cwd>/.pi/jev-mode.json` is created or changed

#### Scenario: Usage lists the mode form
- **WHEN** usage text is reported
- **THEN** it contains `/jev mode budget|standard|premium [global]` and `/jev mode clear`

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

#### Scenario: Removed review switch
- **WHEN** the operator runs `/jev review off` or `/jev review on`
- **THEN** usage text is reported as a warning and `state.json` is unchanged

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

## REMOVED Requirements

### Requirement: Feature switches

**Reason**: Restated under a new name because the `tools` feature is removed and the eight-feature scenario no longer applies; OpenSpec cannot drop a scenario through MODIFIED.

**Migration**: Replaced by "Feature switch commands" in this capability.
