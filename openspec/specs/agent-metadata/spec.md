# agent-metadata Specification

## Purpose
Find a launch's agent the way the executor does, and read the facts routing and the worker request need, never the agent's own model or thinking.

## Requirements

### Requirement: Agent lookup order
Given a launch's `subagent_type`, a project directory and an agent directory, the reader SHALL return the agent the executor would run, naming its `source` as `project`, `global` or `builtin`. An exact name MUST resolve with the precedence `<cwd>/.pi/agents/`, then `<agentDir>/agents/`, then the built-in table. Otherwise, or for a non-string type, the reader MUST return the built-in `general-purpose` agent, unless a case-insensitive match applies.

#### Scenario: Project file wins
- **WHEN** both `.pi/agents/worker.md` and `<agentDir>/agents/worker.md` exist and the launch names `worker`
- **THEN** the reader returns the project agent with source `project`

#### Scenario: Global file
- **WHEN** only `<agentDir>/agents/worker.md` exists and the launch names `worker`
- **THEN** the reader returns it with source `global`

#### Scenario: Project file overrides a built-in
- **WHEN** `.pi/agents/Explore.md` exists and the launch names `Explore`
- **THEN** the reader returns the project file, not the built-in

#### Scenario: Case-insensitive match
- **WHEN** the only agent file is `.pi/agents/Worker.md` and the launch names `worker`
- **THEN** the reader returns that agent

#### Scenario: Unknown type
- **WHEN** the launch names `does-not-exist` and no file or built-in matches
- **THEN** the reader returns the built-in `general-purpose` agent

### Requirement: Case-insensitive agent match
When no exact name matches, the reader SHALL take the first name equal to the requested one ignoring case, in the executor's order: built-in names, then global file names, then project-only file names, each directory sorted. That name MUST then resolve with the exact-name precedence.

#### Scenario: Case-insensitive match prefers the built-in name
- **WHEN** `.pi/agents/explore.md` exists and the launch names `EXPLORE`
- **THEN** the reader returns the built-in `Explore`, as the executor does

### Requirement: Agent files are found by listing
The reader MUST find agent files by listing the `*.md` entries of each agents directory and comparing the requested name with each file's base name. It MUST NOT join the requested name into a path.

#### Scenario: Path-like type
- **WHEN** the launch names `../../secret` and a file `secret.md` exists two levels above the agents directory
- **THEN** that file is not read and the reader returns the built-in `general-purpose` agent

### Requirement: Lookup never throws
A missing or unlistable directory, a file that cannot be read, and a file whose frontmatter cannot be parsed MUST be skipped as if absent. The reader MUST NOT throw.

#### Scenario: Unreadable file skipped
- **WHEN** `.pi/agents/worker.md` cannot be read and `<agentDir>/agents/worker.md` exists
- **THEN** the reader returns the global agent and does not throw

#### Scenario: Malformed frontmatter skipped
- **WHEN** `.pi/agents/worker.md` has frontmatter that cannot be parsed and no other file defines `worker`
- **THEN** the reader returns the built-in `general-purpose` agent and does not throw

#### Scenario: Agents directory missing
- **WHEN** neither `.pi/agents/` nor `<agentDir>/agents/` exists and the launch names `Plan`
- **THEN** the reader returns the built-in `Plan` agent

### Requirement: Built-in agents
The built-in table SHALL hold `general-purpose`, `Explore` and `Plan` with the executor's descriptions. `Explore` and `Plan` SHALL declare the tools `read`, `bash`, `grep`, `find`, `ls`; `general-purpose` SHALL declare none. Built-ins MUST have an empty instructions excerpt and no `inherit_context`, `run_in_background`, `max_turns` or `locked`.

#### Scenario: Explore built-in
- **WHEN** the launch names `Explore` and no file defines it
- **THEN** the reader returns source `builtin`, description `Fast codebase exploration agent (read-only)`, declared tools `read`, `bash`, `grep`, `find`, `ls`, an empty instructions excerpt, and no `inherit_context`, `run_in_background`, `max_turns` or `locked`

#### Scenario: general-purpose declares no tools
- **WHEN** the reader returns the built-in `general-purpose`
- **THEN** its declared tools are `null`

### Requirement: Agent identity fields
For an agent file, the reader SHALL return `name` (the file name without `.md`), `description` (frontmatter `description`, else the name) and `instructionsExcerpt` (the first 500 Unicode code points of the trimmed body). A frontmatter that is not a mapping MUST read as empty.

