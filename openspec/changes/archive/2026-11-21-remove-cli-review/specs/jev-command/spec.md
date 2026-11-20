## MODIFIED Requirements

### Requirement: Feature switch commands
`/jev <feature> on|off`, where `<feature>` is one of `effort`, `subagents`, `skills`, `strategy`, `frontier`, `status`, `verbose`, SHALL set that switch in `state.json` through the state store, leaving other fields unchanged, then report the new status and refresh the status line. A switch set this way MUST still apply after Pi restarts. `review` and `tools` are not features: `/jev tools on|off` is unknown input (see "Usage text for unknown input") and changes nothing. For one minor release, `/jev expert on|off` SHALL act as `/jev frontier on|off` and the report SHALL add the line `notice: /jev expert is deprecated; use /jev frontier`; `expert` is not listed as a feature.

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

## ADDED Requirements

### Requirement: Status report contents
`/jev` with no argument SHALL report the status: the status line text, the effective mode (as `mode: <m>`, or `mode: <m> (this directory; global <g>)` while a directory mode is set, with `<g>` the global mode), each of the seven feature switches with `on` or `off`, whether the API key is set (naming the environment variable, never its value), the executor line (see `readiness-checks`), every config, state, directory mode and `tuning.json` problem with its field path, one line `deprecated: config tools is ignored` under the problems when the config read reports `tools` as deprecated (this report is the only place the deprecation is shown; it MUST NOT be notified on its own), the recent worker mix when worker routing can run (the executor is present with a launch policy), and, last, the session tally. The recent worker mix SHALL be one line `mix (last <n>, <mode>): basic <a>% / broad <b>% / deep <c>% / frontier <d>% · target <f>/<b>/<d>/≤<cap>` from the cut-point window and the effective mode's target table, followed by `cut points: seed` while the window holds fewer than 100 entries. With an empty window it SHALL read `mix: no routed workers yet` and the seed line. Shares are rounded to whole percents independently, so they may not sum to 100. The executor line SHALL read `executor: no executor; worker routing is off` when the executor is absent; `executor: <implementation>` when it is present with a launch policy, where `<implementation>` is the service's `implementation` or `unknown`; and `executor: <implementation>; no launch policy, worker routing is off` when the launch policy is missing. When the agent registry is missing, the line SHALL end with `; no agent registry`. The report MUST NOT advise uninstalling any package. The tally SHALL be a `session:` line followed by lines indented by two spaces: `prompts <P>`, `workers <W>` followed by ` (<model> <n>, ...)` in first-seen order when `W` is not 0 (lines without a model appear as `unrouted <n>`), `worker tokens <T>` and `fallbacks <F>`. It MUST show no price and no tools count. The command MUST NOT call Jev or any other network service.

#### Scenario: Default status
- **WHEN** the config is valid, the key is set, the executor is installed, and `/jev` runs
- **THEN** the report names mode `standard`, lists every feature `on` except `verbose`, has no `cli review` line, says the key in `TYPESAFE_API_KEY` is set, and contains `executor: @ttdua/pi-subagents`

#### Scenario: Directory mode in the report
- **WHEN** `state.json` sets the mode to `standard`, the directory mode is `premium`, and `/jev` runs
- **THEN** the report contains `mode: premium (this directory; global standard)`, and its `mix` line, when shown, names `premium` and the `premium` target

#### Scenario: Malformed directory mode reported
- **WHEN** `<cwd>/.pi/jev-mode.json` is not valid JSON and `/jev` runs
- **THEN** the report contains `mode: standard` and lists a `local mode (malformed)` problem at `(file)`

#### Scenario: No executor
- **WHEN** the executor is not installed and `/jev` runs
- **THEN** the report contains `executor: no executor; worker routing is off`

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
- **WHEN** jev-pilot runs with an executor whose service, like that of `@gotgenes/pi-subagents` 25.0.5, has no `implementation`, no `registerLaunchPolicy` and no `listAgentTypes`, and `/jev` runs
- **THEN** the report contains `executor: unknown; no launch policy, worker routing is off; no agent registry`, has no `mix` line, and does not contain `uninstall`

#### Scenario: Executor without an agent registry reported
- **WHEN** the executor's service has `registerLaunchPolicy` and no `listAgentTypes`, and `/jev` runs
- **THEN** the executor line ends with `; no agent registry`

### Requirement: All decision features
`/jev all on|off` SHALL set the five decision features (`effort`, `subagents`, `skills`, `strategy`, `frontier`) in one state update, and MUST leave `status` and `verbose` unchanged.

#### Scenario: All off
- **WHEN** the operator runs `/jev all off`
- **THEN** the five decision features are `false` in `state.json`, `status` and `verbose` keep their values, and, with the key set and the config valid, the status line reads `Jev · off`

#### Scenario: All on
- **WHEN** every decision feature is off and the operator runs `/jev all on`
- **THEN** the five decision features are `true` in `state.json`

### Requirement: Reset command
`/jev reset` SHALL reset the state through the state store, so switches and the mode fall back to config or code defaults. When the reset succeeds and the current directory has a directory mode file, it SHALL also remove that file (see `directory-mode`). It then reports the status and refreshes the status line. When the state store refuses the reset, the directory mode file MUST stay as it was. When the state reset succeeds but the file cannot be removed, the command SHALL still report the status and refresh the status line, with one warning that the global settings were reset and the directory mode was not removed, naming the error.

#### Scenario: Reset after changes
- **WHEN** `skills` is off, the mode is `premium`, and the operator runs `/jev reset`
- **THEN** a new read of `state.json` has no switches and no mode, and, with the key set and the config valid, the status line reads `Jev · standard`

