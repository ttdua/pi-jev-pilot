## MODIFIED Requirements

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