#### Scenario: Long body
- **WHEN** the body is 2000 characters long
- **THEN** the instructions excerpt is its first 500 characters

#### Scenario: Body without frontmatter
- **WHEN** the file has no frontmatter and starts with a blank line
- **THEN** the instructions excerpt starts with the first non-blank character

### Requirement: Model and thinking are never read out
The agent's `model` and `thinking` values MUST NOT appear in the returned facts. The reader SHALL record only whether each is set, as the executor reads them: `model` when it is a string, `thinking` when it is one of `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.

#### Scenario: Model never read out
- **WHEN** the frontmatter sets `model: anthropic/claude-opus` and `thinking: high`
- **THEN** neither value appears anywhere in the returned facts, and both are recorded as set

#### Scenario: Invalid thinking is not set
- **WHEN** the frontmatter has `thinking: banana`
- **THEN** thinking is recorded as not set

### Requirement: Declared tools
The reader SHALL return `declaredTools` as `null` when `tools` is absent, an empty list for `none` or an empty value, and otherwise the listed names, from a YAML list or a comma-separated string.

#### Scenario: Comma-separated tools
- **WHEN** the frontmatter has `tools: read, grep`
- **THEN** declared tools are `read`, `grep`

#### Scenario: Tools none
- **WHEN** the frontmatter has `tools: none`
- **THEN** declared tools are an empty list

### Requirement: Launch fields in the agent file
The reader SHALL return `maxTurns` as a number of at least 0, else `null`. It SHALL return `runInBackground` and `inheritContext` unset when absent or null; otherwise `true` exactly when the value is the boolean `true`, else `false`, as the executor reads them.

#### Scenario: Non-boolean flag
- **WHEN** the frontmatter has `inherit_context: "yes"`
- **THEN** `inheritContext` is false

#### Scenario: max_turns not a number
- **WHEN** the frontmatter has `max_turns: "5"`
- **THEN** `maxTurns` is `null`

### Requirement: Lock declaration
The reader SHALL read `locked` as the executor does: `true` is the whole-file form, `false` or absent is no lock, and any other value is a list (YAML list or comma-separated string) from which only the lockable fields `model`, `thinking`, `max_turns`, `inherit_context` and `run_in_background` are kept. A list that keeps no field MUST read as no lock.

#### Scenario: Whole-file lock
- **WHEN** the frontmatter has `locked: true`
- **THEN** the lock is the whole-file form

#### Scenario: Field list with unknown entry
- **WHEN** the frontmatter has `locked: [model, colour]`
- **THEN** the lock is the list `model`

#### Scenario: List with no lockable field
- **WHEN** the frontmatter has `locked: [colour]` or `locked: false`
- **THEN** there is no lock

#### Scenario: Comma-separated lock
- **WHEN** the frontmatter has `locked: "model, thinking"`
- **THEN** the lock is the list `model`, `thinking`

### Requirement: Locked fields
A pure function SHALL report, for each lockable field, whether the agent locks it. A field MUST count as locked when the lock is a list naming it, or when the lock is the whole-file form and the agent sets that field.

#### Scenario: Whole-file lock covers only fields the file sets
- **WHEN** the agent file has `locked: true`, sets `model`, and does not set `thinking`
- **THEN** `model` is locked and `thinking` is not

#### Scenario: Listed lock without a value
- **WHEN** the agent file has `locked: [thinking]` and does not set `thinking`
- **THEN** `thinking` is locked

### Requirement: Effective launch fields
A pure function SHALL compute from the launch input and the agent facts: `resume`, true exactly when the input has a non-empty string `resume`; and effective `inheritContext` and `runInBackground`. Each effective value MUST be the input's boolean when the field is not locked and the input sets one, else the agent's value, else `false`.

#### Scenario: Inherit from frontmatter
- **WHEN** the input omits `inherit_context` and the agent file sets `inherit_context: true`
- **THEN** effective `inheritContext` is true

#### Scenario: Input wins without a lock
- **WHEN** the input sets `inherit_context: false` and the agent file sets `inherit_context: true` without a lock
- **THEN** effective `inheritContext` is false

#### Scenario: Lock keeps the agent value
- **WHEN** the input sets `inherit_context: false` and the agent file sets `inherit_context: true` and `locked: [inherit_context]`
- **THEN** effective `inheritContext` is true

#### Scenario: Resume
- **WHEN** the input has `resume: "agent-12"`
- **THEN** `resume` is true