#### Scenario: Reset removes the directory mode
- **WHEN** the directory mode is `premium` and the operator runs `/jev reset`
- **THEN** `<cwd>/.pi/jev-mode.json` no longer exists, the report contains `mode: standard` with no `(this directory` text, and, with the key set and the config valid, the status line reads `Jev · standard`

#### Scenario: Refused reset keeps the directory mode
- **WHEN** the directory mode is `premium`, `state.json` has mode `0000`, and the operator runs `/jev reset`
- **THEN** an error naming `EACCES` is reported and `<cwd>/.pi/jev-mode.json` still holds `premium`

#### Scenario: Partial reset reports a warning and redraws
- **WHEN** `skills` is off, the global mode is `premium`, the directory mode is `budget`, `<cwd>/.pi` cannot be written, and the operator runs `/jev reset`
- **THEN** `state.json` holds only `version`, `<cwd>/.pi/jev-mode.json` still holds `budget`, one warning contains `global settings reset; directory mode not removed:`, the error code and `mode: budget (this directory; global standard)`, and, with the key set and the config valid, the status line is redrawn as `Jev · budget (local)`

### Requirement: Usage text for unknown input
Any other argument SHALL produce usage text as a warning and change nothing. The usage text MUST list exactly the forms `/jev`, `/jev <feature> on|off` with the seven feature names, `/jev all on|off`, `/jev mode budget|standard|premium [global]`, `/jev mode clear`, `/jev reset`, `/jev <slot> <provider/model> [when <text>]`, `/jev <slot>`, `/jev remove <slot>` and `/jev tune [undo|reset|on|off]`. A first word that is `tune` MUST be handled by the tune forms (see `tune-command`). `/jev cli-review` with any arguments is other input. A first word that is a valid, non-reserved slot name, or `remove`, MUST be handled by the slot forms (see `slot-commands`), not by this requirement. Arguments are split on whitespace and matched case-sensitively; extra words make the input unknown, except the text after `when` in the slot add form.

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

#### Scenario: Removed cli-review forms
- **WHEN** the operator runs `/jev cli-review on`, `/jev cli-review off`, `/jev cli-review codex` or `/jev cli-review opencode p/m high`
- **THEN** usage text is reported as a warning, no process runs, `state.json` is unchanged, and the usage text does not contain `cli-review`

#### Scenario: Removed review switch
- **WHEN** the operator runs `/jev review off` or `/jev review on`
- **THEN** usage text is reported as a warning and `state.json` is unchanged

#### Scenario: Whitespace only
- **WHEN** the operator runs `/jev` followed only by spaces
- **THEN** the status is reported, as with no argument

#### Scenario: Usage lists the slot forms
- **WHEN** usage text is reported
- **THEN** it contains `/jev <slot> <provider/model> [when <text>]`, `/jev <slot>` and `/jev remove <slot>`

## REMOVED Requirements

### Requirement: Status report

**Reason**: Restated as "Status report contents" because its CLI review scenarios are removed with the CLI review; OpenSpec cannot drop a scenario through MODIFIED.

**Migration**: Replaced by "Status report contents" in this capability.

### Requirement: All features

**Reason**: Restated as "All decision features" because its CLI review scenarios are removed with the CLI review; OpenSpec cannot drop a scenario through MODIFIED.

**Migration**: Replaced by "All decision features" in this capability.

### Requirement: Reset

**Reason**: Restated as "Reset command" because its CLI review scenarios are removed with the CLI review; OpenSpec cannot drop a scenario through MODIFIED.

**Migration**: Replaced by "Reset command" in this capability.

### Requirement: Usage text for other input

**Reason**: Restated as "Usage text for unknown input" because the cli-review forms and their scenarios are removed with the CLI review; OpenSpec cannot drop a scenario through MODIFIED.

**Migration**: Replaced by "Usage text for unknown input" in this capability.

### Requirement: CLI review default

**Reason**: The CLI review is removed; jev-pilot no longer runs the operator's Codex or OpenCode CLI.

**Migration**: `/jev cli-review ...` now prints usage text. `cliReview` and `cliReviewEnabled` left in `state.json` are accepted, ignored and removed at the next main session start (see `state-file`). Run a CLI review outside Pi, or ask the main model to call the CLI with `bash`.

### Requirement: Codex model check

**Reason**: The CLI review is removed; jev-pilot no longer runs the operator's Codex or OpenCode CLI.

**Migration**: `/jev cli-review ...` now prints usage text. `cliReview` and `cliReviewEnabled` left in `state.json` are accepted, ignored and removed at the next main session start (see `state-file`). Run a CLI review outside Pi, or ask the main model to call the CLI with `bash`.

### Requirement: OpenCode model check

**Reason**: The CLI review is removed; jev-pilot no longer runs the operator's Codex or OpenCode CLI.

**Migration**: `/jev cli-review ...` now prints usage text. `cliReview` and `cliReviewEnabled` left in `state.json` are accepted, ignored and removed at the next main session start (see `state-file`). Run a CLI review outside Pi, or ask the main model to call the CLI with `bash`.

### Requirement: Unreadable model list

**Reason**: The CLI review is removed; jev-pilot no longer runs the operator's Codex or OpenCode CLI.

**Migration**: `/jev cli-review ...` now prints usage text. `cliReview` and `cliReviewEnabled` left in `state.json` are accepted, ignored and removed at the next main session start (see `state-file`). Run a CLI review outside Pi, or ask the main model to call the CLI with `bash`.

### Requirement: CLI review switch

**Reason**: The CLI review is removed; jev-pilot no longer runs the operator's Codex or OpenCode CLI.

**Migration**: `/jev cli-review ...` now prints usage text. `cliReview` and `cliReviewEnabled` left in `state.json` are accepted, ignored and removed at the next main session start (see `state-file`). Run a CLI review outside Pi, or ask the main model to call the CLI with `bash`.
