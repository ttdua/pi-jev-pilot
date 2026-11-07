# jev-command Specification

## Purpose
The `/jev` command reports the status and changes feature switches through `state.json`; forms owned by later work groups print usage text, and output goes only through UI notifications.

## Requirements

### Requirement: Status report
`/jev` with no argument SHALL report the status: the status line text, the effective mode, each of the nine feature switches with `on` or `off`, the effective CLI review default (the CLI, and the model and effort when set, or that the CLI's defaults apply), whether the API key is set (naming the environment variable, never its value), whether the executor is present, every config and state problem with its field path, and, last, the session tally. Without the executor, the report MUST say `no executor` and that worker routing and tool assessment are off. The tally SHALL be a `session:` line followed by lines indented by two spaces: `prompts <P>`, `workers <W>` followed by ` (<model> <n>, ...)` in first-seen order when `W` is not 0 (lines without a model appear as `unrouted <n>`), `worker tokens <T>` and `fallbacks <F>`. It MUST show no price and no tools count. The command MUST NOT call Jev or any other network service.

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

#### Scenario: Empty tally
- **WHEN** a new session starts and `/jev` runs before any prompt
- **THEN** the report ends with `session:`, `  prompts 0`, `  workers 0`, `  worker tokens 0` and `  fallbacks 0`

#### Scenario: Tally after work
- **WHEN** two prompts were decided and one worker routed to `fixture/fast` used 120 tokens, and `/jev` runs
- **THEN** the report ends with `session:`, `  prompts 2`, `  workers 1 (fixture/fast 1)`, `  worker tokens 120` and `  fallbacks 0`

### Requirement: Feature switches
`/jev <feature> on|off`, where `<feature>` is one of `effort`, `subagents`, `skills`, `strategy`, `tools`, `expert`, `review`, `status`, `verbose`, SHALL set that switch in `state.json` through the state store, leaving other fields unchanged, then report the new status and refresh the status line. A switch set this way MUST still apply after Pi restarts.

#### Scenario: Turn a feature off
- **WHEN** the operator runs `/jev skills off`
- **THEN** `state.json` holds `switches.skills` `false`, other fields are unchanged, and the report shows `skills` `off`

#### Scenario: Switch survives a restart
- **WHEN** the operator runs `/jev skills off`, Pi exits, a new Pi process starts with the same agent directory and `/jev` runs
- **THEN** the report shows `skills` `off`

#### Scenario: Turn a feature back on
- **WHEN** `skills` is off and the operator runs `/jev skills on`
- **THEN** `state.json` holds `switches.skills` `true`

### Requirement: All features
`/jev all on|off` SHALL set the seven decision features (`effort`, `subagents`, `skills`, `strategy`, `tools`, `expert`, `review`) in one state update, and MUST leave `status` and `verbose` unchanged.

#### Scenario: All off
- **WHEN** the operator runs `/jev all off`
- **THEN** the seven decision features are `false` in `state.json`, `status` and `verbose` keep their values, and, with the key set and the config valid, the status line reads `Jev · off`

#### Scenario: All on
- **WHEN** every decision feature is off and the operator runs `/jev all on`
- **THEN** the seven decision features are `true` in `state.json`

### Requirement: Reset
`/jev reset` SHALL reset the state through the state store, so switches, the mode and the CLI review default fall back to config or code defaults, then report the status and refresh the status line.

#### Scenario: Reset after changes
- **WHEN** `skills` is off, the mode is `premium`, and the operator runs `/jev reset`
- **THEN** a new read of `state.json` has no switches, no mode and no CLI review default, and, with the key set and the config valid, the status line reads `Jev · standard`

### Requirement: Refused changes
When the state store refuses a change (an unreadable `state.json`, or a write error), `/jev` SHALL report only the problem, as an error, and MUST NOT report the change as applied. The status line is not redrawn, since nothing changed.

#### Scenario: Unreadable state
- **WHEN** `state.json` has mode `0000` and the operator runs `/jev skills off`
- **THEN** an error naming `EACCES` is reported, `state.json` is unchanged, and no `state.json.bad` exists (skipped when the test runs as root, which ignores file modes)

#### Scenario: Malformed state recovered by a change
- **WHEN** `state.json` is malformed and the operator runs `/jev skills off`
- **THEN** the old bytes move to `state.json.bad`, and `state.json` holds only `version` and `switches.skills` `false`

### Requirement: Usage text for other input
Any other argument SHALL produce usage text as a warning and change nothing. The usage text MUST list exactly the forms `/jev`, `/jev <feature> on|off` with the nine feature names, `/jev all on|off`, `/jev mode budget|standard|premium`, `/jev reset`, `/jev cli-review <codex|opencode> [model|default] [effort|default]`, `/jev <slot> <provider/model> [when <text>]`, `/jev <slot>` and `/jev remove <slot>`. A first word that is a valid, non-reserved slot name, or `remove`, MUST be handled by the slot forms (see `slot-commands`), not by this requirement. Arguments are split on whitespace and matched case-sensitively; extra words make the input unknown, except the text after `when` in the slot add form.

#### Scenario: Command from a later work group
- **WHEN** the operator runs `/jev tune`
- **THEN** usage text is reported as a warning, it lists no `tune` form, and `state.json` is unchanged

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

### Requirement: Command failures stay inside the package
An unexpected error while running `/jev` MUST be caught inside the package. It SHALL be reported as an error notification when `ctx.hasUI`, and MUST NOT propagate to Pi or print anything in print or JSON mode.

#### Scenario: Throwing tool list
- **WHEN** `getAllTools` throws while `/jev` builds the status
- **THEN** the handler returns normally and, with a UI, one error notification is shown

### Requirement: Output channel
`/jev` output SHALL go through `ctx.ui.notify` only when `ctx.hasUI` is true. In print and JSON modes it MUST print nothing; a state change requested there MUST still be applied. `/jev` output MUST NOT be added to the conversation or sent to the model.

#### Scenario: RPC notify
- **WHEN** `/jev` runs in RPC mode
- **THEN** one `extension_ui_request` with method `notify` and type `info` carries the report, and no message is added to the session

#### Scenario: Print mode is silent
- **WHEN** Pi runs `/jev skills off` with `-p`
- **THEN** stdout holds nothing from the package and `state.json` holds `switches.skills` `false`

### Requirement: Inert in a child session
`/jev` SHALL do nothing in a child session: no output, no state change, no widget update.

#### Scenario: Command in a child
- **WHEN** the `/jev` handler runs with a session id that the child registry holds
- **THEN** it returns without calling notify, writing state or setting a widget

### Requirement: CLI review default
`/jev cli-review <codex|opencode> [<model>|default] [<effort>|default]` SHALL replace the CLI review default in `state.json` through the state store, leaving other state fields unchanged. A model or effort that is omitted or `default` MUST be left unset. After a change the command SHALL report the status and refresh the status line. A value outside the state rules MUST be refused with the store's problem. The command MUST NOT call Jev.

#### Scenario: Bare reviewer
- **WHEN** the operator runs `/jev cli-review opencode`
- **THEN** `state.json` holds `cliReview` `{"cli":"opencode"}`

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

### Requirement: Codex model check
Before storing a Codex model, `/jev cli-review` SHALL read `codex debug models` through `pi.exec` with a 30-second timeout. The model MUST match, ignoring case, a tier, slug or display name of a model whose `visibility` is `list` or absent; a tier is stored as typed, anything else as its slug. A given effort MUST be in that model's `supported_reasoning_levels`. A failed check SHALL be refused with up to five suggestions, and nothing is written.

#### Scenario: Codex tier stored as a tier
- **WHEN** the Codex list has `gpt-6-luna` with efforts `low`, `high` and the operator runs `/jev cli-review codex luna high`
- **THEN** `state.json` holds `cliReview` `{"cli":"codex","model":"luna","effort":"high"}` and the report shows the CLI review default

#### Scenario: Tier in another case
- **WHEN** the Codex list has `gpt-6-luna` and the operator runs `/jev cli-review codex Luna`
- **THEN** `state.json` holds `cliReview` `{"cli":"codex","model":"Luna"}`

#### Scenario: Codex display name stored as its slug
- **WHEN** the Codex list has slug `gpt-5.6-luna` named `GPT-5.6-Luna` and the operator runs `/jev cli-review codex GPT-5.6-Luna`
- **THEN** `state.json` holds `cliReview` `{"cli":"codex","model":"gpt-5.6-luna"}`

#### Scenario: Unknown Codex model
- **WHEN** the operator runs `/jev cli-review codex nova`
- **THEN** an error names suggestions from the Codex tiers, and `state.json` is unchanged

#### Scenario: Codex effort without a model
- **WHEN** the operator runs `/jev cli-review codex default high`
- **THEN** `state.json` holds `cliReview` `{"cli":"codex","effort":"high"}` and no model list is read

#### Scenario: Unsupported Codex effort
- **WHEN** `gpt-6-luna` lists efforts `low`, `high` and the operator runs `/jev cli-review codex luna ultra`
- **THEN** an error lists `low`, `high`, and `state.json` is unchanged

### Requirement: OpenCode model check
Before storing an OpenCode model, `/jev cli-review` SHALL read `opencode models` through `pi.exec` with a 30-second timeout. The model MUST be a listed `provider/model` id, or a name exactly one provider lists, stored as the full id. An effort without a model MUST be refused. The effort is not checked. A failed check SHALL be refused with an error naming up to five candidate ids, and nothing is written.

#### Scenario: OpenCode model by name
- **WHEN** `opencode models` lists only `ollama-cloud/glm-5.3` ending in `/glm-5.3` and the operator runs `/jev cli-review opencode glm-5.3 high`
- **THEN** `state.json` holds `cliReview` `{"cli":"opencode","model":"ollama-cloud/glm-5.3","effort":"high"}`

#### Scenario: OpenCode name with two providers
- **WHEN** `opencode models` lists `a/glm-5.3` and `b/glm-5.3` and the operator runs `/jev cli-review opencode glm-5.3`
- **THEN** an error names both ids, and `state.json` is unchanged

#### Scenario: OpenCode effort without a model
- **WHEN** the operator runs `/jev cli-review opencode default high`
- **THEN** an error says an OpenCode effort needs a model, and `state.json` is unchanged

### Requirement: Unreadable model list
When the model list cannot be read (non-zero exit, timeout, or nothing parsed), `/jev cli-review` SHALL store the values as typed and report a warning that they were not checked.

#### Scenario: List unreadable
- **WHEN** `codex debug models` exits non-zero and the operator runs `/jev cli-review codex luna high`
- **THEN** `state.json` holds `cliReview` `{"cli":"codex","model":"luna","effort":"high"}` and a warning says the model was not checked

#### Scenario: OpenCode list unreadable
- **WHEN** `opencode` is not on `PATH` and the operator runs `/jev cli-review opencode p/m`
- **THEN** `state.json` holds `cliReview` `{"cli":"opencode","model":"p/m"}` and a warning says the model was not checked

### Requirement: Mode
`/jev mode <m>`, where `<m>` is `budget`, `standard` or `premium`, SHALL set `mode` in `state.json` through the state store, leaving other fields unchanged, then report the new status and refresh the status line. The command MUST NOT call Jev. The new mode SHALL apply from the next worker launch; launches already classified keep the mode they were classified with. A mode set this way MUST still apply after Pi restarts.

#### Scenario: Set premium
- **WHEN** the operator runs `/jev mode premium`
- **THEN** `state.json` holds `mode` `premium`, other fields are unchanged, the report names mode `premium`, and, with the key set and the config valid, the status line reads `Jev · premium`

#### Scenario: Mode survives a restart
- **WHEN** the operator runs `/jev mode budget`, Pi exits, a new Pi process starts with the same agent directory and `/jev` runs
- **THEN** the report names mode `budget`

#### Scenario: Back to standard
- **WHEN** the mode is `budget` and the operator runs `/jev mode standard`
- **THEN** `state.json` holds `mode` `standard`

#### Scenario: Refused mode change
- **WHEN** `state.json` has mode `0000` and the operator runs `/jev mode premium`
- **THEN** an error naming `EACCES` is reported and `state.json` is unchanged
