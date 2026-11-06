## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Status report
`/jev` with no argument SHALL report the status: the status line text, the effective mode, each of the nine feature switches with `on` or `off`, the effective CLI review default (the CLI, and the model and effort when set, or that the CLI's defaults apply), whether the API key is set (naming the environment variable, never its value), whether the executor is present, and every config and state problem with its field path. Without the executor, the report MUST say `no executor` and that worker routing and tool assessment are off. The command MUST NOT call Jev or any other network service.

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

### Requirement: Usage text for other input
Any other argument SHALL produce usage text as a warning and change nothing. The usage text MUST list exactly the forms `/jev`, `/jev <feature> on|off` with the nine feature names, `/jev all on|off`, `/jev reset` and `/jev cli-review <codex|opencode> [model|default] [effort|default]`. Arguments are split on whitespace and matched case-sensitively; extra words make the input unknown.

#### Scenario: Command from a later work group
- **WHEN** the operator runs `/jev mode premium`
- **THEN** usage text is reported as a warning, it lists no `mode` form, and `state.json` is unchanged

#### Scenario: Unknown feature
- **WHEN** the operator runs `/jev colors off`
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
