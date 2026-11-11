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

### Requirement: Agent facts from the executor
Agent facts SHALL be built by a pure function from the agent snapshot the executor supplies (see `executor-agent-registry`), never by reading agent files. The facts SHALL hold:
- `name`, `source` and `description` as in the snapshot;
- `instructionsExcerpt`: the first 500 Unicode code points of the trimmed `instructions`;
- `declaredTools`: the snapshot's `tools`, or `null`;
- `disallowedTools`;
- `maxTurns`, `runInBackground` and `inheritContext`;
- `sets`: whether `model` and `thinking` are set.

`thinking` counts as set only when it is one of `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.

#### Scenario: Built-in Explore
- **WHEN** the snapshot is the built-in `Explore`
- **THEN** the facts have source `builtin`, description `Fast codebase exploration agent (read-only)`, declared tools `read`, `bash`, `grep`, `find`, `ls`, the first 500 code points of the built-in instructions as the excerpt, and no disallowed tools

#### Scenario: Long instructions
- **WHEN** the snapshot's `instructions` are 2000 characters long
- **THEN** the instructions excerpt is its first 500 characters

#### Scenario: Disallowed tools carried
- **WHEN** the snapshot's `disallowedTools` is `bash`
- **THEN** the facts' `disallowedTools` is `bash`
