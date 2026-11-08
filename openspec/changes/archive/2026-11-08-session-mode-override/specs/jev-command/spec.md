## MODIFIED Requirements

### Requirement: Status report
`/jev` with no argument SHALL report the status: the status line text, the effective mode (as `mode: <m>`, or `mode: <m> (this directory; global <g>)` while a directory mode is set, with `<g>` the global mode), each of the nine feature switches with `on` or `off`, the effective CLI review default (the CLI, and the model and effort when set, or that the CLI's defaults apply), whether the API key is set (naming the environment variable, never its value), whether the executor is present, every config, state, directory mode and `tuning.json` problem with its field path, the recent worker mix when the executor is present, and, last, the session tally. The recent worker mix SHALL be one line `mix (last <n>, <mode>): fast <a>% / balanced <b>% / deep <c>% / expert <d>% · target <f>/<b>/<d>/≤<cap>` from the cut-point window and the effective mode's target table, followed by `cut points: seed` while the window holds fewer than 100 entries. With an empty window it SHALL read `mix: no routed workers yet` and the seed line. Shares are rounded to whole percents independently, so they may not sum to 100. Without the executor, the report MUST say `no executor` and that worker routing and tool assessment are off. The tally SHALL be a `session:` line followed by lines indented by two spaces: `prompts <P>`, `workers <W>` followed by ` (<model> <n>, ...)` in first-seen order when `W` is not 0 (lines without a model appear as `unrouted <n>`), `worker tokens <T>` and `fallbacks <F>`. It MUST show no price and no tools count. The command MUST NOT call Jev or any other network service.

#### Scenario: Default status
- **WHEN** the config is valid, the key is set, the executor is installed, and `/jev` runs
- **THEN** the report names mode `standard`, lists every feature `on` except `verbose`, shows the CLI review default as `codex` with the CLI's defaults, says the key in `TYPESAFE_API_KEY` is set, and reports the executor as present

#### Scenario: Directory mode in the report
- **WHEN** `state.json` sets the mode to `standard`, the directory mode is `premium`, and `/jev` runs
- **THEN** the report contains `mode: premium (this directory; global standard)`, and its `mix` line, when shown, names `premium` and the `premium` target

#### Scenario: Malformed directory mode reported
- **WHEN** `<cwd>/.pi/jev-mode.json` is not valid JSON and `/jev` runs
- **THEN** the report contains `mode: standard` and lists a `local mode (malformed)` problem at `(file)`

#### Scenario: CLI review default shown
- **WHEN** the state holds `cliReview` `{"cli":"codex","model":"luna","effort":"high"}` and `/jev` runs
- **THEN** the report shows the CLI review default as `codex` with model `luna` and effort `high`

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

### Requirement: Usage text for other input
Any other argument SHALL produce usage text as a warning and change nothing. The usage text MUST list exactly the forms `/jev`, `/jev <feature> on|off` with the nine feature names, `/jev all on|off`, `/jev mode budget|standard|premium [global]`, `/jev mode clear`, `/jev reset`, `/jev cli-review <codex|opencode> [model|default] [effort|default]`, `/jev <slot> <provider/model> [when <text>]`, `/jev <slot>`, `/jev remove <slot>` and `/jev tune [undo|reset|on|off]`. A first word that is `tune` MUST be handled by the tune forms (see `tune-command`). A first word that is a valid, non-reserved slot name, or `remove`, MUST be handled by the slot forms (see `slot-commands`), not by this requirement. Arguments are split on whitespace and matched case-sensitively; extra words make the input unknown, except the text after `when` in the slot add form.

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

#### Scenario: Whitespace only
- **WHEN** the operator runs `/jev` followed only by spaces
- **THEN** the status is reported, as with no argument

#### Scenario: Usage lists the slot forms
- **WHEN** usage text is reported
- **THEN** it contains `/jev <slot> <provider/model> [when <text>]`, `/jev <slot>` and `/jev remove <slot>`

### Requirement: Reset
`/jev reset` SHALL reset the state through the state store, so switches, the mode and the CLI review default fall back to config or code defaults. When the reset succeeds and the current directory has a directory mode file, it SHALL also remove that file (see `directory-mode`). It then reports the status and refreshes the status line. When the state store refuses the reset, the directory mode file MUST stay as it was. When the state reset succeeds but the file cannot be removed, the command SHALL still report the status and refresh the status line, with one warning that the global settings were reset and the directory mode was not removed, naming the error.

#### Scenario: Reset after changes
- **WHEN** `skills` is off, the mode is `premium`, and the operator runs `/jev reset`
- **THEN** a new read of `state.json` has no switches, no mode and no CLI review default, and, with the key set and the config valid, the status line reads `Jev · standard`

#### Scenario: Reset removes the directory mode
- **WHEN** the directory mode is `premium` and the operator runs `/jev reset`
- **THEN** `<cwd>/.pi/jev-mode.json` no longer exists, the report contains `mode: standard` with no `(this directory` text, and, with the key set and the config valid, the status line reads `Jev · standard`

#### Scenario: Refused reset keeps the directory mode
- **WHEN** the directory mode is `premium`, `state.json` has mode `0000`, and the operator runs `/jev reset`
- **THEN** an error naming `EACCES` is reported and `<cwd>/.pi/jev-mode.json` still holds `premium`

#### Scenario: Partial reset reports a warning and redraws
- **WHEN** `skills` is off, the global mode is `premium`, the directory mode is `budget`, `<cwd>/.pi` cannot be written, and the operator runs `/jev reset`
- **THEN** `state.json` holds only `version`, `<cwd>/.pi/jev-mode.json` still holds `budget`, one warning contains `global settings reset; directory mode not removed:`, the error code and `mode: budget (this directory; global standard)`, and, with the key set and the config valid, the status line is redrawn as `Jev · budget (local)`

### Requirement: Mode
<!-- Intentional change: `/jev mode <m>` now targets the current directory; the global form needs `global`. The scenarios "Set premium", "Mode survives a restart" and "Back to standard" now use the `global` form, which carries the old behaviour. -->
`/jev mode <m>`, where `<m>` is `budget`, `standard` or `premium`, SHALL set the directory mode of the current directory (see `directory-mode`). `/jev mode <m> global` SHALL set `mode` in `state.json` through the state store, leaving other fields unchanged. Either form then reports the new status and refreshes the status line, and MUST NOT call Jev. The new mode SHALL apply from the next worker launch; launches already classified keep the mode they were classified with. A global mode MUST still apply after Pi restarts. While the current directory has a directory mode, the global form MUST leave it unchanged and in effect, and the report MUST add the line `directory mode <d> still applies here; global mode is now <m>`.

#### Scenario: Set premium
- **WHEN** the operator runs `/jev mode premium global`
- **THEN** `state.json` holds `mode` `premium`, other fields are unchanged, no `<cwd>/.pi/jev-mode.json` is created, the report names mode `premium`, and, with the key set and the config valid, the status line reads `Jev · premium`

#### Scenario: Mode survives a restart
- **WHEN** the operator runs `/jev mode budget global`, Pi exits, a new Pi process starts with the same agent directory in a directory without a directory mode, and `/jev` runs
- **THEN** the report names mode `budget`

#### Scenario: Back to standard
- **WHEN** the global mode is `budget` and the operator runs `/jev mode standard global`
- **THEN** `state.json` holds `mode` `standard`

#### Scenario: Plain form targets the directory
- **WHEN** `state.json` sets the mode to `standard` and the operator runs `/jev mode premium`
- **THEN** `state.json` is unchanged, `<cwd>/.pi/jev-mode.json` holds `premium`, and the report contains `mode: premium (this directory; global standard)`

#### Scenario: Global set keeps the directory mode
- **WHEN** the directory mode is `budget` and the operator runs `/jev mode premium global`
- **THEN** `state.json` holds `mode` `premium`, `<cwd>/.pi/jev-mode.json` still holds `budget`, the report contains `mode: budget (this directory; global premium)` and `directory mode budget still applies here; global mode is now premium`, and, with the key set and the config valid, the status line reads `Jev · budget (local)`

#### Scenario: Refused mode change
- **WHEN** `state.json` has mode `0000` and the operator runs `/jev mode premium global`
- **THEN** an error naming `EACCES` is reported and `state.json` is unchanged
