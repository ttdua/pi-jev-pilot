## MODIFIED Requirements

### Requirement: Status report
`/jev` with no argument SHALL report the status: the status line text, the effective mode (as `mode: <m>`, or `mode: <m> (this directory; global <g>)` while a directory mode is set, with `<g>` the global mode), each of the seven feature switches with `on` or `off`, the CLI review on one line `cli review: <on|off> (<cli>, <details>)` where `<details>` is `model <m>` and `effort <e>` when set, joined by `, `, or `CLI defaults` when neither is set, whether the API key is set (naming the environment variable, never its value), whether the executor is present, the duplicate executor problem when one is detected (see `readiness-checks`), every config, state, directory mode and `tuning.json` problem with its field path, one line `deprecated: config tools is ignored` under the problems when the config read reports `tools` as deprecated (this report is the only place the deprecation is shown; it MUST NOT be notified on its own), the recent worker mix when the executor is present, and, last, the session tally. The recent worker mix SHALL be one line `mix (last <n>, <mode>): basic <a>% / broad <b>% / deep <c>% / frontier <d>% · target <f>/<b>/<d>/≤<cap>` from the cut-point window and the effective mode's target table, followed by `cut points: seed` while the window holds fewer than 100 entries. With an empty window it SHALL read `mix: no routed workers yet` and the seed line. Shares are rounded to whole percents independently, so they may not sum to 100. Without the executor, the report MUST say `no executor` and that worker routing is off. With a duplicate executor, the report MUST say `duplicate executor`, name the path of the other `subagent` tool's extension, say to uninstall `@gotgenes/pi-subagents`, and say that worker routing is off. The tally SHALL be a `session:` line followed by lines indented by two spaces: `prompts <P>`, `workers <W>` followed by ` (<model> <n>, ...)` in first-seen order when `W` is not 0 (lines without a model appear as `unrouted <n>`), `worker tokens <T>` and `fallbacks <F>`. It MUST show no price and no tools count. The command MUST NOT call Jev or any other network service.

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
- **WHEN** the mode is `standard`, the window holds 200 entries with decided tiers 38 `basic`, 110 `broad`, 48 `deep` and 4 `frontier`, and `/jev` runs
- **THEN** the report contains `mix (last 200, standard): basic 19% / broad 55% / deep 24% / frontier 2% · target 20/53/26/≤1` and no `cut points: seed` line

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
`/jev all on|off` SHALL set the five decision features (`effort`, `subagents`, `skills`, `strategy`, `frontier`) in one state update, and MUST leave `status`, `verbose` and the CLI review on/off setting unchanged.

#### Scenario: All off
- **WHEN** the operator runs `/jev all off`
- **THEN** the five decision features are `false` in `state.json`, `status` and `verbose` keep their values, and, with the key set and the config valid, the status line reads `Jev · off`

#### Scenario: All on
- **WHEN** every decision feature is off and the operator runs `/jev all on`
- **THEN** the five decision features are `true` in `state.json`

#### Scenario: All leaves the CLI review alone
- **WHEN** the state holds `cliReviewEnabled` `true` and the operator runs `/jev all off`
- **THEN** `state.json` still holds `cliReviewEnabled` `true`

### Requirement: Feature switch commands
`/jev <feature> on|off`, where `<feature>` is one of `effort`, `subagents`, `skills`, `strategy`, `frontier`, `status`, `verbose`, SHALL set that switch in `state.json` through the state store, leaving other fields unchanged, then report the new status and refresh the status line. A switch set this way MUST still apply after Pi restarts. `review` and `tools` are not features: `/jev tools on|off` is unknown input (see "Usage text for other input") and changes nothing. For one minor release, `/jev expert on|off` SHALL act as `/jev frontier on|off` and the report SHALL add the line `notice: /jev expert is deprecated; use /jev frontier`; `expert` is not listed as a feature.

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
- **THEN** the `features:` block lists exactly `effort`, `subagents`, `skills`, `strategy`, `frontier`, `status`, `verbose`, in that order, and no `review` or `tools`

#### Scenario: Deprecated expert command
- **WHEN** the operator runs `/jev expert off`
- **THEN** `state.json` holds `switches.frontier` `false` and no `switches.expert`, and the report contains `notice: /jev expert is deprecated; use /jev frontier`

#### Scenario: Tools is not a feature
- **WHEN** the operator runs `/jev tools off`
- **THEN** the usage text is shown as a warning and `state.json` is unchanged
