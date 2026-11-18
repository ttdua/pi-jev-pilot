## MODIFIED Requirements

### Requirement: Agent facts from the executor
Agent facts SHALL be built by a pure function from the agent snapshot the executor supplies (see `executor-agent-registry`), never by reading agent files. The facts SHALL hold:
- `name`, `source` and `description` as in the snapshot;
- `instructionsExcerpt`: the first 500 Unicode code points of the trimmed `instructions`;
- `declaredTools`: the snapshot's `tools`, or `null`;
- `disallowedTools`;
- `maxTurns`, `runInBackground` and `context`;
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

#### Scenario: Context carried
- **WHEN** the snapshot's `context` is `fork`
- **THEN** the facts' `context` is `fork`
