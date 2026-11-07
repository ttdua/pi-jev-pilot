## MODIFIED Requirements

### Requirement: Status report
`/jev` with no argument SHALL report the status: the status line text, the effective mode, each of the nine feature switches with `on` or `off`, the effective CLI review default (the CLI, and the model and effort when set, or that the CLI's defaults apply), whether the API key is set (naming the environment variable, never its value), whether the executor is present, every config, state and `tuning.json` problem with its field path, and, last, the session tally. Without the executor, the report MUST say `no executor` and that worker routing and tool assessment are off. The tally SHALL be a `session:` line followed by lines indented by two spaces: `prompts <P>`, `workers <W>` followed by ` (<model> <n>, ...)` in first-seen order when `W` is not 0 (lines without a model appear as `unrouted <n>`), `worker tokens <T>` and `fallbacks <F>`. It MUST show no price and no tools count. The command MUST NOT call Jev or any other network service.

#### Scenario: Default status
- **WHEN** the config is valid, the key is set, the executor is installed, and `/jev` runs
- **THEN** the report names mode `standard`, lists every feature `on` except `verbose`, shows the CLI review default as `codex` with the CLI's defaults, says the key in `TYPESAFE_API_KEY` is set, and reports the executor as present

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

### Requirement: Usage text for other input
Any other argument SHALL produce usage text as a warning and change nothing. The usage text MUST list exactly the forms `/jev`, `/jev <feature> on|off` with the nine feature names, `/jev all on|off`, `/jev mode budget|standard|premium`, `/jev reset`, `/jev cli-review <codex|opencode> [model|default] [effort|default]`, `/jev <slot> <provider/model> [when <text>]`, `/jev <slot>`, `/jev remove <slot>` and `/jev tune [undo|reset|on|off]`. A first word that is `tune` MUST be handled by the tune forms (see `tune-command`). A first word that is a valid, non-reserved slot name, or `remove`, MUST be handled by the slot forms (see `slot-commands`), not by this requirement. Arguments are split on whitespace and matched case-sensitively; extra words make the input unknown, except the text after `when` in the slot add form.

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

#### Scenario: Whitespace only
- **WHEN** the operator runs `/jev` followed only by spaces
- **THEN** the status is reported, as with no argument

#### Scenario: Usage lists the slot forms
- **WHEN** usage text is reported
- **THEN** it contains `/jev <slot> <provider/model> [when <text>]`, `/jev <slot>` and `/jev remove <slot>`

