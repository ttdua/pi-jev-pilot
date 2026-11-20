# agent-metadata Specification

## Purpose
Find a launch's agent the way the executor does, and read the facts routing and the worker request need, never the agent's own model or thinking.

## Requirements

### Requirement: Model and thinking are never read out
The agent's declared `model` and `thinking` values MUST NOT be copied into the agent facts or into any Jev request. The facts SHALL record only whether each is set. The ledger's `effectiveModel` and `effectiveThinking` record what the child actually ran with, as reported by the executor (see `worker-ledger`); they are runtime facts, not agent facts, and are allowed even when they equal the agent's declared values.

#### Scenario: Model never read out
- **WHEN** the snapshot has `model` `anthropic/claude-opus` and `thinking` `high`
- **THEN** neither value appears anywhere in the facts, and both are recorded as set

#### Scenario: Invalid thinking is not set
- **WHEN** the snapshot's `thinking` is `banana`
- **THEN** thinking is recorded as not set

### Requirement: Agent facts from the snapshot
Agent facts SHALL be built by a pure function from the executor's agent snapshot (the `AgentTypeSnapshot` of `ttdua/pi-subagents` `executor-agent-registry`), never by reading agent files. They SHALL hold `name`, `source` (any snapshot source, including `package`), `description`, `instructionsExcerpt` (first 500 code points of the trimmed body), `declaredTools` (the snapshot's `tools`, or `null`), `disallowedTools`, `maxTurns`, `runInBackground`, `context`, and `sets`.

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
