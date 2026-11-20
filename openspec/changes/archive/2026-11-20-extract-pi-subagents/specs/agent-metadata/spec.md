## MODIFIED Requirements

### Requirement: Agent facts from the snapshot
Agent facts SHALL be built by a pure function from the executor's agent snapshot (the `AgentTypeSnapshot` of `ttdua/pi-subagents` `executor-agent-registry`), never by reading agent files. They SHALL hold `name`, `source` (any snapshot source, including `package`), `description`, `instructionsExcerpt` (first 500 code points of the trimmed body), `declaredTools` (the snapshot's `tools`, or `null`), `disallowedTools`, `maxTurns`, `runInBackground`, `context`, and `sets`.

#### Scenario: Built-in explore
- **WHEN** the snapshot is the built-in `explore`
- **THEN** the facts have source `builtin`, the snapshot's description, declared tools `read`, `grep`, `find`, `ls`, disallowed tools `bash`, `edit`, `write`, and the first 500 code points of its instructions as the excerpt

#### Scenario: Package source carried
- **WHEN** the snapshot's `source` is `package`
- **THEN** the facts' `source` is `package`
