## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Usage text for other input
Any other argument SHALL produce usage text as a warning and change nothing. The usage text MUST list exactly the forms `/jev`, `/jev <feature> on|off` with the nine feature names, `/jev all on|off`, `/jev mode budget|standard|premium`, `/jev reset` and `/jev cli-review <codex|opencode> [model|default] [effort|default]`. Arguments are split on whitespace and matched case-sensitively; extra words make the input unknown.

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
