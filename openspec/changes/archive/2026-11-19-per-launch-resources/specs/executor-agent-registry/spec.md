## MODIFIED Requirements

### Requirement: Agent snapshot content
Each snapshot SHALL be a frozen, plain serializable copy holding `name`, `source` (`builtin`, `package`, `global` or `project`), `description`, `instructions` (the body), `tools` (as declared, or `null` when undeclared), `defaultTools`, `disallowedTools`, and as declared or absent `model`, `thinking`, `locked` (`true` or a list of lockable fields), `maxTurns`, `runInBackground`, `context` (`fresh` or `fork`) and `inheritSkills` (`false`, present only when the agent file declares `inherit_skills: false`; see `launch-resources`). Changing a snapshot MUST NOT change executor state.

#### Scenario: Built-in explore
- **WHEN** no other file defines `explore` and `getAgentType("explore")` is called
- **THEN** the snapshot has `source` `builtin`, `tools` `read`, `grep`, `find`, `ls`, `disallowedTools` `bash`, `edit`, `write`, no `locked`, no `context`, no `model`, and `instructions` the body of the executor's `agents/explore.md`

#### Scenario: Package source
- **WHEN** an agent loads from a configured package
- **THEN** its snapshot has `source` `package`

#### Scenario: Snapshot is detached
- **WHEN** a caller tries to push a tool name onto a returned snapshot's `tools`
- **THEN** the push fails or has no effect, and a later `getAgentType` for the same agent returns the original list

#### Scenario: Absent tools kept distinct from defaults
- **WHEN** an agent file has no `tools` field
- **THEN** its snapshot has `tools` `null` and `defaultTools` the seven built-ins

#### Scenario: Pinned skills in the snapshot
- **WHEN** an agent file declares `inherit_skills: false`
- **THEN** its snapshot has `inheritSkills` `false`, and the snapshot of an agent without the field has no `inheritSkills`
