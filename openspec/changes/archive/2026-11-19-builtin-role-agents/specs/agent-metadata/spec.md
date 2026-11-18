## ADDED Requirements

### Requirement: Agent facts from the snapshot
Agent facts SHALL be built by a pure function from the executor's agent snapshot (see `executor-agent-registry`), never by reading agent files. They SHALL hold `name`, `source` (any snapshot source, including `package`), `description`, `instructionsExcerpt` (first 500 code points of the trimmed body), `declaredTools` (the snapshot's `tools`, or `null`), `disallowedTools`, `maxTurns`, `runInBackground`, `context`, and `sets`.

#### Scenario: Built-in explore
- **WHEN** the snapshot is the built-in `explore`
- **THEN** the facts have source `builtin`, the snapshot's description, declared tools `read`, `grep`, `find`, `ls`, disallowed tools `bash`, `edit`, `write`, and the first 500 code points of its instructions as the excerpt

#### Scenario: Package source carried
- **WHEN** the snapshot's `source` is `package`
- **THEN** the facts' `source` is `package`

### Requirement: Thinking counts as set only when known
`sets.thinking` SHALL be true only when the snapshot's `thinking` is one of `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.

#### Scenario: Unknown thinking not set
- **WHEN** the snapshot's `thinking` is `banana`
- **THEN** `sets.thinking` is false

#### Scenario: Long instructions
- **WHEN** the snapshot's `instructions` are 2000 characters long
- **THEN** the instructions excerpt is its first 500 characters

#### Scenario: Disallowed tools carried
- **WHEN** the snapshot's `disallowedTools` is `bash`
- **THEN** the facts' `disallowedTools` is `bash`

#### Scenario: Context carried
- **WHEN** the snapshot's `context` is `fork`
- **THEN** the facts' `context` is `fork`

## REMOVED Requirements

### Requirement: Agent facts from the executor

**Reason**: Restated as "Agent facts from the snapshot": `source` gains `package` and the built-in example becomes `explore`; OpenSpec cannot drop a scenario through MODIFIED.

**Migration**: None; the facts keep every field.
