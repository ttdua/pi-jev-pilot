# jev-command Specification

## Purpose
The `/jev` command reports the status and changes feature switches through `state.json`; forms owned by later work groups print usage text, and output goes only through UI notifications.

## Requirements

### Requirement: Status report
`/jev` with no argument SHALL report the status: the status line text, the effective mode, each of the nine feature switches with `on` or `off`, whether the API key is set (naming the environment variable, never its value), whether the executor is present, and every config and state problem with its field path. Without the executor, the report MUST say `no executor` and that worker routing and tool assessment are off. The command MUST NOT call Jev or any other network service.

#### Scenario: Default status
- **WHEN** the config is valid, the key is set, the executor is installed, and `/jev` runs
- **THEN** the report names mode `standard`, lists every feature `on` except `verbose`, says the key in `TYPESAFE_API_KEY` is set, and reports the executor as present

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
Any other argument SHALL produce usage text as a warning and change nothing. The usage text MUST list exactly the forms `/jev`, `/jev <feature> on|off` with the nine feature names, `/jev all on|off` and `/jev reset`. Arguments are split on whitespace and matched case-sensitively; extra words make the input unknown.

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

#### Scenario: Whitespace only
- **WHEN** the operator runs `/jev` followed only by spaces
- **THEN** the status is reported, as with no argument

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
