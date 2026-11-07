## MODIFIED Requirements

### Requirement: Status report
`/jev` with no argument SHALL report the status: the status line text, the effective mode (as `mode: <m>`, or `mode: <m> (session; saved <s>)` while a session mode is set, with `<s>` the saved mode), each of the nine feature switches with `on` or `off`, the effective CLI review default (the CLI, and the model and effort when set, or that the CLI's defaults apply), whether the API key is set (naming the environment variable, never its value), whether the executor is present, every config, state and `tuning.json` problem with its field path, the recent worker mix when the executor is present, and, last, the session tally. The recent worker mix SHALL be one line `mix (last <n>, <mode>): fast <a>% / balanced <b>% / deep <c>% / expert <d>% · target <f>/<b>/<d>/≤<cap>` from the cut-point window and the effective mode's target table, followed by `cut points: seed` while the window holds fewer than 100 entries. With an empty window it SHALL read `mix: no routed workers yet` and the seed line. Shares are rounded to whole percents independently, so they may not sum to 100. Without the executor, the report MUST say `no executor` and that worker routing and tool assessment are off. The tally SHALL be a `session:` line followed by lines indented by two spaces: `prompts <P>`, `workers <W>` followed by ` (<model> <n>, ...)` in first-seen order when `W` is not 0 (lines without a model appear as `unrouted <n>`), `worker tokens <T>` and `fallbacks <F>`. It MUST show no price and no tools count. The command MUST NOT call Jev or any other network service.

#### Scenario: Default status
- **WHEN** the config is valid, the key is set, the executor is installed, and `/jev` runs
- **THEN** the report names mode `standard`, lists every feature `on` except `verbose`, shows the CLI review default as `codex` with the CLI's defaults, says the key in `TYPESAFE_API_KEY` is set, and reports the executor as present

#### Scenario: Session mode in the report
- **WHEN** `state.json` sets the mode to `standard`, the session mode is `premium`, and `/jev` runs
- **THEN** the report contains `mode: premium (session; saved standard)`, and its `mix` line, when shown, names `premium` and the `premium` target

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
Any other argument SHALL produce usage text as a warning and change nothing. The usage text MUST list exactly the forms `/jev`, `/jev <feature> on|off` with the nine feature names, `/jev all on|off`, `/jev mode budget|standard|premium`, `/jev mode budget|standard|premium session`, `/jev mode session off`, `/jev reset`, `/jev cli-review <codex|opencode> [model|default] [effort|default]`, `/jev <slot> <provider/model> [when <text>]`, `/jev <slot>`, `/jev remove <slot>` and `/jev tune [undo|reset|on|off]`. A first word that is `tune` MUST be handled by the tune forms (see `tune-command`). A first word that is a valid, non-reserved slot name, or `remove`, MUST be handled by the slot forms (see `slot-commands`), not by this requirement. Arguments are split on whitespace and matched case-sensitively; extra words make the input unknown, except the text after `when` in the slot add form.

#### Scenario: Command from a later work group
<!-- Intentional change: WG-18 adds the tune forms, so `/jev tune` is no longer usage. -->
- **WHEN** the operator runs `/jev tune`
- **THEN** the tune report is shown as info, not usage text, and `state.json` is unchanged

#### Scenario: Usage lists the tune form
- **WHEN** usage text is reported
- **THEN** it contains `/jev tune [undo|reset|on|off]`

#### Scenario: Unknown mode
- **WHEN** the operator runs `/jev mode quality`, `/jev mode Premium`, `/jev mode`, `/jev mode premium now`, `/jev mode premium Session`, `/jev mode session`, `/jev mode session on` or `/jev mode premium session now`
- **THEN** usage text is reported, `state.json` is unchanged and no session entry is written

#### Scenario: Usage lists the mode form
- **WHEN** usage text is reported
- **THEN** it contains `/jev mode budget|standard|premium`, `/jev mode budget|standard|premium session` and `/jev mode session off`

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
`/jev reset` SHALL reset the state through the state store, so switches, the mode and the CLI review default fall back to config or code defaults. When the reset succeeds and a session mode is set, it SHALL also clear the session mode (see `session-mode`). It then reports the status and refreshes the status line. When the state store refuses the reset, the session mode MUST stay as it was.

#### Scenario: Reset after changes
- **WHEN** `skills` is off, the mode is `premium`, and the operator runs `/jev reset`
- **THEN** a new read of `state.json` has no switches, no mode and no CLI review default, and, with the key set and the config valid, the status line reads `Jev · standard`

#### Scenario: Reset clears the session mode
- **WHEN** the session mode is `premium` and the operator runs `/jev reset`
- **THEN** a clearing session entry is written, the report contains `mode: standard` with no `(session` text, and, with the key set and the config valid, the status line reads `Jev · standard`

#### Scenario: Refused reset keeps the session mode
- **WHEN** the session mode is `premium`, `state.json` has mode `0000`, and the operator runs `/jev reset`
- **THEN** an error naming `EACCES` is reported, no session entry is written, and the session mode is still `premium`

### Requirement: Mode
`/jev mode <m>`, where `<m>` is `budget`, `standard` or `premium`, SHALL set `mode` in `state.json` through the state store, leaving other fields unchanged, then report the new status and refresh the status line. The command MUST NOT call Jev. The new mode SHALL apply from the next worker launch in every session without a session mode; launches already classified keep the mode they were classified with. A mode set this way MUST still apply after Pi restarts. While the current session has a session mode, the command MUST leave the session mode unchanged and in effect, and the report MUST add the line `session mode <s> still applies here; saved mode is now <m>`.

#### Scenario: Set premium
- **WHEN** the operator runs `/jev mode premium`
- **THEN** `state.json` holds `mode` `premium`, other fields are unchanged, the report names mode `premium`, and, with the key set and the config valid, the status line reads `Jev · premium`

#### Scenario: Mode survives a restart
- **WHEN** the operator runs `/jev mode budget`, Pi exits, a new Pi process starts with the same agent directory and `/jev` runs
- **THEN** the report names mode `budget`

#### Scenario: Back to standard
- **WHEN** the mode is `budget` and the operator runs `/jev mode standard`
- **THEN** `state.json` holds `mode` `standard`

#### Scenario: Saving keeps the session mode
- **WHEN** the session mode is `budget` and the operator runs `/jev mode premium`
- **THEN** `state.json` holds `mode` `premium`, no session entry is written, the report contains `mode: budget (session; saved premium)` and `session mode budget still applies here; saved mode is now premium`, and, with the key set and the config valid, the status line reads `Jev · budget (session)`

#### Scenario: Refused mode change
- **WHEN** `state.json` has mode `0000` and the operator runs `/jev mode premium`
- **THEN** an error naming `EACCES` is reported and `state.json` is unchanged

