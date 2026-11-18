## ADDED Requirements

### Requirement: Agent registry lookup
`SubagentsService` SHALL offer `listAgentTypes()` and `getAgentType(name)`. Each SHALL reload agent files first, as a `subagent` call does. `listAgentTypes()` SHALL return a snapshot of every enabled agent from every source, after overrides. `getAgentType(name)` SHALL resolve `name` as a launch would (see "Agent name resolution") and SHALL return nothing for a name that resolves to a disabled agent.

#### Scenario: Disabled agent
- **WHEN** `.pi/agents/worker.md` has `enabled: false` and `getAgentType("worker")` is called
- **THEN** nothing is returned, and `listAgentTypes()` omits `worker`

#### Scenario: New file picked up
- **WHEN** an agent file is added after the session started and `listAgentTypes()` is called
- **THEN** the result includes the new agent

### Requirement: Agent sources and override
Agents SHALL load from four sources in this order, each later source replacing an earlier agent of the same name: `builtin` (see `builtin-role-agents`), `package` (see `package-agents`), `global` (`~/.pi/agent/agents/*.md`), `project` (`.pi/agents/*.md`). Names SHALL compare case-insensitively, so the registry never holds two agents whose names differ only in case. An agent's name SHALL be its frontmatter `name:` when that is a non-empty string, otherwise its file name without `.md`.

#### Scenario: Project file overrides a built-in case-insensitively
- **WHEN** `.pi/agents/Explore.md` exists with no `name:` field and `getAgentType("explore")` is called
- **THEN** the snapshot has `source` `project` and the file's description, and `listAgentTypes()` has one entry for that name

#### Scenario: Package over built-in
- **WHEN** a configured package defines `reviewer` and no global or project file does
- **THEN** `getAgentType("reviewer")` has `source` `package` and `listAgentTypes()` has one entry for that name

#### Scenario: Global over package
- **WHEN** a configured package and `~/.pi/agent/agents/` both define `reviewer`
- **THEN** `getAgentType("reviewer")` has `source` `global`

#### Scenario: Override by frontmatter name
- **WHEN** `.pi/agents/my-explorer.md` declares `name: EXPLORE`
- **THEN** it replaces the built-in `explore` and `listAgentTypes()` has one entry for that name

#### Scenario: Frontmatter name over file name
- **WHEN** `.pi/agents/Explore.md` declares `name: other`
- **THEN** `other` is added and the built-in `explore` is unchanged

#### Scenario: Name from frontmatter
- **WHEN** a package file `agents/scout.md` declares `name: superspec.scout`
- **THEN** `getAgentType("superspec.scout")` returns it and the built-in `scout` is unchanged

### Requirement: Agent name resolution
A launch SHALL resolve a name by exact match, then case-insensitive match, then `general-purpose` as an alias of `general` when no agent named `general-purpose` exists, then the fallback `general`.

#### Scenario: Case-insensitive name
- **WHEN** the only non-built-in agent file is `.pi/agents/Worker.md` and `getAgentType("worker")` is called
- **THEN** the snapshot's `name` is `Worker`

#### Scenario: Legacy general-purpose name
- **WHEN** no file defines `general-purpose` and `getAgentType("general-purpose")` is called
- **THEN** the snapshot is the agent named `general`

#### Scenario: Real general-purpose agent wins
- **WHEN** `.pi/agents/general-purpose.md` exists and `getAgentType("general-purpose")` is called
- **THEN** the snapshot is that file's agent, not `general`

#### Scenario: Unknown name
- **WHEN** `getAgentType("does-not-exist")` is called
- **THEN** the snapshot is the agent named `general`

#### Scenario: Removed Plan falls back with a note
- **WHEN** the main model launches `subagent_type: "Plan"` with no agent of that name
- **THEN** the child runs as `general` and the tool result notes that `Plan` is unknown and `general` ran instead

### Requirement: Missing fallback agent refused
When a launch resolves to the fallback `general` and no enabled agent named `general` exists, the launch MUST be refused with an error naming `general`, and no child SHALL start. `getAgentType` SHALL return nothing in that case. No agent definition SHALL exist in code to stand in for it.

#### Scenario: General disabled
- **WHEN** `.pi/agents/general.md` has `enabled: false` and the main model launches `subagent_type: "does-not-exist"`
- **THEN** the `subagent` result is an error naming `general` and no child session is created

### Requirement: History display never needs the fallback
Showing a recorded or running agent (tool call rendering, widget, fleet list, result retrieval, session navigation, persisted runs) SHALL look the recorded type up by exact or case-insensitive name only, with no fallback. When it does not resolve, the display SHALL use the recorded type as its name. Display MUST NOT fail when `general` is missing or disabled.

#### Scenario: Legacy Plan run shown
- **WHEN** a persisted run has type `Plan` and no agent named `Plan` exists
- **THEN** the session navigator lists it as `Plan`, not as `general`

#### Scenario: Display without general
- **WHEN** `general` is disabled and the widget renders a run whose type no longer resolves
- **THEN** the widget shows the recorded type and no error is raised

### Requirement: Agent snapshot content
Each snapshot SHALL be a frozen, plain serializable copy holding `name`, `source` (`builtin`, `package`, `global` or `project`), `description`, `instructions` (the body), `tools` (as declared, or `null` when undeclared), `defaultTools`, `disallowedTools`, and as declared or absent `model`, `thinking`, `locked` (`true` or a list of lockable fields), `maxTurns`, `runInBackground` and `context` (`fresh` or `fork`). Changing a snapshot MUST NOT change executor state.

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

### Requirement: Deprecated inherit_context in snapshots
A deprecated `inherit_context` declaration SHALL appear in the snapshot as `context`, and the snapshot MUST NOT carry `inheritContext`.

#### Scenario: Deprecated inherit_context declared
- **WHEN** an agent file declares `inherit_context: true`
- **THEN** its snapshot has `context` `fork` and no `inheritContext`

## REMOVED Requirements

### Requirement: Agent registry query

**Reason**: Split into "Agent registry lookup" and "Agent sources and resolution", because the sources, the case-insensitive override and the fallback change; OpenSpec cannot drop or rename scenarios through MODIFIED.

**Migration**: Same API. `Explore`-named scenarios now use `explore`; the fallback is `general`, with `general-purpose` as an alias.

### Requirement: Agent snapshot fields

**Reason**: Restated as "Agent snapshot content": `source` gains `package` and the built-in example is `explore` instead of `Explore`.

**Migration**: Consumers of `AgentTypeSnapshot.source` handle `package`.
